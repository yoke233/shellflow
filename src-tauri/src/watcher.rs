use crate::config;
use crate::git;
use crate::state::FileChange;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Resolve the actual git directory for a given repo/worktree path.
/// For regular repos, this is <path>/.git
/// For worktrees, .git is a file containing "gitdir: <actual-path>"
fn resolve_git_dir(repo_path: &Path) -> Option<PathBuf> {
    let git_path = repo_path.join(".git");

    if git_path.is_dir() {
        // Regular repo - .git is a directory
        Some(git_path)
    } else if git_path.is_file() {
        // Worktree - .git is a file pointing to the actual git dir
        if let Ok(content) = std::fs::read_to_string(&git_path) {
            // Format: "gitdir: /path/to/actual/.git/worktrees/<name>"
            if let Some(path) = content.strip_prefix("gitdir: ") {
                let path = path.trim();
                return Some(PathBuf::from(path));
            }
        }
        None
    } else {
        None
    }
}

#[derive(Clone, serde::Serialize)]
pub struct FilesChanged {
    pub worktree_path: String,
    pub files: Vec<FileChange>,
}

#[derive(Clone, serde::Serialize)]
pub struct WorktreeRemoved {
    pub worktree_path: String,
}

// Track active watchers so we can stop them
lazy_static::lazy_static! {
    static ref WATCHERS: Mutex<HashMap<String, Sender<()>>> = Mutex::new(HashMap::new());
}

pub fn watch_worktree(app: AppHandle, worktree_id: String, worktree_path: String) {
    // Check if already watching this worktree
    if WATCHERS.lock().contains_key(&worktree_id) {
        return;
    }

    // Create stop channel
    let (stop_tx, stop_rx) = channel::<()>();
    WATCHERS.lock().insert(worktree_id.clone(), stop_tx);

    let worktree_id_clone = worktree_id.clone();

    thread::spawn(move || {
        let (tx, rx) = channel::<notify::Result<Event>>();

        let config = Config::default()
            .with_poll_interval(Duration::from_secs(2))
            .with_compare_contents(false);

        let mut watcher: RecommendedWatcher = match Watcher::new(tx, config) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
                WATCHERS.lock().remove(&worktree_id_clone);
                return;
            }
        };

        let path = Path::new(&worktree_path);
        if let Err(e) = watcher.watch(path, RecursiveMode::Recursive) {
            eprintln!("Failed to watch path: {}", e);
            WATCHERS.lock().remove(&worktree_id_clone);
            return;
        }

        // Trailing-edge debounce: wait until no events for this duration
        let debounce_duration = Duration::from_millis(500);
        let mut pending_update = false;
        let mut last_event_time = std::time::Instant::now();

        // Check for external folder deletion every 2 seconds (not every loop iteration)
        let existence_check_interval = Duration::from_secs(2);
        let mut last_existence_check = std::time::Instant::now();

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                eprintln!("[Watcher] Stopping watcher for {}", worktree_id_clone);
                break;
            }

            // Use short timeout to check for debounce expiry
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(_event)) => {
                    // New event: mark pending and reset timer
                    pending_update = true;
                    last_event_time = std::time::Instant::now();
                }
                Ok(Err(e)) => {
                    eprintln!("Watch error: {}", e);
                }
                Err(_) => {
                    // Timeout - check if we should process pending update
                }
            }

            // Periodically check if worktree folder was deleted externally
            if last_existence_check.elapsed() >= existence_check_interval {
                last_existence_check = std::time::Instant::now();
                if !path.exists() {
                    eprintln!(
                        "[Watcher] Worktree folder deleted externally: {}",
                        worktree_path
                    );
                    let _ = app.emit(
                        "worktree-removed",
                        WorktreeRemoved {
                            worktree_path: worktree_path.clone(),
                        },
                    );
                    break;
                }
            }

            // Process pending update after debounce period of quiet
            if pending_update && last_event_time.elapsed() >= debounce_duration {
                pending_update = false;

                // Get changed files and emit
                if let Ok(files) = git::get_changed_files(path) {
                    let _ = app.emit(
                        "files-changed",
                        FilesChanged {
                            worktree_path: worktree_path.clone(),
                            files,
                        },
                    );
                }
            }
        }

        WATCHERS.lock().remove(&worktree_id_clone);
    });
}

