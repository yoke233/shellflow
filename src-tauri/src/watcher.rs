use crate::git;
use crate::state::FileChange;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

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
