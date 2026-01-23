//! Template expansion utilities using minijinja.
//!
//! Provides Jinja2-style templating for configuration values like worktree directories.
//!
//! # Available Variables
//! - `repo_directory` - The repository root path
//! - `branch` - The branch name
//! - `worktree_name` - The worktree name (sanitized)
//!
//! # Available Filters
//! - `sanitize` - Replace `/` and `\` with `-` for filesystem-safe paths
//! - `hash_port` - Hash to deterministic port number (10000-19999)
//! - `shell_escape` - Escape for safe use in shell commands
//!
//! # Examples
//! ```text
//! {{ repo_directory }}/.worktrees/{{ branch | sanitize }}
//! PORT={{ branch | hash_port }}
//! echo "Working on {{ branch | shell_escape }}"
//! ```

use minijinja::{Environment, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Context for template expansion (worktree directory templates).
#[derive(Debug, Clone)]
pub struct TemplateContext {
    pub repo_directory: String,
    pub branch: Option<String>,
    pub worktree_name: Option<String>,
}


impl TemplateContext {
    pub fn new(repo_directory: impl Into<String>) -> Self {
        Self {
            repo_directory: repo_directory.into(),
            branch: None,
            worktree_name: None,
        }
    }

    pub fn with_branch(mut self, branch: impl Into<String>) -> Self {
        self.branch = Some(branch.into());
        self
    }

    pub fn with_worktree_name(mut self, name: impl Into<String>) -> Self {
        self.worktree_name = Some(name.into());
        self
    }
}

/// Hash a string to a deterministic port in range 10000-19999.
fn hash_port(value: String) -> u16 {
    let mut h = DefaultHasher::new();
    value.hash(&mut h);
    10000 + (h.finish() % 10000) as u16
}

/// Sanitize a string for use in filesystem paths.
/// Replaces `/` and `\` with `-`.
fn sanitize(value: Value) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .replace(['/', '\\'], "-")
}

/// Escape a string for safe use in shell commands.
fn shell_escape_filter(value: Value) -> String {
    let s = value.as_str().unwrap_or_default();
    shell_escape::escape(s.into()).into_owned()
}

/// Create a minijinja environment with custom filters registered.
fn create_environment() -> Environment<'static> {
    let mut env = Environment::new();

    // Register custom filters
    env.add_filter("hash_port", hash_port);
    env.add_filter("sanitize", sanitize);
    env.add_filter("shell_escape", shell_escape_filter);

    env
}

/// Expand a template string with the given context.
///
/// Returns the expanded string, or an error message if template parsing/rendering fails.
pub fn expand_template(template: &str, context: &TemplateContext) -> Result<String, String> {
    let env = create_environment();

    let tmpl = env
        .template_from_str(template)
        .map_err(|e| format!("Template syntax error: {}", e))?;

    let ctx = minijinja::context! {
        repo_directory => &context.repo_directory,
        branch => context.branch.as_deref().unwrap_or(""),
        worktree_name => context.worktree_name.as_deref().unwrap_or(""),
    };

    tmpl.render(ctx)
        .map_err(|e| format!("Template render error: {}", e))
}

