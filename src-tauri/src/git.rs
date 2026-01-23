use crate::config::{BaseBranch, BaseBranchMode, MergeStrategy};
use crate::state::{FileChange, FileStatus};
use git2::{BranchType, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Merge conflict: {0}")]
    MergeConflict(String),
    #[error("Branch not found: {0}")]
    BranchNotFound(String),
    #[error("Repository has uncommitted changes")]
    UncommittedChanges,
}

/// Result of checking merge feasibility
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeFeasibility {
    /// Whether the merge/rebase can proceed
    pub can_merge: bool,
    /// Whether there are uncommitted changes
    pub has_uncommitted_changes: bool,
    /// Whether the branch is up-to-date with target (nothing to merge)
    pub is_up_to_date: bool,
    /// Whether fast-forward merge is possible
    pub can_fast_forward: bool,
    /// Number of commits ahead of target
    pub commits_ahead: usize,
    /// Number of commits behind target
    pub commits_behind: usize,
    /// The current branch name
    pub current_branch: String,
    /// The target branch name
    pub target_branch: String,
    /// Error message if any
    pub error: Option<String>,
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

pub fn get_current_branch(repo: &Repository) -> Result<String, GitError> {
    let head = repo.head()?;
    head.shorthand()
        .map(String::from)
        .ok_or_else(|| {
            GitError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "HEAD is not a branch",
            ))
        })
}

/// Resolve a BaseBranch config to an actual branch name
pub fn resolve_target_branch(repo: &Repository, base_branch: &BaseBranch) -> Result<String, GitError> {
    match base_branch {
        BaseBranch::Mode(BaseBranchMode::Auto) => get_default_branch(repo),
        BaseBranch::Mode(BaseBranchMode::Current) => get_current_branch(repo),
        BaseBranch::Named { name } => {
            // Verify the branch exists
            if repo.find_branch(name, BranchType::Local).is_err() {
                return Err(GitError::BranchNotFound(name.clone()));
            }
            Ok(name.clone())
        }
    }
}

/// Check if a branch with the given name exists
pub fn branch_exists(repo_path: &Path, branch_name: &str) -> Result<bool, GitError> {
    let repo = Repository::open(repo_path)?;
    let exists = repo.find_branch(branch_name, BranchType::Local).is_ok();
    Ok(exists)
}

pub fn create_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    base_branch: &BaseBranch,
) -> Result<(), GitError> {
    use std::process::Command;

    log::info!("[git::create_worktree] Creating worktree at {:?}", worktree_path);

    // Check for modified/staged changes before proceeding using libgit2
    // (read-only operation, no lock issues)
    {
        let repo = Repository::open(repo_path)?;
        let has_changes = has_modified_or_staged_changes(&repo)?;
        log::info!("[git::create_worktree] has_modified_or_staged_changes: {}", has_changes);
        if has_changes {
            log::info!("[git::create_worktree] Returning UncommittedChanges error");
            return Err(GitError::UncommittedChanges);
        }
    }

    // Resolve the base branch to branch from based on config
    let source_branch = {
        let repo = Repository::open(repo_path)?;
        match base_branch {
            BaseBranch::Mode(BaseBranchMode::Auto) => get_default_branch(&repo)?,
            BaseBranch::Mode(BaseBranchMode::Current) => get_current_branch(&repo)?,
            BaseBranch::Named { name } => {
                // Verify the branch exists
                if repo.find_branch(name, BranchType::Local).is_err() {
                    return Err(GitError::BranchNotFound(name.clone()));
                }
                name.clone()
            }
        }
    };
    log::info!("[git::create_worktree] Using source branch: {}", source_branch);

    // Use git CLI for worktree creation - handles locking properly
    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            branch_name,
            &worktree_path.to_string_lossy(),
            &source_branch,
        ])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git worktree add failed: {}", stderr),
        )));
    }

    log::info!("[git::create_worktree] Worktree created successfully");
    Ok(())
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

