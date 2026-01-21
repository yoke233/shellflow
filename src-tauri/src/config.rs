use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Default configuration file content (embedded at compile time)
pub const DEFAULT_CONFIG: &str = include_str!("default_config.jsonc");

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    pub main: MainConfig,
    pub terminal: TerminalConfig,
    pub worktree: WorktreeConfig,
    pub merge: MergeConfig,
    pub mappings: MappingsConfig,
    pub tasks: Vec<TaskConfig>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MergeStrategy {
    #[default]
    Merge,
    Rebase,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    #[default]
    Command,
    Daemon,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub kind: TaskKind,
    /// If true, task runs without showing output in drawer
    #[serde(default)]
    pub silent: bool,
    /// Override shell to run command with (e.g., "/bin/bash", "fish")
    pub shell: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MergeConfig {
    /// Merge strategy: "merge" or "rebase"
    pub strategy: MergeStrategy,
    /// Delete the worktree after successful merge (default: true)
    #[serde(rename = "deleteWorktree")]
    pub delete_worktree: bool,
    /// Delete the local branch after successful merge (default: false)
    #[serde(rename = "deleteLocalBranch")]
    pub delete_local_branch: bool,
    /// Delete the remote branch after successful merge (default: false)
    #[serde(rename = "deleteRemoteBranch")]
    pub delete_remote_branch: bool,
}

impl Default for MergeConfig {
    fn default() -> Self {
        Self {
            strategy: MergeStrategy::Merge,
            delete_worktree: true,
            delete_local_branch: false,
            delete_remote_branch: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MainConfig {
    /// Command to run in the main terminal pane
    pub command: String,
    #[serde(rename = "fontFamily")]
    pub font_family: String,
    #[serde(rename = "fontSize")]
    pub font_size: u16,
    #[serde(rename = "fontLigatures")]
    pub font_ligatures: bool,
}

impl Default for MainConfig {
    fn default() -> Self {
        Self {
            command: "claude".to_string(),
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            font_size: 13,
            font_ligatures: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WorktreeConfig {
    /// Directory where worktrees are created.
    /// Supports placeholder: {{ repo_directory }} (the repository directory)
    /// Final path: {directory}/{workspace_name}
    /// Default: {{ repo_directory }}/.worktrees
    pub directory: Option<String>,

    /// Configuration for copying files to new worktrees
    pub copy: CopyConfig,
}

impl Default for WorktreeConfig {
    fn default() -> Self {
        Self {
            directory: None,
            copy: CopyConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CopyConfig {
    /// Copy gitignored files from the project to new worktrees
    #[serde(rename = "gitIgnored")]
    pub gitignored: bool,

    /// Glob patterns to exclude from copying
    pub except: Vec<String>,
}

impl Default for CopyConfig {
    fn default() -> Self {
        Self {
            gitignored: false,
            except: vec![".claude".to_string(), ".worktrees".to_string()],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TerminalConfig {
    #[serde(rename = "fontFamily")]
    pub font_family: String,
    #[serde(rename = "fontSize")]
    pub font_size: u16,
    #[serde(rename = "fontLigatures")]
    pub font_ligatures: bool,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            font_size: 13,
            font_ligatures: false,
        }
    }
}

/// Platform-specific shortcut mapping.
/// Allows different shortcuts for macOS vs other platforms.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlatformShortcut {
    #[serde(default)]
    pub mac: Option<String>,
    #[serde(default)]
    pub other: Option<String>,
}

/// A single shortcut entry: either a universal string or platform-specific.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ShortcutEntry {
    Universal(String),
    Platform(PlatformShortcut),
}

/// A shortcut configuration that can be:
/// - A simple string (universal)
/// - A platform-specific object
/// - An array of strings and/or platform-specific objects
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Shortcut {
    Single(String),
    Platform(PlatformShortcut),
    Multiple(Vec<ShortcutEntry>),
}

impl Default for Shortcut {
    fn default() -> Self {
        Shortcut::Single(String::new())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MappingsConfig {
    #[serde(rename = "toggleDrawer")]
    pub toggle_drawer: Shortcut,
    #[serde(rename = "toggleRightPanel")]
    pub toggle_right_panel: Shortcut,
    #[serde(rename = "terminalCopy")]
    pub terminal_copy: Shortcut,
    #[serde(rename = "terminalPaste")]
    pub terminal_paste: Shortcut,
    #[serde(rename = "worktreePrev")]
    pub worktree_prev: Shortcut,
    #[serde(rename = "worktreeNext")]
    pub worktree_next: Shortcut,
    #[serde(rename = "worktree1")]
    pub worktree_1: Shortcut,
    #[serde(rename = "worktree2")]
    pub worktree_2: Shortcut,
    #[serde(rename = "worktree3")]
    pub worktree_3: Shortcut,
    #[serde(rename = "worktree4")]
    pub worktree_4: Shortcut,
    #[serde(rename = "worktree5")]
    pub worktree_5: Shortcut,
    #[serde(rename = "worktree6")]
    pub worktree_6: Shortcut,
    #[serde(rename = "worktree7")]
    pub worktree_7: Shortcut,
    #[serde(rename = "worktree8")]
    pub worktree_8: Shortcut,
    #[serde(rename = "worktree9")]
    pub worktree_9: Shortcut,
}

impl Default for MappingsConfig {
    fn default() -> Self {
        Self {
            toggle_drawer: Shortcut::Single("ctrl+`".to_string()),
            toggle_right_panel: Shortcut::Single("cmd+b".to_string()),
            terminal_copy: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+c".to_string()),
                other: Some("ctrl+shift+c".to_string()),
            }),
            terminal_paste: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+v".to_string()),
                other: Some("ctrl+shift+v".to_string()),
            }),
            worktree_prev: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+k".to_string()),
                other: Some("ctrl+shift+k".to_string()),
            }),
            worktree_next: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+j".to_string()),
                other: Some("ctrl+shift+j".to_string()),
            }),
            worktree_1: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+1".to_string()),
                other: Some("ctrl+1".to_string()),
            }),
            worktree_2: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+2".to_string()),
                other: Some("ctrl+2".to_string()),
            }),
            worktree_3: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+3".to_string()),
                other: Some("ctrl+3".to_string()),
            }),
            worktree_4: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+4".to_string()),
                other: Some("ctrl+4".to_string()),
            }),
            worktree_5: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+5".to_string()),
                other: Some("ctrl+5".to_string()),
            }),
            worktree_6: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+6".to_string()),
                other: Some("ctrl+6".to_string()),
            }),
            worktree_7: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+7".to_string()),
                other: Some("ctrl+7".to_string()),
            }),
            worktree_8: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+8".to_string()),
                other: Some("ctrl+8".to_string()),
            }),
            worktree_9: Shortcut::Platform(PlatformShortcut {
                mac: Some("cmd+9".to_string()),
                other: Some("ctrl+9".to_string()),
            }),
        }
    }
}

