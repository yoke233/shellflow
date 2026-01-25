use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Default mappings file content (embedded at compile time from frontend)
/// This is the source of truth for all default keybindings.
pub const DEFAULT_MAPPINGS: &str = include_str!("../../src/lib/defaultMappings.jsonc");

/// A binding group - a set of key bindings optionally scoped to a context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindingGroup {
    /// Context expression (e.g., "drawerFocused && !pickerOpen")
    /// If None, bindings are always active
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,

    /// Map of key sequences to actions
    pub bindings: HashMap<String, Action>,
}

/// An action - either a simple action ID or an action with arguments
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Action {
    /// Simple action: "drawer::closeTab"
    Simple(String),
    /// Action with arguments: ["navigate::toEntity", 0]
    WithArgs(Vec<serde_json::Value>),
}

/// Raw mappings file structure (matches the JSONC format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawMappings {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,

    /// Array of binding groups
    pub bindings: Vec<BindingGroup>,
}

/// Result of loading mappings
#[derive(Debug, Clone, Serialize)]
pub struct MappingsResult {
    /// The merged mappings (defaults + user)
    pub mappings: RawMappings,
    /// Any errors encountered while loading
    pub errors: Vec<MappingsError>,
}

/// An error from parsing a mappings file
#[derive(Debug, Clone, Serialize)]
pub struct MappingsError {
    pub file: String,
    pub message: String,
}

/// Get the path to the user's mappings.jsonc file
pub fn get_mappings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".config")
        .join("shellflow")
        .join("mappings.jsonc")
}

/// Parse JSONC content (strips comments first)
fn parse_jsonc<T: for<'de> Deserialize<'de>>(content: &str) -> Result<T, String> {
    let mut json = content.to_string();
    json_strip_comments::strip(&mut json)
        .map_err(|e| format!("Failed to strip comments: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("{}", e))
}

/// Load the default mappings (embedded at compile time)
fn load_default_mappings() -> Result<RawMappings, String> {
    parse_jsonc(DEFAULT_MAPPINGS)
}

/// Load user mappings from ~/.config/shellflow/mappings.jsonc
fn load_user_mappings() -> Result<Option<RawMappings>, MappingsError> {
    let path = get_mappings_path();

    if !path.exists() {
        return Ok(None);
    }

    match std::fs::read_to_string(&path) {
        Ok(content) => match parse_jsonc(&content) {
            Ok(mappings) => Ok(Some(mappings)),
            Err(e) => Err(MappingsError {
                file: path.display().to_string(),
                message: e,
            }),
        },
        Err(e) => Err(MappingsError {
            file: path.display().to_string(),
            message: format!("Failed to read file: {}", e),
        }),
    }
}

/// Merge user mappings on top of defaults.
/// User binding groups are appended after defaults, giving them higher priority.
fn merge_mappings(defaults: RawMappings, user: Option<RawMappings>) -> RawMappings {
    let mut bindings = defaults.bindings;

    if let Some(user_mappings) = user {
        // Append user bindings - they will take precedence due to
        // the "later wins" resolution order in the frontend
        bindings.extend(user_mappings.bindings);
    }

    RawMappings {
        schema: Some("https://raw.githubusercontent.com/shkm/shellflow/main/schemas/mappings.schema.json".to_string()),
        bindings,
    }
}

/// Load all mappings (defaults + user) with error reporting
pub fn load_mappings() -> MappingsResult {
    let mut errors = Vec::new();

    // Load defaults (should never fail since it's compiled in)
    let defaults = match load_default_mappings() {
        Ok(m) => m,
        Err(e) => {
            // This is a fatal error - defaults should always parse
            log::error!("Failed to parse default mappings: {}", e);
            return MappingsResult {
                mappings: RawMappings {
                    schema: None,
                    bindings: Vec::new(),
                },
                errors: vec![MappingsError {
                    file: "default_mappings.jsonc".to_string(),
                    message: e,
                }],
            };
        }
    };

    // Load user mappings (optional)
    let user = match load_user_mappings() {
        Ok(m) => m,
        Err(e) => {
            errors.push(e);
            None
        }
    };

    // Merge
    let mappings = merge_mappings(defaults, user);

    MappingsResult { mappings, errors }
}

/// Get paths to watch for mappings changes
pub fn get_mappings_watch_paths() -> Vec<PathBuf> {
    vec![get_mappings_path()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_default_mappings() {
        let result = load_default_mappings();
        assert!(result.is_ok(), "Failed to parse default mappings: {:?}", result.err());

        let mappings = result.unwrap();
        assert!(!mappings.bindings.is_empty(), "Default mappings should have bindings");
    }

    #[test]
    fn test_action_parsing() {
        let json = r#"{
            "bindings": [
                {
                    "bindings": {
                        "cmd-w": "drawer::closeTab",
                        "cmd-1": ["navigate::toEntity", 0]
                    }
                }
            ]
        }"#;

        let result: Result<RawMappings, _> = serde_json::from_str(json);
        assert!(result.is_ok());

        let mappings = result.unwrap();
        let group = &mappings.bindings[0];

        match group.bindings.get("cmd-w") {
            Some(Action::Simple(s)) => assert_eq!(s, "drawer::closeTab"),
            _ => panic!("Expected simple action"),
        }

        match group.bindings.get("cmd-1") {
            Some(Action::WithArgs(args)) => {
                assert_eq!(args.len(), 2);
                assert_eq!(args[0], serde_json::json!("navigate::toEntity"));
                assert_eq!(args[1], serde_json::json!(0));
            }
            _ => panic!("Expected action with args"),
        }
    }

    #[test]
    fn test_merge_mappings() {
        let defaults = RawMappings {
            schema: None,
            bindings: vec![BindingGroup {
                context: None,
                bindings: [("cmd-w".to_string(), Action::Simple("default::action".to_string()))]
                    .into_iter()
                    .collect(),
            }],
        };

        let user = RawMappings {
            schema: None,
            bindings: vec![BindingGroup {
                context: Some("drawerFocused".to_string()),
                bindings: [("cmd-w".to_string(), Action::Simple("user::action".to_string()))]
                    .into_iter()
                    .collect(),
            }],
        };

        let merged = merge_mappings(defaults, Some(user));

        // Should have both groups
        assert_eq!(merged.bindings.len(), 2);
        // User group should be last (higher priority)
        assert_eq!(merged.bindings[1].context, Some("drawerFocused".to_string()));
    }
}
