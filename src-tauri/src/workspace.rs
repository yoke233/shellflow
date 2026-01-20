use crate::git;
use crate::state::{Project, Workspace};
use rand::seq::SliceRandom;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum WorkspaceError {
    #[error("Git error: {0}")]
    Git(#[from] git::GitError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not a git repository")]
    NotARepository,
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),
}

// Fun random name generator for workspaces
const ADJECTIVES: &[&str] = &[
    "fuzzy", "quick", "lazy", "happy", "sleepy", "brave", "calm", "eager",
    "gentle", "jolly", "keen", "lively", "merry", "noble", "proud", "swift",
    "witty", "zesty", "agile", "bold", "cosmic", "daring", "epic", "fierce",
];

const ANIMALS: &[&str] = &[
    "tiger", "bear", "fox", "wolf", "eagle", "hawk", "owl", "panda",
    "koala", "otter", "seal", "whale", "dolphin", "falcon", "raven", "lynx",
    "badger", "ferret", "marten", "stoat", "heron", "crane", "swan", "robin",
];

pub fn generate_workspace_name() -> String {
    let mut rng = rand::thread_rng();
    let adj = ADJECTIVES.choose(&mut rng).unwrap_or(&"quick");
    let animal = ANIMALS.choose(&mut rng).unwrap_or(&"fox");
    format!("{}-{}", adj, animal)
}

/// Resolve worktree directory with placeholder support.
/// Supported placeholders:
/// - {{ repo_directory }} - the repository directory
///
/// The final worktree path will be: {resolved_directory}/{workspace_name}
/// Default: {{ repo_directory }}/.worktrees
pub fn resolve_worktree_directory(
    worktree_directory: Option<&str>,
    project_path: &Path,
) -> PathBuf {
    let repo_directory = project_path.to_string_lossy().to_string();

    let dir = worktree_directory.unwrap_or("{{ repo_directory }}/.worktrees");

    let resolved = dir
        .replace("{{ repo_directory }}", &repo_directory)
        .replace("{{repo_directory}}", &repo_directory);

    // Expand ~ to home directory
    if resolved.starts_with("~/") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(&resolved[2..])
    } else {
        PathBuf::from(resolved)
    }
}

pub fn create_project(path: &Path) -> Result<Project, WorkspaceError> {
    if !git::is_git_repo(path) {
        return Err(WorkspaceError::NotARepository);
    }

    Ok(Project {
        id: Uuid::new_v4().to_string(),
        name: git::get_repo_name(path),
        path: path.to_string_lossy().to_string(),
        workspaces: vec![],
    })
}

pub fn create_workspace(
    project: &mut Project,
    name: Option<String>,
    worktree_directory: Option<&str>,
) -> Result<Workspace, WorkspaceError> {
    let workspace_name = name.unwrap_or_else(generate_workspace_name);

    // Create workspace directory
    let project_path = Path::new(&project.path);
    let worktree_base = resolve_worktree_directory(worktree_directory, project_path);
    let workspace_path = worktree_base.join(&workspace_name);

    std::fs::create_dir_all(&worktree_base)?;

    // Create git worktree
    git::create_worktree(project_path, &workspace_path, &workspace_name)?;

    let workspace = Workspace {
        id: Uuid::new_v4().to_string(),
        name: workspace_name.clone(),
        path: workspace_path.to_string_lossy().to_string(),
        branch: workspace_name,
        created_at: chrono_lite_now(),
    };

    project.workspaces.push(workspace.clone());

    Ok(workspace)
}

/// Copy gitignored files from the project to the workspace, excluding patterns in `except`
pub fn copy_gitignored_files(
    project_path: &Path,
    workspace_path: &Path,
    except: &[String],
) -> Result<(), WorkspaceError> {
    let ignored_entries = git::get_ignored_files(project_path)?;

    // Compile glob patterns for exceptions
    let patterns: Vec<glob::Pattern> = except
        .iter()
        .filter_map(|p| glob::Pattern::new(p).ok())
        .collect();

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
            continue;
        }

        let src = project_path.join(file_path);
        let dst = workspace_path.join(file_path);

        // Skip if source doesn't exist (shouldn't happen, but be safe)
        if !src.exists() {
            continue;
        }

        // Create parent directories if needed
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Copy file or directory
        if src.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }

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

pub fn delete_workspace(project: &mut Project, workspace_id: &str) -> Result<(), WorkspaceError> {
    let workspace_idx = project
        .workspaces
        .iter()
        .position(|w| w.id == workspace_id)
        .ok_or_else(|| WorkspaceError::WorkspaceNotFound(workspace_id.to_string()))?;

    let workspace = &project.workspaces[workspace_idx];

    // Delete worktree
    let project_path = Path::new(&project.path);
    git::delete_worktree(project_path, &workspace.name)?;

    // Remove workspace directory if it still exists
    let workspace_path = Path::new(&workspace.path);
    if workspace_path.exists() {
        std::fs::remove_dir_all(workspace_path)?;
    }

    project.workspaces.remove(workspace_idx);

    Ok(())
}

// Simple timestamp without external chrono dependency
fn chrono_lite_now() -> String {
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
