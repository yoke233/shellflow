use crate::config::BaseBranch;
use crate::git;
use crate::state::{Project, Worktree};
use crate::template::{expand_template, TemplateContext};
use log::info;
use std::path::{Path, PathBuf};
use std::time::Instant;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum WorktreeError {
    #[error("Git error: {0}")]
    Git(#[from] git::GitError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not a git repository")]
    NotARepository,
    #[error("Worktree not found: {0}")]
    WorktreeNotFound(String),
    #[error("Could not generate unique branch name after {0} attempts")]
    NameGenerationFailed(u32),
    #[error("Template error: {0}")]
    Template(String),
}

/// Generate a random worktree name using petname (adjective-animal format)
pub fn generate_worktree_name() -> String {
    petname::petname(2, "-").unwrap_or_else(|| "quick-fox".to_string())
}

/// Generate a unique worktree name that doesn't conflict with existing branches
pub fn generate_unique_worktree_name(repo_path: &Path) -> Result<String, WorktreeError> {
    const MAX_ATTEMPTS: u32 = 100;

    for _ in 0..MAX_ATTEMPTS {
        let name = generate_worktree_name();
        match git::branch_exists(repo_path, &name) {
            Ok(false) => return Ok(name),
            Ok(true) => continue, // Branch exists, try another name
            Err(e) => return Err(WorktreeError::Git(e)),
        }
    }

    Err(WorktreeError::NameGenerationFailed(MAX_ATTEMPTS))
}

/// Resolve worktree directory with Jinja2 template support.
///
/// # Available Variables
/// - `repo_directory` - the repository directory
/// - `branch` - the branch name (if provided)
/// - `worktree_name` - the worktree name (if provided)
///
/// # Available Filters
/// - `sanitize` - replaces `/` and `\` with `-` for filesystem-safe names
/// - `hash_port` - hashes a string to a deterministic port in range 10000-19999
///
/// The final worktree path will be: {resolved_directory}/{worktree_name}
/// Default: {{ repo_directory }}/.worktrees
///
/// # Examples
/// ```text
/// {{ repo_directory }}/.worktrees/{{ branch | sanitize }}
/// ~/worktrees/{{ worktree_name }}
/// ```
pub fn resolve_worktree_directory(
    worktree_directory: Option<&str>,
    project_path: &Path,
    branch: Option<&str>,
    worktree_name: Option<&str>,
) -> Result<PathBuf, WorktreeError> {
    let repo_directory = project_path.to_string_lossy().to_string();
    let template = worktree_directory.unwrap_or("{{ repo_directory }}/.worktrees");

    let mut ctx = TemplateContext::new(&repo_directory);
    if let Some(b) = branch {
        ctx = ctx.with_branch(b);
    }
    if let Some(name) = worktree_name {
        ctx = ctx.with_worktree_name(name);
    }

    let resolved = expand_template(template, &ctx).map_err(WorktreeError::Template)?;

    // Expand ~ to home directory
    let path = if resolved.starts_with("~/") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(&resolved[2..])
    } else {
        PathBuf::from(resolved)
    };

    Ok(path)
}

pub fn create_project(path: &Path) -> Result<Project, WorktreeError> {
    if !git::is_git_repo(path) {
        return Err(WorktreeError::NotARepository);
    }

    Ok(Project {
        id: Uuid::new_v4().to_string(),
        name: git::get_repo_name(path),
        path: path.to_string_lossy().to_string(),
        worktrees: vec![],
        order: 0,
        is_active: true,
        last_accessed_at: Some(chrono_lite_now()),
    })
}

pub fn create_worktree(
    project: &mut Project,
    name: Option<String>,
    worktree_directory: Option<&str>,
    base_branch: &BaseBranch,
) -> Result<Worktree, WorktreeError> {
    let total_start = Instant::now();
    info!("[worktree::create_worktree] Starting...");

    let project_path = Path::new(&project.path);
    let worktree_name = match name {
        Some(n) => n,
        None => generate_unique_worktree_name(project_path)?,
    };
    info!("[worktree::create_worktree] worktree_name: {}", worktree_name);

    // Create worktree directory using template expansion
    let worktree_base = resolve_worktree_directory(
        worktree_directory,
        project_path,
        Some(&worktree_name), // branch name is the same as worktree name
        Some(&worktree_name),
    )?;
    let worktree_path = worktree_base.join(&worktree_name);

    let start = Instant::now();
    std::fs::create_dir_all(&worktree_base)?;
    info!("[worktree::create_worktree] create_dir_all took {:?}", start.elapsed());

    // Create git worktree
    let start = Instant::now();
    git::create_worktree(project_path, &worktree_path, &worktree_name, base_branch)?;
    info!("[worktree::create_worktree] git::create_worktree took {:?}", start.elapsed());

    let worktree = Worktree {
        id: Uuid::new_v4().to_string(),
        name: worktree_name.clone(),
        path: worktree_path.to_string_lossy().to_string(),
        branch: worktree_name,
        created_at: chrono_lite_now(),
        order: project.worktrees.len() as i32,
    };

    project.worktrees.push(worktree.clone());

    info!("[worktree::create_worktree] TOTAL took {:?}", total_start.elapsed());
    Ok(worktree)
}

