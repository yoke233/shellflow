use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Default configuration file content (embedded at compile time)
pub const DEFAULT_CONFIG: &str = include_str!("default_config.jsonc");

/// A configuration error from parsing a config file
#[derive(Debug, Clone, Serialize)]
pub struct ConfigError {
    pub file: String,
    pub message: String,
}

/// Result of loading configuration, includes both config and any errors
#[derive(Debug, Clone, Serialize)]
pub struct ConfigResult {
    pub config: Config,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    pub main: MainConfig,
    pub terminal: TerminalConfig,
    pub worktree: WorktreeConfig,
    pub merge: MergeConfig,
    pub mappings: MappingsConfig,
    pub indicators: IndicatorsConfig,
    pub tasks: Vec<TaskConfig>,
    pub actions: ActionsConfig,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BaseBranchMode {
    #[default]
    Auto,
    Current,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum BaseBranch {
    Mode(BaseBranchMode),
    Named { name: String },
}

impl Default for BaseBranch {
    fn default() -> Self {
        BaseBranch::Mode(BaseBranchMode::Auto)
    }
}

/// A named URL with label and template.
/// Example: { "Dev": "http://localhost:{{ branch | hash_port }}" }
pub type UrlMap = std::collections::HashMap<String, String>;

/// Environment variables map with template support.
/// Example: { "PORT": "{{ branch | hash_port }}" }
pub type EnvMap = std::collections::HashMap<String, String>;

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
    /// Environment variables to set when running the task.
    /// Values support minijinja templates: {{ branch }}, {{ branch | hash_port }}, etc.
    /// Example: { "PORT": "{{ branch | hash_port }}" }
    #[serde(default)]
    pub env: EnvMap,
    /// Named URL templates to display when task is running.
    /// Key is the display label, value is the URL template (supports minijinja).
    /// Example: { "Dev": "http://localhost:{{ branch | hash_port }}" }
    #[serde(default)]
    pub urls: UrlMap,
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
pub struct IndicatorsConfig {
    /// Time in ms after last activity before progress indicator turns off
    #[serde(rename = "activityTimeout")]
    pub activity_timeout: u32,
    /// Show checkmark when activity stops (idle state)
    #[serde(rename = "showIdleCheck")]
    pub show_idle_check: bool,
}

impl Default for IndicatorsConfig {
    fn default() -> Self {
        Self {
            activity_timeout: 250,
            show_idle_check: true,
        }
    }
}

/// Default prompt for merging a worktree with conflicts.
/// Available template variables:
/// - `worktree_dir` - Full path to the worktree
/// - `worktree_name` - Name of the worktree
/// - `branch` - Current branch (the feature branch)
/// - `target_branch` - Target branch to merge into (e.g., main)
/// - `conflicted_files` - List of files with merge conflicts
pub const DEFAULT_MERGE_WORKTREE_WITH_CONFLICTS_PROMPT: &str = r#"In the git worktree at "{{ worktree_dir }}", complete the merge of branch "{{ branch }}" into "{{ target_branch }}".

The following files have merge conflicts:
{% for file in conflicted_files %}- {{ file }}
{% endfor %}

All conflict information is provided above - do not run git status or other diagnostic commands.

Read only the conflicted files listed, resolve each conflict appropriately based on the code context, stage the resolved files with `git add`, and complete the merge with `git commit`."#;

/// Default prompt for rebasing a worktree with conflicts.
/// Available template variables:
/// - `worktree_dir` - Full path to the worktree
/// - `worktree_name` - Name of the worktree
/// - `branch` - Current branch (the feature branch)
/// - `target_branch` - Target branch rebasing onto (e.g., main)
/// - `conflicted_files` - List of files with rebase conflicts
pub const DEFAULT_REBASE_WORKTREE_WITH_CONFLICTS_PROMPT: &str = r#"In the git worktree at "{{ worktree_dir }}", complete the rebase of branch "{{ branch }}" onto "{{ target_branch }}".

The following files have conflicts:
{% for file in conflicted_files %}- {{ file }}
{% endfor %}

All conflict information is provided above - do not run git status or other diagnostic commands.

Read only the conflicted files listed, resolve each conflict appropriately based on the code context, stage the resolved files with `git add`, then run `git rebase --continue`.

Note: Rebasing may involve multiple commits. After running `git rebase --continue`, check if there are more conflicts. If so, repeat the process until the rebase is complete."#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ActionsConfig {
    /// Command to run for AI-assisted actions (e.g., "claude").
    pub command: String,
    /// Prompt template for resolving merge conflicts in a worktree.
    #[serde(rename = "mergeWorktreeWithConflicts")]
    pub merge_worktree_with_conflicts: String,
    /// Prompt template for resolving rebase conflicts in a worktree.
    #[serde(rename = "rebaseWorktreeWithConflicts")]
    pub rebase_worktree_with_conflicts: String,
}

impl Default for ActionsConfig {
    fn default() -> Self {
        Self {
            command: "claude".to_string(),
            merge_worktree_with_conflicts: DEFAULT_MERGE_WORKTREE_WITH_CONFLICTS_PROMPT.to_string(),
            rebase_worktree_with_conflicts: DEFAULT_REBASE_WORKTREE_WITH_CONFLICTS_PROMPT.to_string(),
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

    /// Branch to create new worktrees from.
    /// - "auto" (default): Auto-detect default branch (main/master)
    /// - "current": Use the currently checked out branch
    /// - { "name": "branchname" }: Use a specific branch
    #[serde(rename = "baseBranch")]
    pub base_branch: BaseBranch,

    /// Configuration for copying files to new worktrees
    pub copy: CopyConfig,
}

impl Default for WorktreeConfig {
    fn default() -> Self {
        Self {
            directory: None,
            base_branch: BaseBranch::default(),
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
    #[serde(rename = "runTask")]
    pub run_task: Shortcut,
    #[serde(rename = "newWorkspace")]
    pub new_workspace: Shortcut,
    #[serde(rename = "switchFocus")]
    pub switch_focus: Shortcut,
    #[serde(rename = "taskSwitcher")]
    pub task_switcher: Shortcut,
    #[serde(rename = "expandDrawer")]
    pub expand_drawer: Shortcut,
    #[serde(rename = "previousView")]
    pub previous_view: Shortcut,
    #[serde(rename = "zoomIn")]
    pub zoom_in: Shortcut,
    #[serde(rename = "zoomOut")]
    pub zoom_out: Shortcut,
    #[serde(rename = "zoomReset")]
    pub zoom_reset: Shortcut,
}

/// Helper struct to extract just mappings from DEFAULT_CONFIG without recursion
#[derive(Deserialize)]
struct DefaultConfigMappings {
    mappings: MappingsConfigRaw,
}

/// Raw mappings struct without #[serde(default)] to avoid recursion
#[derive(Deserialize)]
struct MappingsConfigRaw {
    #[serde(rename = "toggleDrawer")]
    toggle_drawer: Shortcut,
    #[serde(rename = "toggleRightPanel")]
    toggle_right_panel: Shortcut,
    #[serde(rename = "terminalCopy")]
    terminal_copy: Shortcut,
    #[serde(rename = "terminalPaste")]
    terminal_paste: Shortcut,
    #[serde(rename = "worktreePrev")]
    worktree_prev: Shortcut,
    #[serde(rename = "worktreeNext")]
    worktree_next: Shortcut,
    #[serde(rename = "worktree1")]
    worktree_1: Shortcut,
    #[serde(rename = "worktree2")]
    worktree_2: Shortcut,
    #[serde(rename = "worktree3")]
    worktree_3: Shortcut,
    #[serde(rename = "worktree4")]
    worktree_4: Shortcut,
    #[serde(rename = "worktree5")]
    worktree_5: Shortcut,
    #[serde(rename = "worktree6")]
    worktree_6: Shortcut,
    #[serde(rename = "worktree7")]
    worktree_7: Shortcut,
    #[serde(rename = "worktree8")]
    worktree_8: Shortcut,
    #[serde(rename = "worktree9")]
    worktree_9: Shortcut,
    #[serde(rename = "runTask")]
    run_task: Shortcut,
    #[serde(rename = "newWorkspace")]
    new_workspace: Shortcut,
    #[serde(rename = "switchFocus")]
    switch_focus: Shortcut,
    #[serde(rename = "taskSwitcher")]
    task_switcher: Shortcut,
    #[serde(rename = "expandDrawer")]
    expand_drawer: Shortcut,
    #[serde(rename = "previousView")]
    previous_view: Shortcut,
    #[serde(rename = "zoomIn")]
    zoom_in: Shortcut,
    #[serde(rename = "zoomOut")]
    zoom_out: Shortcut,
    #[serde(rename = "zoomReset")]
    zoom_reset: Shortcut,
}

impl Default for MappingsConfig {
    fn default() -> Self {
        // Parse defaults from DEFAULT_CONFIG (single source of truth)
        let mut json = DEFAULT_CONFIG.to_string();
        if json_strip_comments::strip(&mut json).is_ok() {
            if let Ok(parsed) = serde_json::from_str::<DefaultConfigMappings>(&json) {
                let m = parsed.mappings;
                return Self {
                    toggle_drawer: m.toggle_drawer,
                    toggle_right_panel: m.toggle_right_panel,
                    terminal_copy: m.terminal_copy,
                    terminal_paste: m.terminal_paste,
                    worktree_prev: m.worktree_prev,
                    worktree_next: m.worktree_next,
                    worktree_1: m.worktree_1,
                    worktree_2: m.worktree_2,
                    worktree_3: m.worktree_3,
                    worktree_4: m.worktree_4,
                    worktree_5: m.worktree_5,
                    worktree_6: m.worktree_6,
                    worktree_7: m.worktree_7,
                    worktree_8: m.worktree_8,
                    worktree_9: m.worktree_9,
                    run_task: m.run_task,
                    new_workspace: m.new_workspace,
                    switch_focus: m.switch_focus,
                    task_switcher: m.task_switcher,
                    expand_drawer: m.expand_drawer,
                    previous_view: m.previous_view,
                    zoom_in: m.zoom_in,
                    zoom_out: m.zoom_out,
                    zoom_reset: m.zoom_reset,
                };
            }
        }
        // Fallback if parsing fails (shouldn't happen with valid DEFAULT_CONFIG)
        panic!("Failed to parse DEFAULT_CONFIG mappings - this is a bug");
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

fn parse_jsonc_value(content: &str) -> Result<serde_json::Value, String> {
    let mut json = content.to_string();
    json_strip_comments::strip(&mut json)
        .map_err(|e| format!("Failed to strip comments: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("{}", e))
}

/// Get all config file paths that should be watched for a given project
pub fn get_config_paths(project_path: Option<&str>) -> Vec<PathBuf> {
    let mut paths = vec![get_config_path()];

    if let Some(project_path) = project_path {
        let project_dir = Path::new(project_path);
        paths.push(project_dir.join(".onemanband").join("config.jsonc"));
        paths.push(project_dir.join(".onemanband").join("config.local.jsonc"));
    }

    paths
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
    load_config_with_errors(project_path).config
}

/// Load config with error reporting.
/// Returns both the config (with defaults for invalid parts) and any parse errors.
pub fn load_config_with_errors(project_path: Option<&str>) -> ConfigResult {
    use serde_json::Value;

    let mut errors = Vec::new();

    // Start with global config (or empty object if missing)
    let global_path = get_config_path();
    let mut merged: Value = if global_path.exists() {
        match std::fs::read_to_string(&global_path) {
            Ok(content) => match parse_jsonc_value(&content) {
                Ok(value) => value,
                Err(e) => {
                    errors.push(ConfigError {
                        file: global_path.display().to_string(),
                        message: e,
                    });
                    Value::Object(serde_json::Map::new())
                }
            },
            Err(e) => {
                errors.push(ConfigError {
                    file: global_path.display().to_string(),
                    message: format!("Failed to read file: {}", e),
                });
                Value::Object(serde_json::Map::new())
            }
        }
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
            match std::fs::read_to_string(&repo_config_path) {
                Ok(content) => match parse_jsonc_value(&content) {
                    Ok(repo_value) => deep_merge(&mut merged, &repo_value),
                    Err(e) => errors.push(ConfigError {
                        file: repo_config_path.display().to_string(),
                        message: e,
                    }),
                },
                Err(e) => errors.push(ConfigError {
                    file: repo_config_path.display().to_string(),
                    message: format!("Failed to read file: {}", e),
                }),
            }
        }

        // Local config: {project_path}/.onemanband/config.local.jsonc
        let local_config_path = project_dir.join(".onemanband").join("config.local.jsonc");
        if local_config_path.exists() {
            match std::fs::read_to_string(&local_config_path) {
                Ok(content) => match parse_jsonc_value(&content) {
                    Ok(local_value) => deep_merge(&mut merged, &local_value),
                    Err(e) => errors.push(ConfigError {
                        file: local_config_path.display().to_string(),
                        message: e,
                    }),
                },
                Err(e) => errors.push(ConfigError {
                    file: local_config_path.display().to_string(),
                    message: format!("Failed to read file: {}", e),
                }),
            }
        }
    }

    // Deserialize merged config, falling back to defaults
    let config = serde_json::from_value(merged).unwrap_or_default();

    ConfigResult { config, errors }
}