pub fn get_changed_files(worktree_path: &Path) -> Result<Vec<FileChange>, GitError> {
    use std::collections::HashMap;
    use std::process::Command;

    let repo = Repository::open(worktree_path)?;

    // Get diff stats using git diff --numstat (for both staged and unstaged)
    let mut diff_stats: HashMap<String, (usize, usize)> = HashMap::new();

    // Unstaged changes
    if let Ok(output) = Command::new("git")
        .args(["diff", "--numstat"])
        .current_dir(worktree_path)
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 3 {
                    let insertions = parts[0].parse().unwrap_or(0);
                    let deletions = parts[1].parse().unwrap_or(0);
                    let path = parts[2].to_string();
                    diff_stats.insert(path, (insertions, deletions));
                }
            }
        }
    }

    // Staged changes
    if let Ok(output) = Command::new("git")
        .args(["diff", "--cached", "--numstat"])
        .current_dir(worktree_path)
        .output()
    {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 3 {
                    let insertions = parts[0].parse().unwrap_or(0);
                    let deletions = parts[1].parse().unwrap_or(0);
                    let path = parts[2].to_string();
                    let entry = diff_stats.entry(path).or_insert((0, 0));
                    entry.0 += insertions;
                    entry.1 += deletions;
                }
            }
        }
    }

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

            let (insertions, deletions) = diff_stats.get(path).copied().unwrap_or((0, 0));

            changes.push(FileChange {
                path: path.to_string(),
                status: file_status,
                insertions: if insertions > 0 || deletions > 0 { Some(insertions) } else { None },
                deletions: if insertions > 0 || deletions > 0 { Some(deletions) } else { None },
            });
        }
    }

    Ok(changes)
}

/// Get list of files with merge conflicts in the worktree.
pub fn get_conflicted_files(worktree_path: &Path) -> Result<Vec<String>, GitError> {
    use std::process::Command;

    // Use git diff to find unmerged files - more reliable than libgit2 status
    let output = Command::new("git")
        .args(["diff", "--name-only", "--diff-filter=U"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| GitError::Io(e))?;

    if !output.status.success() {
        return Ok(Vec::new());
    }

    let conflicts: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(|s| s.to_string())
        .collect();

    Ok(conflicts)
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

/// Check if a merge or rebase is feasible for a worktree branch
pub fn check_merge_feasibility(worktree_path: &Path, base_branch: &BaseBranch) -> Result<MergeFeasibility, GitError> {
    let repo = Repository::open(worktree_path)?;

    // Get current branch name
    let head = repo.head()?;
    let current_branch = head
        .shorthand()
        .ok_or_else(|| GitError::BranchNotFound("HEAD".to_string()))?
        .to_string();

    // Get target branch from config
    let target_branch = resolve_target_branch(&repo, base_branch)?;

    // If we're on the default branch, nothing to merge
    if current_branch == target_branch {
        return Ok(MergeFeasibility {
            can_merge: false,
            has_uncommitted_changes: false,
            is_up_to_date: true,
            can_fast_forward: false,
            commits_ahead: 0,
            commits_behind: 0,
            current_branch,
            target_branch,
            error: Some("Already on the default branch".to_string()),
        });
    }

    // Check for uncommitted changes
    let has_uncommitted_changes = has_uncommitted_changes(&repo)?;

    // Get the commits for both branches
    let current_commit = head.peel_to_commit()?;
    let target_branch_ref = repo.find_branch(&target_branch, BranchType::Local)?;
    let target_commit = target_branch_ref.get().peel_to_commit()?;

    // Find merge base
    let merge_base = repo.merge_base(current_commit.id(), target_commit.id())?;

    // Calculate ahead/behind
    let (commits_ahead, commits_behind) =
        repo.graph_ahead_behind(current_commit.id(), target_commit.id())?;

    // Check if up-to-date (current branch has no commits ahead of target)
    let is_up_to_date = commits_ahead == 0;

    // Check if fast-forward is possible (target hasn't diverged)
    let can_fast_forward = merge_base == target_commit.id();

    // Can merge if there are commits to merge and no uncommitted changes
    let can_merge = commits_ahead > 0 && !has_uncommitted_changes;

    Ok(MergeFeasibility {
        can_merge,
        has_uncommitted_changes,
        is_up_to_date,
        can_fast_forward,
        commits_ahead,
        commits_behind,
        current_branch,
        target_branch,
        error: None,
    })
}

/// Check if repository has uncommitted changes
pub fn has_uncommitted_changes_at_path(repo_path: &Path) -> Result<bool, GitError> {
    let repo = Repository::open(repo_path)?;
    has_uncommitted_changes(&repo)
}

fn has_uncommitted_changes(repo: &Repository) -> Result<bool, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(!statuses.is_empty())
}

/// Check if repository has modified or staged changes (excludes untracked files)
/// This is used for worktree creation where untracked files don't matter
fn has_modified_or_staged_changes(repo: &Repository) -> Result<bool, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;

    // Debug: log what files are being detected
    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            log::info!("[has_modified_or_staged_changes] Found: {} with status {:?}", path, entry.status());
        }
    }

    log::info!("[has_modified_or_staged_changes] Total files found: {}", statuses.len());
    Ok(!statuses.is_empty())
}