/// Copy gitignored files from the project to the worktree, excluding patterns in `except`
pub fn copy_gitignored_files(
    project_path: &Path,
    worktree_path: &Path,
    except: &[String],
) -> Result<(), WorktreeError> {
    let total_start = Instant::now();
    info!("[copy_gitignored_files] Starting...");
    info!("[copy_gitignored_files] except patterns: {:?}", except);

    let start = Instant::now();
    let ignored_entries = git::get_ignored_files(project_path)?;
    info!("[copy_gitignored_files] get_ignored_files took {:?}, found {} entries", start.elapsed(), ignored_entries.len());

    // Compile glob patterns for exceptions
    let patterns: Vec<glob::Pattern> = except
        .iter()
        .filter_map(|p| glob::Pattern::new(p).ok())
        .collect();

    let mut copied_count = 0;
    let mut skipped_count = 0;
    let mut copy_time = std::time::Duration::ZERO;

    for entry in ignored_entries {
        // Remove trailing slash if present (directories come with trailing /)
        let file_path = entry.trim_end_matches('/');

        // Check if this path matches any exception pattern
        let should_skip = patterns.iter().any(|pattern| {
            // Match against the file path and also check if it starts with the pattern
            // (to handle directories like ".claude" matching ".claude/foo")
            pattern.matches(file_path)
                || file_path.starts_with(&format!("{}/", pattern.as_str()))
                || file_path == pattern.as_str()
        });

        if should_skip {
            skipped_count += 1;
            continue;
        }

        let src = project_path.join(file_path);
        let dst = worktree_path.join(file_path);

        // Skip if source doesn't exist (shouldn't happen, but be safe)
        if !src.exists() {
            continue;
        }

        // Create parent directories if needed
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Copy file or directory
        let start = Instant::now();
        if src.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
        copy_time += start.elapsed();
        copied_count += 1;
    }

    info!("[copy_gitignored_files] Copied {} entries, skipped {} entries", copied_count, skipped_count);
    info!("[copy_gitignored_files] Total copy time: {:?}", copy_time);
    info!("[copy_gitignored_files] TOTAL took {:?}", total_start.elapsed());
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

pub fn delete_worktree(project: &mut Project, worktree_id: &str) -> Result<(), WorktreeError> {
    let worktree_idx = project
        .worktrees
        .iter()
        .position(|w| w.id == worktree_id)
        .ok_or_else(|| WorktreeError::WorktreeNotFound(worktree_id.to_string()))?;

    let worktree = &project.worktrees[worktree_idx];

    // Delete worktree
    let project_path = Path::new(&project.path);
    git::delete_worktree(project_path, &worktree.name)?;

    // Remove worktree directory if it still exists
    let worktree_path = Path::new(&worktree.path);
    if worktree_path.exists() {
        std::fs::remove_dir_all(worktree_path)?;
    }

    project.worktrees.remove(worktree_idx);

    Ok(())
}

// Simple timestamp without external chrono dependency
pub fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Convert to ISO-8601-ish format (simplified)
    let days_since_1970 = secs / 86400;
    let years = 1970 + days_since_1970 / 365;
    let remaining_days = days_since_1970 % 365;
    let month = (remaining_days / 30) + 1;
    let day = (remaining_days % 30) + 1;
    let hour = (secs % 86400) / 3600;
    let min = (secs % 3600) / 60;
    let sec = secs % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        years, month, day, hour, min, sec
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_generate_worktree_name_format() {
        let name = generate_worktree_name();
        // Should be in adjective-animal format with hyphen separator
        assert!(name.contains('-'), "Name should contain hyphen: {}", name);
        let parts: Vec<&str> = name.split('-').collect();
        assert_eq!(parts.len(), 2, "Name should have exactly 2 parts: {}", name);
        assert!(!parts[0].is_empty(), "First part should not be empty");
        assert!(!parts[1].is_empty(), "Second part should not be empty");
    }

    #[test]
    fn test_generate_worktree_name_uniqueness() {
        // Generate several names and ensure they're not all the same
        let names: Vec<String> = (0..10).map(|_| generate_worktree_name()).collect();
        let unique_count = names.iter().collect::<std::collections::HashSet<_>>().len();
        // With random generation, we should get mostly unique names
        assert!(unique_count > 1, "Names should have some variety");
    }

    #[test]
    fn test_resolve_worktree_directory_default() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result = resolve_worktree_directory(None, &project_path, None, None).unwrap();
        assert_eq!(result, PathBuf::from("/home/user/myproject/.worktrees"));
    }

    #[test]
    fn test_resolve_worktree_directory_with_placeholder() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result = resolve_worktree_directory(
            Some("{{ repo_directory }}/.worktrees"),
            &project_path,
            None,
            None,
        )
        .unwrap();
        assert_eq!(result, PathBuf::from("/home/user/myproject/.worktrees"));
    }

    #[test]
    fn test_resolve_worktree_directory_no_spaces_placeholder() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result = resolve_worktree_directory(
            Some("{{repo_directory}}/trees"),
            &project_path,
            None,
            None,
        )
        .unwrap();
        assert_eq!(result, PathBuf::from("/home/user/myproject/trees"));
    }

    #[test]
    fn test_resolve_worktree_directory_absolute_path() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result =
            resolve_worktree_directory(Some("/var/worktrees"), &project_path, None, None).unwrap();
        assert_eq!(result, PathBuf::from("/var/worktrees"));
    }

    #[test]
    fn test_resolve_worktree_directory_tilde_expansion() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result =
            resolve_worktree_directory(Some("~/worktrees"), &project_path, None, None).unwrap();
        // Should expand ~ to home directory
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        assert_eq!(result, home.join("worktrees"));
    }

    #[test]
    fn test_resolve_worktree_directory_with_branch_sanitize() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result = resolve_worktree_directory(
            Some("{{ repo_directory }}/.worktrees/{{ branch | sanitize }}"),
            &project_path,
            Some("feature/foo"),
            None,
        )
        .unwrap();
        assert_eq!(
            result,
            PathBuf::from("/home/user/myproject/.worktrees/feature-foo")
        );
    }

    #[test]
    fn test_resolve_worktree_directory_with_worktree_name() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result = resolve_worktree_directory(
            Some("{{ repo_directory }}/.worktrees/{{ worktree_name }}"),
            &project_path,
            None,
            Some("happy-dolphin"),
        )
        .unwrap();
        assert_eq!(
            result,
            PathBuf::from("/home/user/myproject/.worktrees/happy-dolphin")
        );
    }

    #[test]
    fn test_resolve_worktree_directory_hash_port() {
        let project_path = PathBuf::from("/home/user/myproject");
        let result = resolve_worktree_directory(
            Some("/tmp/worktrees/{{ branch | hash_port }}"),
            &project_path,
            Some("feature/foo"),
            None,
        )
        .unwrap();
        // The path should contain a port number
        let path_str = result.to_string_lossy();
        assert!(path_str.starts_with("/tmp/worktrees/"));
        let port_str = path_str.strip_prefix("/tmp/worktrees/").unwrap();
        let port: u16 = port_str.parse().expect("Should be a port number");
        assert!((10000..20000).contains(&port));
    }

    #[test]
    fn test_chrono_lite_now_format() {
        let timestamp = chrono_lite_now();
        // Should be in ISO-8601 format: YYYY-MM-DDTHH:MM:SSZ
        assert!(timestamp.len() == 20, "Timestamp should be 20 chars: {}", timestamp);
        assert!(timestamp.ends_with('Z'), "Timestamp should end with Z");
        assert!(timestamp.contains('T'), "Timestamp should contain T separator");

        // Verify it can be parsed as expected format
        let parts: Vec<&str> = timestamp.split('T').collect();
        assert_eq!(parts.len(), 2);

        let date_parts: Vec<&str> = parts[0].split('-').collect();
        assert_eq!(date_parts.len(), 3);
        assert!(date_parts[0].parse::<u32>().is_ok(), "Year should be numeric");
        assert!(date_parts[1].parse::<u32>().is_ok(), "Month should be numeric");
        assert!(date_parts[2].parse::<u32>().is_ok(), "Day should be numeric");
    }
}
