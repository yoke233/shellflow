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

/// Raw config as stored in JSON (drawer has optional fields)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RawConfig {
    pub main: MainConfig,
    pub drawer: RawDrawerConfig,
    pub apps: AppsConfig,
    pub worktree: WorktreeConfig,
    pub navigation: NavigationConfig,
    pub indicators: IndicatorsConfig,
    pub tasks: Vec<TaskConfig>,
    pub actions: ActionsConfig,
    pub scratch: ScratchConfig,
    pub mappings: MappingsConfig,
    #[serde(rename = "unfocusedOpacity")]
    pub unfocused_opacity: f64,
}

impl Default for RawConfig {
    fn default() -> Self {
        Self {
            main: MainConfig::default(),
            drawer: RawDrawerConfig::default(),
            apps: AppsConfig::default(),
            worktree: WorktreeConfig::default(),
            navigation: NavigationConfig::default(),
            indicators: IndicatorsConfig::default(),
            tasks: Vec::new(),
            actions: ActionsConfig::default(),
            scratch: ScratchConfig::default(),
            mappings: MappingsConfig::default(),
            unfocused_opacity: 1.0,
        }
    }
}

/// Resolved config with all values populated
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub main: MainConfig,
    pub drawer: DrawerConfig,
    pub apps: AppsConfig,
    pub worktree: WorktreeConfig,
    pub navigation: NavigationConfig,
    pub indicators: IndicatorsConfig,
    pub tasks: Vec<TaskConfig>,
    pub actions: ActionsConfig,
    pub scratch: ScratchConfig,
    pub mappings: MappingsConfig,
    /// Opacity (0.0 to 1.0) applied to unfocused panes (main terminal or drawer)
    #[serde(rename = "unfocusedOpacity")]
    pub unfocused_opacity: f64,
}