/// Stash uncommitted changes in a repository using git CLI.
/// Returns a unique stash ID that can be used with `stash_pop` to restore the correct stash.
pub fn stash_changes(repo_path: &Path) -> Result<String, GitError> {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    // Generate unique stash ID using timestamp + random suffix
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let stash_id = format!("onemanband-auto-stash-{}", timestamp);

    log::info!("[stash_changes] Stashing changes in {:?} with id {}", repo_path, stash_id);

    let output = Command::new("git")
        .args(["stash", "push", "--include-untracked", "-m", &stash_id])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git stash failed: {}", stderr),
        )));
    }

    log::info!("[stash_changes] Stash successful with id {}", stash_id);
    Ok(stash_id)
}

/// Pop a specific stash by its ID (message).
/// Finds the stash with the matching message and pops it.
pub fn stash_pop(repo_path: &Path, stash_id: &str) -> Result<(), GitError> {
    use std::process::Command;

    log::info!("[stash_pop] Looking for stash with id {} in {:?}", stash_id, repo_path);

    // List stashes to find the one with our ID
    let output = Command::new("git")
        .args(["stash", "list"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git stash list failed: {}", stderr),
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Find the stash index that matches our ID
    // Format: "stash@{0}: On branch: message"
    let stash_ref = stdout
        .lines()
        .find(|line| line.contains(stash_id))
        .and_then(|line| line.split(':').next())
        .map(|s| s.trim().to_string());

    let Some(stash_ref) = stash_ref else {
        log::warn!("[stash_pop] Stash with id {} not found, nothing to pop", stash_id);
        return Ok(());
    };

    log::info!("[stash_pop] Found stash at {}, popping", stash_ref);

    let output = Command::new("git")
        .args(["stash", "pop", &stash_ref])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git stash pop failed: {}", stderr),
        )));
    }

    log::info!("[stash_pop] Stash pop successful");
    Ok(())
}

/// Merge the current branch into the target branch
/// This performs: checkout target, merge current, checkout current
pub fn merge_branch_to_target(
    worktree_path: &Path,
    repo_path: &Path,
) -> Result<(), GitError> {
    use std::process::Command;

    // Use git CLI for merge operations as libgit2 merge is complex
    // First, get current branch name
    let (current_branch, target_branch) = {
        let repo = Repository::open(worktree_path)?;
        let head = repo.head()?;
        let current = head
            .shorthand()
            .ok_or_else(|| GitError::BranchNotFound("HEAD".to_string()))?
            .to_string();
        let target = get_default_branch(&repo)?;
        (current, target)
    };

    // Checkout target branch in main repo
    let output = Command::new("git")
        .args(["checkout", &target_branch])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!(
                "Failed to checkout {}: {}",
                target_branch,
                String::from_utf8_lossy(&output.stderr)
            ),
        )));
    }

    // Merge the worktree branch
    let output = Command::new("git")
        .args(["merge", "--no-edit", &current_branch])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        // Don't abort here - leave conflicts for resolution (AI or manual)
        // Caller should call abort_merge if user cancels without resolving
        return Err(GitError::MergeConflict(format!(
            "Merge failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(())
}

/// Abort an in-progress merge operation
pub fn abort_merge(repo_path: &Path) -> Result<(), GitError> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["merge", "--abort"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        // It's okay if abort fails (e.g., no merge in progress)
        // Just log and continue
    }

    Ok(())
}

/// Abort an in-progress rebase operation
pub fn abort_rebase(repo_path: &Path) -> Result<(), GitError> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["rebase", "--abort"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        // It's okay if abort fails (e.g., no rebase in progress)
        // Just log and continue
    }

    Ok(())
}

/// Check if a rebase is in progress at the given path
pub fn is_rebase_in_progress(repo_path: &Path) -> bool {
    // Check for .git/rebase-merge (interactive rebase) or .git/rebase-apply (non-interactive)
    let git_dir = repo_path.join(".git");
    git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists()
}

/// Check if a merge is in progress at the given path
pub fn is_merge_in_progress(repo_path: &Path) -> bool {
    repo_path.join(".git").join("MERGE_HEAD").exists()
}

