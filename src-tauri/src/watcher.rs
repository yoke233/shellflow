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
    pub workspace_path: String,
    pub files: Vec<FileChange>,
}

// Track active watchers so we can stop them
lazy_static::lazy_static! {
    static ref WATCHERS: Mutex<HashMap<String, Sender<()>>> = Mutex::new(HashMap::new());
}

pub fn watch_workspace(app: AppHandle, workspace_id: String, workspace_path: String) {
    // Check if already watching this workspace
    if WATCHERS.lock().contains_key(&workspace_id) {
        return;
    }

    // Create stop channel
    let (stop_tx, stop_rx) = channel::<()>();
    WATCHERS.lock().insert(workspace_id.clone(), stop_tx);

    let workspace_id_clone = workspace_id.clone();

    thread::spawn(move || {
        let (tx, rx) = channel::<notify::Result<Event>>();

        let config = Config::default()
            .with_poll_interval(Duration::from_secs(2))
            .with_compare_contents(false);

        let mut watcher: RecommendedWatcher = match Watcher::new(tx, config) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
                WATCHERS.lock().remove(&workspace_id_clone);
                return;
            }
        };

        let path = Path::new(&workspace_path);
        if let Err(e) = watcher.watch(path, RecursiveMode::Recursive) {
            eprintln!("Failed to watch path: {}", e);
            WATCHERS.lock().remove(&workspace_id_clone);
            return;
        }

        // Debounce timer
        let mut last_event = std::time::Instant::now();
        let debounce_duration = Duration::from_millis(500);

        loop {
            // Check for stop signal
            if stop_rx.try_recv().is_ok() {
                eprintln!("[Watcher] Stopping watcher for {}", workspace_id_clone);
                break;
            }

            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(Ok(_event)) => {
                    let now = std::time::Instant::now();
                    if now.duration_since(last_event) > debounce_duration {
                        last_event = now;

                        // Wait a bit for transient files (editor temps) to settle
                        thread::sleep(Duration::from_millis(100));

                        // Get changed files
                        if let Ok(files) = git::get_changed_files(path) {
                            let _ = app.emit(
                                "files-changed",
                                FilesChanged {
                                    workspace_path: workspace_path.clone(),
                                    files,
                                },
                            );
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("Watch error: {}", e);
                }
                Err(_) => {
                    // Timeout, continue watching
                }
            }
        }

        WATCHERS.lock().remove(&workspace_id_clone);
    });
}

pub fn stop_watching(workspace_id: &str) {
    if let Some(tx) = WATCHERS.lock().remove(workspace_id) {
        let _ = tx.send(());
    }
}

pub fn stop_all_watchers() {
    let watchers = std::mem::take(&mut *WATCHERS.lock());
    for (_, tx) in watchers {
        let _ = tx.send(());
    }
}
