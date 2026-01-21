use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub worktrees: Vec<Worktree>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: FileStatus,
    pub insertions: Option<usize>,
    pub deletions: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedState {
    pub projects: Vec<Project>,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self { projects: vec![] }
    }
}

#[allow(dead_code)]
pub struct PtySession {
    pub worktree_id: String,
    pub child_pid: u32,
}

pub struct AppState {
    pub persisted: RwLock<PersistedState>,
    pub pty_sessions: RwLock<HashMap<String, Arc<PtySession>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            persisted: RwLock::new(PersistedState::default()),
            pty_sessions: RwLock::new(HashMap::new()),
        }
    }

    pub fn load_or_default() -> Self {
        let state = Self::new();

        if let Some(config_dir) = dirs::home_dir() {
            let state_file = config_dir.join(".onemanband").join("state.json");
            if state_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&state_file) {
                    if let Ok(mut persisted) = serde_json::from_str::<PersistedState>(&content) {
                        // Clean up stale worktrees whose directories no longer exist
                        let mut cleaned = false;
                        for project in &mut persisted.projects {
                            let before_count = project.worktrees.len();
                            project.worktrees.retain(|w| {
                                let exists = std::path::Path::new(&w.path).exists();
                                if !exists {
                                    eprintln!(
                                        "[State] Removing stale worktree '{}' - path no longer exists: {}",
                                        w.name, w.path
                                    );
                                }
                                exists
                            });
                            if project.worktrees.len() != before_count {
                                cleaned = true;
                            }
                        }

                        *state.persisted.write() = persisted;

                        // Save cleaned state if any worktrees were removed
                        if cleaned {
                            if let Err(e) = state.save() {
                                eprintln!("[State] Failed to save cleaned state: {}", e);
                            }
                        }
                    }
                }
            }
        }

        state
    }

    pub fn save(&self) -> Result<(), std::io::Error> {
        if let Some(home_dir) = dirs::home_dir() {
            let config_dir = home_dir.join(".onemanband");
            std::fs::create_dir_all(&config_dir)?;

            let state_file = config_dir.join("state.json");
            let content = serde_json::to_string_pretty(&*self.persisted.read())?;
            std::fs::write(state_file, content)?;
        }
        Ok(())
    }
}

unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}