/// Rebase the current branch onto the target branch
pub fn rebase_branch_onto_target(
    worktree_path: &Path,
) -> Result<(), GitError> {
    use std::process::Command;

    let repo = Repository::open(worktree_path)?;
    let target_branch = get_default_branch(&repo)?;
    drop(repo);

    // Rebase onto target branch
    let output = Command::new("git")
        .args(["rebase", &target_branch])
        .current_dir(worktree_path)
        .output()?;

    if !output.status.success() {
        // Don't abort here - leave conflicts for resolution (AI or manual)
        // Caller should call abort_rebase if user cancels without resolving
        return Err(GitError::MergeConflict(format!(
            "Rebase failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(())
}

/// Delete a local branch
pub fn delete_local_branch(repo_path: &Path, branch_name: &str) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;

    let mut branch = repo.find_branch(branch_name, BranchType::Local)?;
    branch.delete()?;

    Ok(())
}

/// Delete a remote branch by pushing a delete refspec
pub fn delete_remote_branch(repo_path: &Path, branch_name: &str) -> Result<(), GitError> {
    use std::process::Command;

    let output = Command::new("git")
        .args(["push", "origin", "--delete", branch_name])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Don't fail if branch doesn't exist on remote
        if !stderr.contains("remote ref does not exist") {
            return Err(GitError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to delete remote branch: {}", stderr),
            )));
        }
    }

    Ok(())
}

/// Validate a git branch name according to git's rules
/// Returns None if valid, Some(error_message) if invalid
pub fn validate_branch_name(name: &str) -> Option<String> {
    // Empty or too long
    if name.is_empty() {
        return Some("Branch name cannot be empty".to_string());
    }
    if name.len() > 250 {
        return Some("Branch name is too long (max 250 characters)".to_string());
    }

    // Starts with '.' or '-'
    if name.starts_with('.') {
        return Some("Branch name cannot start with '.'".to_string());
    }
    if name.starts_with('-') {
        return Some("Branch name cannot start with '-'".to_string());
    }

    // Ends with '/' or '.lock'
    if name.ends_with('/') {
        return Some("Branch name cannot end with '/'".to_string());
    }
    if name.ends_with(".lock") {
        return Some("Branch name cannot end with '.lock'".to_string());
    }

    // Contains '..'
    if name.contains("..") {
        return Some("Branch name cannot contain '..'".to_string());
    }

    // Equals '@'
    if name == "@" {
        return Some("Branch name cannot be '@'".to_string());
    }

    // Invalid characters: space, ~, ^, :, ?, *, [, \, control chars
    let invalid_chars = [' ', '~', '^', ':', '?', '*', '[', '\\'];
    for c in invalid_chars {
        if name.contains(c) {
            return Some(format!("Branch name cannot contain '{}'", c));
        }
    }

    // Control characters (0x00-0x1F, 0x7F)
    for c in name.chars() {
        if c.is_control() {
            return Some("Branch name cannot contain control characters".to_string());
        }
    }

    None
}

/// Rename a git branch using `git branch -m`
pub fn rename_branch(repo_path: &Path, old_name: &str, new_name: &str) -> Result<(), GitError> {
    use std::process::Command;

    log::info!(
        "[git::rename_branch] Renaming branch '{}' to '{}' in {:?}",
        old_name,
        new_name,
        repo_path
    );

    let output = Command::new("git")
        .args(["branch", "-m", old_name, new_name])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git branch -m failed: {}", stderr),
        )));
    }

    log::info!("[git::rename_branch] Branch renamed successfully");
    Ok(())
}

/// Execute the full merge workflow
pub fn execute_merge_workflow(
    worktree_path: &Path,
    repo_path: &Path,
    strategy: MergeStrategy,
) -> Result<String, GitError> {
    // Get branch name before any operations
    let branch_name = {
        let repo = Repository::open(worktree_path)?;
        let head = repo.head()?;
        head.shorthand()
            .ok_or_else(|| GitError::BranchNotFound("HEAD".to_string()))?
            .to_string()
    };

    match strategy {
        MergeStrategy::Merge => {
            merge_branch_to_target(worktree_path, repo_path)?;
        }
        MergeStrategy::Rebase => {
            rebase_branch_onto_target(worktree_path)?;
            // After rebase, merge into target (fast-forward)
            merge_branch_to_target(worktree_path, repo_path)?;
        }
    }

    Ok(branch_name)
}