pub fn get_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".config")
        .join("onemanband")
        .join("config.jsonc")
}

/// Load global config only (for backwards compatibility)
#[allow(dead_code)]
pub fn load_config() -> Config {
    load_config_for_project(None)
}

fn parse_jsonc_value(content: &str) -> Option<serde_json::Value> {
    let mut json = content.to_string();
    json_strip_comments::strip(&mut json).ok()?;
    serde_json::from_str(&json).ok()
}

/// Recursively merge overlay into base. Overlay values take precedence.
/// Arrays are merged by "name" field if items are objects with that field.
fn deep_merge(base: &mut serde_json::Value, overlay: &serde_json::Value) {
    use serde_json::Value;
    if let (Value::Object(base_obj), Value::Object(overlay_obj)) = (base, overlay) {
        for (key, overlay_val) in overlay_obj {
            match base_obj.get_mut(key) {
                Some(base_val) if base_val.is_object() && overlay_val.is_object() => {
                    deep_merge(base_val, overlay_val);
                }
                Some(base_val) if base_val.is_array() && overlay_val.is_array() => {
                    merge_arrays(base_val, overlay_val);
                }
                _ => {
                    base_obj.insert(key.clone(), overlay_val.clone());
                }
            }
        }
    }
}

/// Merge two arrays. If items are objects with a "name" field, merge by name.
/// Items with matching names are overridden; unique items accumulate.
fn merge_arrays(base: &mut serde_json::Value, overlay: &serde_json::Value) {
    let (Some(base_arr), Some(overlay_arr)) = (base.as_array_mut(), overlay.as_array()) else {
        return;
    };

    // Check if arrays contain objects with "name" fields
    let base_has_names = base_arr
        .iter()
        .all(|v| v.get("name").and_then(|n| n.as_str()).is_some());
    let overlay_has_names = overlay_arr
        .iter()
        .all(|v| v.get("name").and_then(|n| n.as_str()).is_some());

    if base_has_names && overlay_has_names {
        // Merge by name: overlay items override base items with same name
        for overlay_item in overlay_arr {
            if let Some(overlay_name) = overlay_item.get("name").and_then(|n| n.as_str()) {
                // Find and replace existing item with same name, or append
                if let Some(base_item) = base_arr
                    .iter_mut()
                    .find(|v| v.get("name").and_then(|n| n.as_str()) == Some(overlay_name))
                {
                    *base_item = overlay_item.clone();
                } else {
                    base_arr.push(overlay_item.clone());
                }
            }
        }
    } else {
        // No name fields - append unique items (by value equality)
        for overlay_item in overlay_arr {
            if !base_arr.contains(overlay_item) {
                base_arr.push(overlay_item.clone());
            }
        }
    }
}