pub fn stop_watching(worktree_id: &str) {
    if let Some(tx) = WATCHERS.lock().remove(worktree_id) {
        let _ = tx.send(());
    }
}

pub fn stop_all_watchers() {
    let watchers = std::mem::take(&mut *WATCHERS.lock());
    for (_, tx) in watchers {
        let _ = tx.send(());
    }
}

// Track active merge watchers
lazy_static::lazy_static! {
    static ref MERGE_WATCHERS: Mutex<HashMap<String, Sender<()>>> = Mutex::new(HashMap::new());
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeComplete {
    pub worktree_id: String,
    pub worktree_path: String,
}

/// Watch for merge completion in a worktree.
/// Detects when MERGE_HEAD is deleted (merge committed successfully).
pub fn watch_merge_state(app: AppHandle, worktree_id: String, worktree_path: String) {
    // Check if already watching
    if MERGE_WATCHERS.lock().contains_key(&worktree_id) {
        return;
    }

    // Resolve the actual git directory (handles both regular repos and worktrees)
    let Some(git_dir) = resolve_git_dir(Path::new(&worktree_path)) else {
        eprintln!("[MergeWatcher] Could not resolve git dir for {:?}", worktree_path);
        return;
    };

    let merge_head_path = git_dir.join("MERGE_HEAD");

    // Only start watching if MERGE_HEAD exists (we're in a merge state)
    if !merge_head_path.exists() {
        eprintln!("[MergeWatcher] No MERGE_HEAD found at {:?}, not watching", merge_head_path);
        return;
    }

    eprintln!("[MergeWatcher] Starting merge watcher for {} at {:?}", worktree_id, merge_head_path);

    let (stop_tx, stop_rx) = channel::<()>();
    MERGE_WATCHERS.lock().insert(worktree_id.clone(), stop_tx);

    let worktree_id_clone = worktree_id.clone();
    let worktree_path_clone = worktree_path.clone();

    thread::spawn(move || {
        let poll_interval = Duration::from_millis(500);

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                eprintln!("[MergeWatcher] Stopping merge watcher for {}", worktree_id_clone);
                break;
            }

            // Check if MERGE_HEAD still exists
            if !merge_head_path.exists() {
                eprintln!("[MergeWatcher] MERGE_HEAD deleted - merge complete for {}", worktree_id_clone);
                let _ = app.emit(
                    "merge-complete",
                    MergeComplete {
                        worktree_id: worktree_id_clone.clone(),
                        worktree_path: worktree_path_clone.clone(),
                    },
                );
                break;
            }

            thread::sleep(poll_interval);
        }

        MERGE_WATCHERS.lock().remove(&worktree_id_clone);
    });
}

pub fn stop_merge_watcher(worktree_id: &str) {
    if let Some(tx) = MERGE_WATCHERS.lock().remove(worktree_id) {
        let _ = tx.send(());
    }
}

// Track active rebase watchers
lazy_static::lazy_static! {
    static ref REBASE_WATCHERS: Mutex<HashMap<String, Sender<()>>> = Mutex::new(HashMap::new());
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseComplete {
    pub worktree_id: String,
    pub worktree_path: String,
}

/// Watch for rebase completion in a worktree.
/// Detects when rebase-merge and rebase-apply are both gone (rebase finished).
pub fn watch_rebase_state(app: AppHandle, worktree_id: String, worktree_path: String) {
    // Check if already watching
    if REBASE_WATCHERS.lock().contains_key(&worktree_id) {
        return;
    }

    // Resolve the actual git directory (handles both regular repos and worktrees)
    let Some(git_dir) = resolve_git_dir(Path::new(&worktree_path)) else {
        eprintln!("[RebaseWatcher] Could not resolve git dir for {:?}", worktree_path);
        return;
    };

    let rebase_merge_path = git_dir.join("rebase-merge");
    let rebase_apply_path = git_dir.join("rebase-apply");

    // Only start watching if a rebase is in progress
    if !rebase_merge_path.exists() && !rebase_apply_path.exists() {
        eprintln!("[RebaseWatcher] No rebase in progress at {:?}, not watching", worktree_path);
        return;
    }

    eprintln!("[RebaseWatcher] Starting rebase watcher for {} at {:?}", worktree_id, git_dir);

    let (stop_tx, stop_rx) = channel::<()>();
    REBASE_WATCHERS.lock().insert(worktree_id.clone(), stop_tx);

    let worktree_id_clone = worktree_id.clone();
    let worktree_path_clone = worktree_path.clone();

    thread::spawn(move || {
        let poll_interval = Duration::from_millis(500);

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                eprintln!("[RebaseWatcher] Stopping rebase watcher for {}", worktree_id_clone);
                break;
            }

            // Check if rebase is still in progress
            if !rebase_merge_path.exists() && !rebase_apply_path.exists() {
                eprintln!("[RebaseWatcher] Rebase complete for {}", worktree_id_clone);
                let _ = app.emit(
                    "rebase-complete",
                    RebaseComplete {
                        worktree_id: worktree_id_clone.clone(),
                        worktree_path: worktree_path_clone.clone(),
                    },
                );
                break;
            }

            thread::sleep(poll_interval);
        }

        REBASE_WATCHERS.lock().remove(&worktree_id_clone);
    });
}

