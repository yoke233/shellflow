use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    pub main: MainConfig,
    pub terminal: TerminalConfig,
    pub worktree: WorktreeConfig,
    pub merge: MergeConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MergeStrategy {
    #[default]
    Merge,
    Rebase,
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
fn deep_merge(base: &mut serde_json::Value, overlay: &serde_json::Value) {
    use serde_json::Value;
    if let (Value::Object(base_obj), Value::Object(overlay_obj)) = (base, overlay) {
        for (key, overlay_val) in overlay_obj {
            match base_obj.get_mut(key) {
                Some(base_val) if base_val.is_object() && overlay_val.is_object() => {
                    deep_merge(base_val, overlay_val);
                }
                _ => {
                    base_obj.insert(key.clone(), overlay_val.clone());
                }
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
        let default_config = r#"{
  // One Man Band Configuration

  // Main terminal pane
  "main": {
    // Command to run (e.g., "claude", "aider", "cursor")
    "command": "claude",
    "fontFamily": "Menlo, Monaco, 'Courier New', monospace",
    "fontSize": 13
  },

  // Shell terminal (bottom-right pane)
  "terminal": {
    "fontFamily": "Menlo, Monaco, 'Courier New', monospace",
    "fontSize": 13
  },

  // Worktree settings
  "worktree": {
    // Directory for worktrees. Final path: {directory}/{workspace_name}
    // Supports placeholder: {{ repo_directory }} (the repo directory)
    // Default: "{{ repo_directory }}/.worktrees"
    "directory": null,

    // Copy settings for new worktrees
    "copy": {
      // Copy gitignored files (e.g., .env, node_modules)
      "gitIgnored": false,
      // Glob patterns to exclude from copying
      "except": [".claude", ".worktrees"]
    }
  },

  // Merge/rebase workflow settings
  "merge": {
    // Strategy: "merge" or "rebase"
    "strategy": "merge",
    // Delete worktree after successful merge
    "deleteWorktree": true,
    // Delete local branch after successful merge
    "deleteLocalBranch": false,
    // Delete remote branch after successful merge
    "deleteRemoteBranch": false
  }
}
"#;
        let _ = std::fs::write(&global_path, default_config);
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