/// Expand an action prompt template with the given context.
///
/// Accepts a minijinja Value as context, allowing each action to define its own variables.
/// Returns the expanded string, or an error message if template parsing/rendering fails.
pub fn expand_action_template(template: &str, context: Value) -> Result<String, String> {
    let env = create_environment();

    let tmpl = env
        .template_from_str(template)
        .map_err(|e| format!("Template syntax error: {}", e))?;

    tmpl.render(context)
        .map_err(|e| format!("Template render error: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_port_deterministic() {
        let port1 = hash_port("feature/foo".to_string());
        let port2 = hash_port("feature/foo".to_string());
        assert_eq!(port1, port2, "Same input should produce same port");
    }

    #[test]
    fn test_hash_port_range() {
        for input in ["main", "feature/foo", "", "a", "long-branch-name-123"] {
            let port = hash_port(input.to_string());
            assert!(
                (10000..20000).contains(&port),
                "Port {} out of range for input '{}'",
                port,
                input
            );
        }
    }

    #[test]
    fn test_hash_port_different_inputs() {
        let port1 = hash_port("feature/foo".to_string());
        let port2 = hash_port("feature/bar".to_string());
        // Different inputs should (almost certainly) produce different ports
        // This could theoretically fail due to hash collision, but is extremely unlikely
        assert_ne!(port1, port2, "Different inputs should produce different ports");
    }

    #[test]
    fn test_sanitize_slashes() {
        assert_eq!(sanitize(Value::from("feature/foo")), "feature-foo");
        assert_eq!(sanitize(Value::from("user\\task")), "user-task");
        assert_eq!(
            sanitize(Value::from("feature/user/task")),
            "feature-user-task"
        );
        assert_eq!(
            sanitize(Value::from("feature/user\\task")),
            "feature-user-task"
        );
    }

    #[test]
    fn test_sanitize_no_change() {
        assert_eq!(sanitize(Value::from("simple-branch")), "simple-branch");
        assert_eq!(sanitize(Value::from("main")), "main");
    }

    #[test]
    fn test_sanitize_edge_cases() {
        assert_eq!(sanitize(Value::from("")), "");
        assert_eq!(sanitize(Value::from("///")), "---");
        assert_eq!(sanitize(Value::from("/feature")), "-feature");
        assert_eq!(sanitize(Value::from("feature/")), "feature-");
    }

    #[test]
    fn test_expand_template_basic() {
        let ctx = TemplateContext::new("/home/user/myproject");
        let result = expand_template("{{ repo_directory }}/.worktrees", &ctx).unwrap();
        assert_eq!(result, "/home/user/myproject/.worktrees");
    }

    #[test]
    fn test_expand_template_with_branch() {
        let ctx = TemplateContext::new("/home/user/myproject").with_branch("feature/foo");
        let result =
            expand_template("{{ repo_directory }}/.worktrees/{{ branch | sanitize }}", &ctx)
                .unwrap();
        assert_eq!(result, "/home/user/myproject/.worktrees/feature-foo");
    }

    #[test]
    fn test_expand_template_with_worktree_name() {
        let ctx =
            TemplateContext::new("/home/user/myproject").with_worktree_name("happy-dolphin");
        let result =
            expand_template("{{ repo_directory }}/.worktrees/{{ worktree_name }}", &ctx).unwrap();
        assert_eq!(result, "/home/user/myproject/.worktrees/happy-dolphin");
    }

    #[test]
    fn test_expand_template_hash_port() {
        let ctx = TemplateContext::new("/repo").with_branch("feature/foo");
        let result = expand_template("PORT={{ branch | hash_port }}", &ctx).unwrap();
        // Should produce a port number in range
        let port_str = result.strip_prefix("PORT=").unwrap();
        let port: u16 = port_str.parse().expect("Should be a number");
        assert!((10000..20000).contains(&port));
    }

    #[test]
    fn test_expand_template_static() {
        let ctx = TemplateContext::new("/repo");
        let result = expand_template("/var/worktrees", &ctx).unwrap();
        assert_eq!(result, "/var/worktrees");
    }

    #[test]
    fn test_expand_template_syntax_error() {
        let ctx = TemplateContext::new("/repo");
        let result = expand_template("{{ unclosed", &ctx);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("syntax error"));
    }

    #[test]
    fn test_expand_template_backward_compat_no_spaces() {
        // Test that templates without spaces work (for backward compatibility)
        let ctx = TemplateContext::new("/home/user/myproject");
        let result = expand_template("{{repo_directory}}/.worktrees", &ctx).unwrap();
        assert_eq!(result, "/home/user/myproject/.worktrees");
    }

    #[test]
    fn test_shell_escape_simple() {
        // Simple strings pass through unchanged
        assert_eq!(shell_escape_filter(Value::from("main")), "main");
        assert_eq!(shell_escape_filter(Value::from("feature-foo")), "feature-foo");
    }

    #[test]
    fn test_shell_escape_special_chars() {
        // Shell metacharacters get escaped
        assert_eq!(shell_escape_filter(Value::from("test$(whoami)")), "'test$(whoami)'");
        assert_eq!(shell_escape_filter(Value::from("foo;rm -rf /")), "'foo;rm -rf /'");
        assert_eq!(shell_escape_filter(Value::from("a`id`b")), "'a`id`b'");
    }

    #[test]
    fn test_shell_escape_spaces() {
        assert_eq!(shell_escape_filter(Value::from("hello world")), "'hello world'");
    }

    #[test]
    fn test_shell_escape_quotes() {
        // Single quotes in input require special handling
        let result = shell_escape_filter(Value::from("it's"));
        assert!(result.contains("it") && result.contains("s"), "Should escape single quote: {}", result);
    }

    #[test]
    fn test_expand_template_shell_escape() {
        let ctx = TemplateContext::new("/repo").with_branch("test$(whoami)");
        let result = expand_template("echo {{ branch | shell_escape }}", &ctx).unwrap();
        assert_eq!(result, "echo 'test$(whoami)'");
    }
}
