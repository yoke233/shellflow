use crate::state::{FileChange, FileStatus};
use git2::{Repository, Status, StatusOptions};
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("Not a git repository: {0}")]
    NotARepository(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub fn is_git_repo(path: &Path) -> bool {
    Repository::open(path).is_ok()
}

pub fn get_repo_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string()
}

pub fn get_default_branch(repo: &Repository) -> Result<String, GitError> {
    // Try to find the default branch (main or master)
    for branch_name in ["main", "master"] {
        if repo
            .find_branch(branch_name, git2::BranchType::Local)
            .is_ok()
        {
            return Ok(branch_name.to_string());
        }
    }

    // Fall back to HEAD
    let head = repo.head()?;
    if let Some(name) = head.shorthand() {
        return Ok(name.to_string());
    }

    Ok("main".to_string())
}

pub fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;

    // Get the default branch to branch from
    let default_branch = get_default_branch(&repo)?;

    // Create a new branch from the default branch
    let commit = repo
        .find_branch(&default_branch, git2::BranchType::Local)?
        .get()
        .peel_to_commit()?;

    let branch = repo.branch(branch_name, &commit, false)?;

    // Create the worktree
    repo.worktree(
        branch_name,
        worktree_path,
        Some(git2::WorktreeAddOptions::new().reference(Some(branch.get()))),
    )?;

    Ok(())
}

pub fn list_worktrees(repo_path: &Path) -> Result<Vec<String>, GitError> {
    let repo = Repository::open(repo_path)?;
    let worktrees = repo.worktrees()?;

    Ok(worktrees.iter().filter_map(|w| w.map(String::from)).collect())
}

pub fn delete_worktree(repo_path: &Path, worktree_name: &str) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;

    // Find and prune the worktree
    if let Ok(worktree) = repo.find_worktree(worktree_name) {
        // Remove the worktree directory first
        if let Ok(wt_path) = worktree.path().canonicalize() {
            let _ = std::fs::remove_dir_all(&wt_path);
        }

        // Prune the worktree reference
        worktree.prune(Some(
            git2::WorktreePruneOptions::new()
                .working_tree(true)
                .valid(true)
                .locked(false),
        ))?;
    }

    Ok(())
}

pub fn get_changed_files(workspace_path: &Path) -> Result<Vec<FileChange>, GitError> {
    let repo = Repository::open(workspace_path)?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut changes = Vec::new();

    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            let status = entry.status();
            let file_status = if status.contains(Status::INDEX_NEW) {
                // Staged new file
                FileStatus::Added
            } else if status.contains(Status::WT_NEW) {
                // Untracked file
                FileStatus::Untracked
            } else if status.contains(Status::WT_MODIFIED)
                || status.contains(Status::INDEX_MODIFIED)
            {
                FileStatus::Modified
            } else if status.contains(Status::WT_DELETED)
                || status.contains(Status::INDEX_DELETED)
            {
                FileStatus::Deleted
            } else if status.contains(Status::WT_RENAMED)
                || status.contains(Status::INDEX_RENAMED)
            {
                FileStatus::Renamed
            } else {
                continue;
            };

            changes.push(FileChange {
                path: path.to_string(),
                status: file_status,
            });
        }
    }

    Ok(changes)
}

/// Get a list of gitignored files and directories in the repository.
/// Uses `git status --ignored --porcelain` to get ignored entries.
/// Directories are returned with a trailing slash.
pub fn get_ignored_files(repo_path: &Path) -> Result<Vec<String>, GitError> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["status", "--ignored", "--porcelain"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            "git status failed",
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ignored_files = Vec::new();

    for line in stdout.lines() {
        // Ignored files start with "!! "
        if let Some(path) = line.strip_prefix("!! ") {
            ignored_files.push(path.to_string());
        }
    }

    Ok(ignored_files)
}