/// Load config with optional project-specific overrides.
/// Config files are merged in order: global <- repo <- local
/// - Global: ~/.config/onemanband/config.jsonc
/// - Repo: {project_path}/.onemanband/config.jsonc (tracked in git)
/// - Local: {project_path}/.onemanband/config.local.jsonc (gitignored)
pub fn load_config_for_project(project_path: Option<&str>) -> Config {
    use serde_json::Value;
    use std::path::Path;

    // Start with global config (or empty object if missing)
    let global_path = get_config_path();
    let mut merged: Value = if global_path.exists() {
        std::fs::read_to_string(&global_path)
            .ok()
            .and_then(|content| parse_jsonc_value(&content))
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()))
    } else {
        // Create default config file if it doesn't exist
        if let Some(parent) = global_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&global_path, DEFAULT_CONFIG);
        Value::Object(serde_json::Map::new())
    };

    // Merge repo and local configs if project path is provided
    if let Some(project_path) = project_path {
        let project_dir = Path::new(project_path);

        // Repo config: {project_path}/.onemanband/config.jsonc
        let repo_config_path = project_dir.join(".onemanband").join("config.jsonc");
        if repo_config_path.exists() {
            if let Some(repo_value) = std::fs::read_to_string(&repo_config_path)
                .ok()
                .and_then(|content| parse_jsonc_value(&content))
            {
                deep_merge(&mut merged, &repo_value);
            }
        }

        // Local config: {project_path}/.onemanband/config.local.jsonc
        let local_config_path = project_dir.join(".onemanband").join("config.local.jsonc");
        if local_config_path.exists() {
            if let Some(local_value) = std::fs::read_to_string(&local_config_path)
                .ok()
                .and_then(|content| parse_jsonc_value(&content))
            {
                deep_merge(&mut merged, &local_value);
            }
        }
    }

    // Deserialize merged config, falling back to defaults
    serde_json::from_value(merged).unwrap_or_default()
}