pub fn stop_rebase_watcher(worktree_id: &str) {
    if let Some(tx) = REBASE_WATCHERS.lock().remove(worktree_id) {
        let _ = tx.send(());
    }
}

// Track active config watcher
lazy_static::lazy_static! {
    static ref CONFIG_WATCHER: Mutex<Option<Sender<()>>> = Mutex::new(None);
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChanged {
    pub project_path: Option<String>,
}

/// Watch config files for changes and emit events when they change.
/// Watches: global config, repo config, local config (if project_path provided)
pub fn watch_config(app: AppHandle, project_path: Option<String>) {
    // Stop any existing config watcher
    stop_config_watcher();

    let config_paths = config::get_config_paths(project_path.as_deref());

    // Filter to only existing files and their parent directories
    let watch_targets: Vec<PathBuf> = config_paths
        .iter()
        .filter_map(|p| {
            if p.exists() {
                Some(p.clone())
            } else {
                // Watch parent directory so we detect file creation
                p.parent().map(|parent| parent.to_path_buf())
            }
        })
        .collect();

    if watch_targets.is_empty() {
        return;
    }

    let (stop_tx, stop_rx) = channel::<()>();
    *CONFIG_WATCHER.lock() = Some(stop_tx);

    let project_path_clone = project_path.clone();

    thread::spawn(move || {
        let (tx, rx) = channel::<notify::Result<Event>>();

        let watcher_config = Config::default()
            .with_poll_interval(Duration::from_secs(2))
            .with_compare_contents(false);

        let mut watcher: RecommendedWatcher = match Watcher::new(tx, watcher_config) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[ConfigWatcher] Failed to create watcher: {}", e);
                *CONFIG_WATCHER.lock() = None;
                return;
            }
        };

        // Watch each target path
        for path in &watch_targets {
            if let Err(e) = watcher.watch(path, RecursiveMode::NonRecursive) {
                eprintln!("[ConfigWatcher] Failed to watch {:?}: {}", path, e);
            }
        }

        eprintln!("[ConfigWatcher] Watching {} paths", watch_targets.len());

        // Trailing-edge debounce
        let debounce_duration = Duration::from_millis(300);
        let mut pending_update = false;
        let mut last_event_time = std::time::Instant::now();

        // Track which files we care about
        let config_files: Vec<PathBuf> = config::get_config_paths(project_path_clone.as_deref());

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                eprintln!("[ConfigWatcher] Stopping config watcher");
                break;
            }

            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    // Check if the event is for a config file we care about
                    let is_config_file = event.paths.iter().any(|p| {
                        config_files.iter().any(|cf| p.ends_with(cf.file_name().unwrap_or_default()))
                    });

                    if is_config_file {
                        pending_update = true;
                        last_event_time = std::time::Instant::now();
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("[ConfigWatcher] Watch error: {}", e);
                }
                Err(_) => {
                    // Timeout - check if we should process pending update
                }
            }

            // Process pending update after debounce period
            if pending_update && last_event_time.elapsed() >= debounce_duration {
                pending_update = false;
                eprintln!("[ConfigWatcher] Config changed, emitting event");
                let _ = app.emit(
                    "config-changed",
                    ConfigChanged {
                        project_path: project_path_clone.clone(),
                    },
                );
            }
        }

        *CONFIG_WATCHER.lock() = None;
    });
}

pub fn stop_config_watcher() {
    if let Some(tx) = CONFIG_WATCHER.lock().take() {
        let _ = tx.send(());
    }
}