impl Config {
    /// Resolve a RawConfig into a Config by inheriting drawer values from main
    pub fn from_raw(raw: RawConfig) -> Self {
        Self {
            drawer: DrawerConfig::from_raw(&raw.drawer, &raw.main),
            main: raw.main,
            apps: raw.apps,
            worktree: raw.worktree,
            navigation: raw.navigation,
            indicators: raw.indicators,
            tasks: raw.tasks,
            actions: raw.actions,
            scratch: raw.scratch,
            mappings: raw.mappings,
            unfocused_opacity: raw.unfocused_opacity,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::from_raw(RawConfig::default())
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct NavigationConfig {
    // Reserved for future navigation settings
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
pub struct ScratchConfig {
    /// Create a scratch terminal on app launch
    #[serde(rename = "startOnLaunch")]
    pub start_on_launch: bool,
}

impl Default for ScratchConfig {
    fn default() -> Self {
        Self {
            start_on_launch: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MainConfig {
    /// Command to run in the main terminal pane. If null, spawns the user's shell.
    pub command: Option<String>,
    #[serde(rename = "fontFamily")]
    pub font_family: String,
    #[serde(rename = "fontSize")]
    pub font_size: u16,
    #[serde(rename = "fontLigatures")]
    pub font_ligatures: bool,
    /// Padding around the terminal content in pixels
    pub padding: u16,
}

impl Default for MainConfig {
    fn default() -> Self {
        Self {
            command: None,
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            font_size: 13,
            font_ligatures: false,
            padding: 8,
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

    /// Focus the branch name input when creating a new worktree
    #[serde(rename = "focusNewBranchNames")]
    pub focus_new_branch_names: bool,

    /// Configuration for merge operations
    pub merge: MergeConfig,
}

impl Default for WorktreeConfig {
    fn default() -> Self {
        Self {
            directory: None,
            base_branch: BaseBranch::default(),
            copy: CopyConfig::default(),
            focus_new_branch_names: false,
            merge: MergeConfig::default(),
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

/// Raw drawer config as stored in JSON (fields optional, inherit from main)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RawDrawerConfig {
    #[serde(rename = "fontFamily", skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(rename = "fontSize", skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u16>,
    #[serde(rename = "fontLigatures", skip_serializing_if = "Option::is_none")]
    pub font_ligatures: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding: Option<u16>,
}

/// Resolved drawer config with all fields populated (inherits from main)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawerConfig {
    #[serde(rename = "fontFamily")]
    pub font_family: String,
    #[serde(rename = "fontSize")]
    pub font_size: u16,
    #[serde(rename = "fontLigatures")]
    pub font_ligatures: bool,
    /// Padding around the terminal content in pixels
    pub padding: u16,
}

impl DrawerConfig {
    /// Resolve drawer config by inheriting missing values from main config
    pub fn from_raw(raw: &RawDrawerConfig, main: &MainConfig) -> Self {
        Self {
            font_family: raw.font_family.clone().unwrap_or_else(|| main.font_family.clone()),
            font_size: raw.font_size.unwrap_or(main.font_size),
            font_ligatures: raw.font_ligatures.unwrap_or(main.font_ligatures),
            padding: raw.padding.unwrap_or(main.padding),
        }
    }
}

impl Default for DrawerConfig {
    fn default() -> Self {
        Self {
            font_family: "Menlo, Monaco, 'Courier New', monospace".to_string(),
            font_size: 13,
            font_ligatures: false,
            padding: 8,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppsConfig {
    /// Terminal application name (as recognized by the system)
    pub terminal: String,
    /// Code editor application name (as recognized by the system)
    pub editor: String,
}

impl Default for AppsConfig {
    fn default() -> Self {
        Self {
            terminal: "Ghostty".to_string(),
            editor: "Zed".to_string(),
        }
    }
}

/// A keyboard shortcut that can be platform-specific or universal.
/// Examples:
/// - Universal: "ctrl+`" or "F2"
/// - Platform-specific: { "mac": "cmd+n", "other": "ctrl+n" }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Shortcut {
    /// Same shortcut for all platforms
    Universal(String),
    /// Different shortcuts per platform
    Platform {
        mac: String,
        other: String,
    },
}

impl Shortcut {
    /// Get the shortcut string for the current platform
    pub fn for_current_platform(&self) -> &str {
        match self {
            Shortcut::Universal(s) => s,
            Shortcut::Platform { mac, other } => {
                if cfg!(target_os = "macos") {
                    mac
                } else {
                    other
                }
            }
        }
    }

    /// Convert config shortcut format to Tauri accelerator format.
    /// Config format: "ctrl+cmd+j", "cmd+shift+p", "F2"
    /// Tauri format: "Ctrl+Cmd+J", "CmdOrCtrl+Shift+P", "F2"
    pub fn to_accelerator(&self) -> String {
        let shortcut = self.for_current_platform();
        shortcut_to_accelerator(shortcut)
    }
}

/// Convert a shortcut string to Tauri accelerator format.
/// Config format uses lowercase with + separator: "ctrl+cmd+j", "cmd+shift+p"
/// Tauri format uses title case: "Ctrl+Cmd+J", "CmdOrCtrl+Shift+P"
pub fn shortcut_to_accelerator(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| {
            match part.to_lowercase().as_str() {
                "cmd" => "Cmd".to_string(),
                "ctrl" => "Ctrl".to_string(),
                "alt" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "escape" => "Escape".to_string(),
                "space" => "Space".to_string(),
                "enter" => "Enter".to_string(),
                "backspace" => "Backspace".to_string(),
                "tab" => "Tab".to_string(),
                // Function keys
                key if key.starts_with('f') && key.len() <= 3 => key.to_uppercase(),
                // Single character keys
                key if key.len() == 1 => key.to_uppercase(),
                // Special characters
                "`" => "`".to_string(),
                "'" => "'".to_string(),
                "\\" => "\\".to_string(),
                ";" => ";".to_string(),
                "=" => "=".to_string(),
                "-" => "-".to_string(),
                "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" => part.to_string(),
                // Fallback
                _ => part.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Keyboard shortcut mappings configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MappingsConfig {
    // App actions
    pub quit: Shortcut,
    #[serde(rename = "addProject")]
    pub add_project: Shortcut,
    #[serde(rename = "projectSwitcher")]
    pub project_switcher: Shortcut,

    // Session/Tab actions
    #[serde(rename = "newWorkspace")]
    pub new_workspace: Shortcut,
    #[serde(rename = "newScratchTerminal")]
    pub new_scratch_terminal: Shortcut,
    #[serde(rename = "newTab")]
    pub new_tab: Shortcut,
    #[serde(rename = "closeTab")]
    pub close_tab: Shortcut,

    // View actions
    #[serde(rename = "toggleDrawer")]
    pub toggle_drawer: Shortcut,
    #[serde(rename = "toggleRightPanel")]
    pub toggle_right_panel: Shortcut,
    #[serde(rename = "expandDrawer")]
    pub expand_drawer: Shortcut,
    #[serde(rename = "commandPalette")]
    pub command_palette: Shortcut,
    #[serde(rename = "zoomIn")]
    pub zoom_in: Shortcut,
    #[serde(rename = "zoomOut")]
    pub zoom_out: Shortcut,
    #[serde(rename = "zoomReset")]
    pub zoom_reset: Shortcut,

    // Navigation
    #[serde(rename = "worktreePrev")]
    pub worktree_prev: Shortcut,
    #[serde(rename = "worktreeNext")]
    pub worktree_next: Shortcut,
    #[serde(rename = "previousView")]
    pub previous_view: Shortcut,
    #[serde(rename = "switchFocus")]
    pub switch_focus: Shortcut,

    // Session navigation (sidebar)
    pub session1: Shortcut,
    pub session2: Shortcut,
    pub session3: Shortcut,
    pub session4: Shortcut,
    pub session5: Shortcut,
    pub session6: Shortcut,
    pub session7: Shortcut,
    pub session8: Shortcut,
    pub session9: Shortcut,

    // Worktree actions
    #[serde(rename = "renameBranch")]
    pub rename_branch: Shortcut,

    // Tasks
    #[serde(rename = "runTask")]
    pub run_task: Shortcut,
    #[serde(rename = "taskSwitcher")]
    pub task_switcher: Shortcut,
}

impl Default for MappingsConfig {
    fn default() -> Self {
        Self {
            // App actions
            quit: Shortcut::Platform {
                mac: "cmd+q".to_string(),
                other: "ctrl+q".to_string(),
            },
            add_project: Shortcut::Platform {
                mac: "cmd+o".to_string(),
                other: "ctrl+o".to_string(),
            },
            project_switcher: Shortcut::Platform {
                mac: "cmd+shift+o".to_string(),
                other: "ctrl+shift+o".to_string(),
            },

            // Session/Tab actions
            new_workspace: Shortcut::Platform {
                mac: "cmd+n".to_string(),
                other: "ctrl+n".to_string(),
            },
            new_scratch_terminal: Shortcut::Platform {
                mac: "cmd+shift+n".to_string(),
                other: "ctrl+shift+n".to_string(),
            },
            new_tab: Shortcut::Platform {
                mac: "cmd+t".to_string(),
                other: "ctrl+t".to_string(),
            },
            close_tab: Shortcut::Platform {
                mac: "cmd+w".to_string(),
                other: "ctrl+w".to_string(),
            },

            // View actions
            toggle_drawer: Shortcut::Universal("ctrl+`".to_string()),
            toggle_right_panel: Shortcut::Platform {
                mac: "cmd+b".to_string(),
                other: "ctrl+b".to_string(),
            },
            expand_drawer: Shortcut::Universal("shift+Escape".to_string()),
            command_palette: Shortcut::Platform {
                mac: "cmd+shift+p".to_string(),
                other: "ctrl+shift+p".to_string(),
            },
            zoom_in: Shortcut::Platform {
                mac: "cmd+=".to_string(),
                other: "ctrl+=".to_string(),
            },
            zoom_out: Shortcut::Platform {
                mac: "cmd+-".to_string(),
                other: "ctrl+-".to_string(),
            },
            zoom_reset: Shortcut::Platform {
                mac: "cmd+shift+0".to_string(),
                other: "ctrl+shift+0".to_string(),
            },

            // Navigation
            worktree_prev: Shortcut::Platform {
                mac: "ctrl+cmd+k".to_string(),
                other: "ctrl+shift+k".to_string(),
            },
            worktree_next: Shortcut::Platform {
                mac: "ctrl+cmd+j".to_string(),
                other: "ctrl+shift+j".to_string(),
            },
            previous_view: Shortcut::Platform {
                mac: "cmd+'".to_string(),
                other: "ctrl+'".to_string(),
            },
            switch_focus: Shortcut::Universal("ctrl+\\".to_string()),

            // Session navigation (sidebar) - these use ctrl+cmd on mac
            session1: Shortcut::Platform {
                mac: "ctrl+cmd+1".to_string(),
                other: "ctrl+1".to_string(),
            },
            session2: Shortcut::Platform {
                mac: "ctrl+cmd+2".to_string(),
                other: "ctrl+2".to_string(),
            },
            session3: Shortcut::Platform {
                mac: "ctrl+cmd+3".to_string(),
                other: "ctrl+3".to_string(),
            },
            session4: Shortcut::Platform {
                mac: "ctrl+cmd+4".to_string(),
                other: "ctrl+4".to_string(),
            },
            session5: Shortcut::Platform {
                mac: "ctrl+cmd+5".to_string(),
                other: "ctrl+5".to_string(),
            },
            session6: Shortcut::Platform {
                mac: "ctrl+cmd+6".to_string(),
                other: "ctrl+6".to_string(),
            },
            session7: Shortcut::Platform {
                mac: "ctrl+cmd+7".to_string(),
                other: "ctrl+7".to_string(),
            },
            session8: Shortcut::Platform {
                mac: "ctrl+cmd+8".to_string(),
                other: "ctrl+8".to_string(),
            },
            session9: Shortcut::Platform {
                mac: "ctrl+cmd+9".to_string(),
                other: "ctrl+9".to_string(),
            },

            // Worktree actions
            rename_branch: Shortcut::Universal("F2".to_string()),

            // Tasks
            run_task: Shortcut::Platform {
                mac: "cmd+r".to_string(),
                other: "ctrl+shift+r".to_string(),
            },
            task_switcher: Shortcut::Platform {
                mac: "cmd+;".to_string(),
                other: "ctrl+;".to_string(),
            },
        }
    }
}

pub fn get_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".config")
        .join("shellflow")
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
        paths.push(project_dir.join(".shellflow").join("config.jsonc"));
        paths.push(project_dir.join(".shellflow").join("config.local.jsonc"));
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
/// - Global: ~/.config/shellflow/config.jsonc
/// - Repo: {project_path}/.shellflow/config.jsonc (tracked in git)
/// - Local: {project_path}/.shellflow/config.local.jsonc (gitignored)
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

        // Repo config: {project_path}/.shellflow/config.jsonc
        let repo_config_path = project_dir.join(".shellflow").join("config.jsonc");
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

        // Local config: {project_path}/.shellflow/config.local.jsonc
        let local_config_path = project_dir.join(".shellflow").join("config.local.jsonc");
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

    // Deserialize merged config as RawConfig, then resolve to Config
    let raw_config: RawConfig = serde_json::from_value(merged).unwrap_or_default();
    let config = Config::from_raw(raw_config);

    ConfigResult { config, errors }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod shortcut_to_accelerator {
        use super::*;

        #[test]
        fn converts_simple_key() {
            assert_eq!(shortcut_to_accelerator("a"), "A");
            assert_eq!(shortcut_to_accelerator("z"), "Z");
        }

        #[test]
        fn converts_function_keys() {
            assert_eq!(shortcut_to_accelerator("F1"), "F1");
            assert_eq!(shortcut_to_accelerator("f2"), "F2");
            assert_eq!(shortcut_to_accelerator("F12"), "F12");
        }

        #[test]
        fn converts_modifiers() {
            assert_eq!(shortcut_to_accelerator("cmd+a"), "Cmd+A");
            assert_eq!(shortcut_to_accelerator("ctrl+b"), "Ctrl+B");
            assert_eq!(shortcut_to_accelerator("alt+c"), "Alt+C");
            assert_eq!(shortcut_to_accelerator("shift+d"), "Shift+D");
        }

        #[test]
        fn converts_multiple_modifiers() {
            assert_eq!(shortcut_to_accelerator("cmd+shift+p"), "Cmd+Shift+P");
            assert_eq!(shortcut_to_accelerator("ctrl+cmd+j"), "Ctrl+Cmd+J");
            assert_eq!(shortcut_to_accelerator("ctrl+alt+shift+f"), "Ctrl+Alt+Shift+F");
        }

        #[test]
        fn converts_special_characters() {
            assert_eq!(shortcut_to_accelerator("ctrl+`"), "Ctrl+`");
            assert_eq!(shortcut_to_accelerator("cmd+'"), "Cmd+'");
            assert_eq!(shortcut_to_accelerator("ctrl+\\"), "Ctrl+\\");
            assert_eq!(shortcut_to_accelerator("cmd+;"), "Cmd+;");
        }

        #[test]
        fn converts_number_keys() {
            assert_eq!(shortcut_to_accelerator("cmd+1"), "Cmd+1");
            assert_eq!(shortcut_to_accelerator("ctrl+cmd+9"), "Ctrl+Cmd+9");
        }

        #[test]
        fn converts_special_keys() {
            assert_eq!(shortcut_to_accelerator("shift+Escape"), "Shift+Escape");
            assert_eq!(shortcut_to_accelerator("cmd+="), "Cmd+=");
            assert_eq!(shortcut_to_accelerator("cmd+-"), "Cmd+-");
        }
    }

    mod shortcut {
        use super::*;

        #[test]
        fn universal_returns_same_for_all_platforms() {
            let shortcut = Shortcut::Universal("ctrl+`".to_string());
            assert_eq!(shortcut.for_current_platform(), "ctrl+`");
            assert_eq!(shortcut.to_accelerator(), "Ctrl+`");
        }

        #[test]
        fn platform_specific_returns_correct_variant() {
            let shortcut = Shortcut::Platform {
                mac: "cmd+n".to_string(),
                other: "ctrl+n".to_string(),
            };

            // The platform check happens at runtime
            let result = shortcut.for_current_platform();
            #[cfg(target_os = "macos")]
            assert_eq!(result, "cmd+n");
            #[cfg(not(target_os = "macos"))]
            assert_eq!(result, "ctrl+n");
        }

        #[test]
        fn deserializes_universal_shortcut() {
            let json = r#""ctrl+`""#;
            let shortcut: Shortcut = serde_json::from_str(json).unwrap();
            assert!(matches!(shortcut, Shortcut::Universal(_)));
            assert_eq!(shortcut.for_current_platform(), "ctrl+`");
        }

        #[test]
        fn deserializes_platform_specific_shortcut() {
            let json = r#"{"mac": "cmd+n", "other": "ctrl+n"}"#;
            let shortcut: Shortcut = serde_json::from_str(json).unwrap();
            assert!(matches!(shortcut, Shortcut::Platform { .. }));
        }

        #[test]
        fn serializes_universal_shortcut() {
            let shortcut = Shortcut::Universal("F2".to_string());
            let json = serde_json::to_string(&shortcut).unwrap();
            assert_eq!(json, r#""F2""#);
        }

        #[test]
        fn serializes_platform_specific_shortcut() {
            let shortcut = Shortcut::Platform {
                mac: "cmd+q".to_string(),
                other: "ctrl+q".to_string(),
            };
            let json = serde_json::to_string(&shortcut).unwrap();
            assert!(json.contains("mac"));
            assert!(json.contains("other"));
        }
    }

    mod mappings_config {
        use super::*;

        #[test]
        fn default_has_all_required_fields() {
            let mappings = MappingsConfig::default();

            // App actions
            assert!(!mappings.quit.for_current_platform().is_empty());
            assert!(!mappings.add_project.for_current_platform().is_empty());
            assert!(!mappings.project_switcher.for_current_platform().is_empty());

            // Session/Tab actions
            assert!(!mappings.new_workspace.for_current_platform().is_empty());
            assert!(!mappings.new_scratch_terminal.for_current_platform().is_empty());
            assert!(!mappings.new_tab.for_current_platform().is_empty());
            assert!(!mappings.close_tab.for_current_platform().is_empty());

            // Navigation
            assert!(!mappings.worktree_prev.for_current_platform().is_empty());
            assert!(!mappings.worktree_next.for_current_platform().is_empty());

            // Session navigation
            assert!(!mappings.session1.for_current_platform().is_empty());
            assert!(!mappings.session9.for_current_platform().is_empty());
        }

        #[test]
        fn worktree_nav_uses_ctrl_cmd_on_mac() {
            let mappings = MappingsConfig::default();

            if let Shortcut::Platform { mac, .. } = &mappings.worktree_next {
                assert!(mac.contains("ctrl+cmd"), "Expected ctrl+cmd in mac shortcut, got: {}", mac);
            } else {
                panic!("Expected Platform shortcut for worktree_next");
            }
        }

        #[test]
        fn deserializes_from_json() {
            let json = r#"{
                "quit": "cmd+q",
                "addProject": { "mac": "cmd+o", "other": "ctrl+o" }
            }"#;

            let mappings: MappingsConfig = serde_json::from_str(json).unwrap();
            assert_eq!(mappings.quit.for_current_platform(), "cmd+q");
        }

        #[test]
        fn defaults_missing_fields() {
            let json = r#"{}"#;
            let mappings: MappingsConfig = serde_json::from_str(json).unwrap();

            // Should have default values
            assert!(!mappings.quit.for_current_platform().is_empty());
            assert!(!mappings.command_palette.for_current_platform().is_empty());
        }
    }
}
