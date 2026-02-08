use crate::config::{BaseBranch, BaseBranchMode, MergeStrategy};
use crate::state::{FileChange, FileStatus};
use git2::{BranchType, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Stdio};
use std::io::Write;
use thiserror::Error;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn git_command() -> Command {
    let mut cmd = Command::new("git");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

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

pub fn stage_all(repo_path: &Path) -> Result<(), GitError> {
    let output = git_command()
        .args(["add", "-A"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git add failed: {}", stderr),
        )));
    }

    Ok(())
}

pub fn diff_cached(repo_path: &Path) -> Result<String, GitError> {
    let output = git_command()
        .args(["diff", "--cached"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git diff --cached failed: {}", stderr),
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn diff_cached_files(repo_path: &Path) -> Result<Vec<String>, GitError> {
    let output = git_command()
        .args(["diff", "--cached", "--name-only"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git diff --cached --name-only failed: {}", stderr),
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect())
}

pub fn commit_staged(repo_path: &Path, message: &str) -> Result<(), GitError> {
    if message.trim().is_empty() {
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Commit message cannot be empty",
        )));
    }

    let mut cmd = git_command();
    cmd.args(["commit", "-F", "-"])
        .current_dir(repo_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn()?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(message.as_bytes())?;
    }

    let output = child.wait_with_output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git commit failed: {}", stderr),
        )));
    }

    Ok(())
}

pub fn create_branch(repo_path: &Path, branch_name: &str) -> Result<(), GitError> {
    let output = git_command()
        .args(["checkout", "-b", branch_name])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git checkout -b failed: {}", stderr),
        )));
    }

    Ok(())
}

pub fn push_current_branch(repo_path: &Path) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;
    let branch = get_current_branch(&repo)?;

    let upstream_check = git_command()
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .current_dir(repo_path)
        .output()?;

    let output = if upstream_check.status.success() {
        git_command()
            .args(["push"])
            .current_dir(repo_path)
            .output()?
    } else {
        git_command()
            .args(["push", "-u", "origin", &branch])
            .current_dir(repo_path)
            .output()?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git push failed: {}", stderr),
        )));
    }

    Ok(())
}

pub fn push_default_branch(repo_path: &Path) -> Result<(), GitError> {
    let repo = Repository::open(repo_path)?;
    let branch = get_default_branch(&repo)?;

    let output = git_command()
        .args(["push", "origin", &branch])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git push origin {} failed: {}", branch, stderr),
        )));
    }

    Ok(())
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

/// Status information for worktree deletion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDeleteStatus {
    /// Whether there are uncommitted changes (staged, unstaged, or untracked)
    pub has_uncommitted_changes: bool,
    /// Number of commits not pushed to remote tracking branch
    pub unpushed_commits: usize,
    /// The current branch name
    pub branch_name: String,
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
    let output = git_command()
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

    let repo = Repository::open(worktree_path)?;

    // Get diff stats using git diff --numstat (for both staged and unstaged)
    let mut diff_stats: HashMap<String, (usize, usize)> = HashMap::new();

    // Unstaged changes
    if let Ok(output) = git_command()
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
    if let Ok(output) = git_command()
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

    // Sort by path for consistent ordering
    changes.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(changes)
}

/// Get information about the current branch relative to a base branch
pub fn get_branch_info(worktree_path: &Path, base_branch: &BaseBranch) -> Result<crate::state::BranchInfo, GitError> {

    let repo = Repository::open(worktree_path)?;
    let current_branch = get_current_branch(&repo)?;
    let base = resolve_target_branch(&repo, base_branch)?;
    let is_on_base_branch = current_branch == base;

    // Count commits ahead of base branch using git rev-list
    let commits_ahead = if is_on_base_branch {
        0
    } else {
        let output = git_command()
            .args(["rev-list", "--count", &format!("{}..HEAD", base)])
            .current_dir(worktree_path)
            .output();

        match output {
            Ok(o) if o.status.success() => {
                String::from_utf8_lossy(&o.stdout)
                    .trim()
                    .parse::<u32>()
                    .unwrap_or(0)
            }
            _ => 0,
        }
    };

    Ok(crate::state::BranchInfo {
        current_branch,
        base_branch: base,
        is_on_base_branch,
        commits_ahead,
    })
}

/// Get files changed between the working tree and the base branch
/// This includes committed changes (not in base), uncommitted changes, AND untracked files
pub fn get_branch_changed_files(
    worktree_path: &Path,
    base_branch: &BaseBranch,
) -> Result<Vec<FileChange>, GitError> {
    use std::collections::HashMap;

    let repo = Repository::open(worktree_path)?;
    let target_branch = resolve_target_branch(&repo, base_branch)?;

    // Get file status changes using git diff --name-status
    // Compare base branch directly to working tree (includes uncommitted changes to tracked files)
    let output = git_command()
        .args(["diff", "--name-status", &target_branch])
        .current_dir(worktree_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git diff --name-status failed: {}", stderr),
        )));
    }

    // Parse name-status output
    let mut file_statuses: HashMap<String, FileStatus> = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 2 {
            let status_char = parts[0].chars().next().unwrap_or('M');
            let path = parts.last().unwrap().to_string();
            let status = match status_char {
                'A' => FileStatus::Added,
                'D' => FileStatus::Deleted,
                'R' => FileStatus::Renamed,
                'M' | _ => FileStatus::Modified,
            };
            file_statuses.insert(path, status);
        }
    }

    // Also get untracked files using git status
    let output = git_command()
        .args(["status", "--porcelain", "-uall"])
        .current_dir(worktree_path)
        .output()?;

    if output.status.success() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if line.len() < 4 {
                continue;
            }
            let status_chars = &line[0..2];
            let path = line[3..].to_string();

            // Only add untracked files (marked with ??)
            if status_chars == "??" && !file_statuses.contains_key(&path) {
                file_statuses.insert(path, FileStatus::Untracked);
            }
        }
    }

    // Get diff stats using git diff --numstat
    // Compare base branch directly to working tree
    let output = git_command()
        .args(["diff", "--numstat", &target_branch])
        .current_dir(worktree_path)
        .output()?;

    let mut diff_stats: HashMap<String, (usize, usize)> = HashMap::new();
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

    // Combine into FileChange structs
    let mut changes: Vec<FileChange> = file_statuses
        .into_iter()
        .map(|(path, status)| {
            let (insertions, deletions) = diff_stats.get(&path).copied().unwrap_or((0, 0));
            FileChange {
                path,
                status,
                insertions: if insertions > 0 || deletions > 0 { Some(insertions) } else { None },
                deletions: if insertions > 0 || deletions > 0 { Some(deletions) } else { None },
            }
        })
        .collect();

    // Sort by path for consistent ordering
    changes.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(changes)
}

/// Get file content at a specific git ref (branch, commit, HEAD)
pub fn get_file_at_ref(
    repo_path: &Path,
    file_path: &str,
    git_ref: &str,
) -> Result<String, GitError> {

    let output = git_command()
        .args(["show", &format!("{}:{}", git_ref, file_path)])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("git show failed: {}", stderr),
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Get current working tree file content
pub fn get_working_file(repo_path: &Path, file_path: &str) -> Result<String, GitError> {
    let full_path = repo_path.join(file_path);
    std::fs::read_to_string(&full_path).map_err(GitError::Io)
}

/// Detect programming language from file extension
pub fn detect_language(file_path: &str) -> String {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    match ext {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "rb" => "ruby",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "hpp" | "cc" | "cxx" => "cpp",
        "cs" => "csharp",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "php" => "php",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "scss",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shell",
        _ => "plaintext",
    }
    .to_string()
}

/// Get list of files with merge conflicts in the worktree.
pub fn get_conflicted_files(worktree_path: &Path) -> Result<Vec<String>, GitError> {

    // Use git diff to find unmerged files - more reliable than libgit2 status
    let output = git_command()
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

    let output = git_command()
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

/// Check worktree status for deletion warnings
pub fn check_worktree_delete_status(worktree_path: &Path, base_branch: &BaseBranch) -> Result<WorktreeDeleteStatus, GitError> {
    let repo = Repository::open(worktree_path)?;

    // Get current branch name
    let head = repo.head()?;
    let branch_name = head
        .shorthand()
        .unwrap_or("HEAD")
        .to_string();

    // Check for uncommitted changes
    let has_uncommitted = has_uncommitted_changes(&repo)?;

    // Count commits ahead of the configured base branch
    let target_branch = resolve_target_branch(&repo, base_branch)?;
    let unpushed_commits = count_commits_ahead_of_base(&repo, &branch_name, &target_branch).unwrap_or(0);

    Ok(WorktreeDeleteStatus {
        has_uncommitted_changes: has_uncommitted,
        unpushed_commits,
        branch_name,
    })
}

/// Count commits on this branch that aren't in the target branch.
fn count_commits_ahead_of_base(repo: &Repository, branch_name: &str, target_branch: &str) -> Result<usize, GitError> {
    // Don't compare against self
    if branch_name == target_branch {
        return Ok(0);
    }

    // Find the local branch
    let local_branch = match repo.find_branch(branch_name, BranchType::Local) {
        Ok(branch) => branch,
        Err(_) => return Ok(0),
    };

    let target_branch_ref = match repo.find_branch(target_branch, BranchType::Local) {
        Ok(branch) => branch,
        Err(_) => return Ok(0),
    };

    let local_commit = local_branch.get().peel_to_commit()?;
    let target_commit = target_branch_ref.get().peel_to_commit()?;

    let (ahead, _behind) = repo.graph_ahead_behind(local_commit.id(), target_commit.id())?;

    Ok(ahead)
}

/// Stash uncommitted changes in a repository using git CLI.
/// Returns a unique stash ID that can be used with `stash_pop` to restore the correct stash.
pub fn stash_changes(repo_path: &Path) -> Result<String, GitError> {
    use std::time::{SystemTime, UNIX_EPOCH};

    // Generate unique stash ID using timestamp + random suffix
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let stash_id = format!("shellflow-auto-stash-{}", timestamp);

    log::info!("[stash_changes] Stashing changes in {:?} with id {}", repo_path, stash_id);

    let output = git_command()
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

    log::info!("[stash_pop] Looking for stash with id {} in {:?}", stash_id, repo_path);

    // List stashes to find the one with our ID
    let output = git_command()
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

    let output = git_command()
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
    let output = git_command()
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
    let output = git_command()
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

    let output = git_command()
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

    let output = git_command()
        .args(["rebase", "--abort"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        // It's okay if abort fails (e.g., no rebase in progress)
        // Just log and continue
    }

    Ok(())
}

/// Rebase the current branch onto the target branch
pub fn rebase_branch_onto_target(
    worktree_path: &Path,
) -> Result<(), GitError> {

    let repo = Repository::open(worktree_path)?;
    let target_branch = get_default_branch(&repo)?;
    drop(repo);

    // Rebase onto target branch
    let output = git_command()
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

    let output = git_command()
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

    log::info!(
        "[git::rename_branch] Renaming branch '{}' to '{}' in {:?}",
        old_name,
        new_name,
        repo_path
    );

    let output = git_command()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_status_serializes_to_lowercase() {
        // Test that FileStatus variants serialize to lowercase
        let added = FileStatus::Added;
        let modified = FileStatus::Modified;
        let deleted = FileStatus::Deleted;
        let renamed = FileStatus::Renamed;
        let untracked = FileStatus::Untracked;

        assert_eq!(serde_json::to_string(&added).unwrap(), "\"added\"");
        assert_eq!(serde_json::to_string(&modified).unwrap(), "\"modified\"");
        assert_eq!(serde_json::to_string(&deleted).unwrap(), "\"deleted\"");
        assert_eq!(serde_json::to_string(&renamed).unwrap(), "\"renamed\"");
        assert_eq!(serde_json::to_string(&untracked).unwrap(), "\"untracked\"");
    }

    #[test]
    fn file_change_serializes_with_stats() {
        let change = FileChange {
            path: "src/app.ts".to_string(),
            status: FileStatus::Modified,
            insertions: Some(10),
            deletions: Some(5),
        };

        let json = serde_json::to_value(&change).unwrap();
        assert_eq!(json["path"], "src/app.ts");
        assert_eq!(json["status"], "modified");
        assert_eq!(json["insertions"], 10);
        assert_eq!(json["deletions"], 5);
    }

    #[test]
    fn file_change_serializes_without_stats() {
        let change = FileChange {
            path: "untracked.ts".to_string(),
            status: FileStatus::Untracked,
            insertions: None,
            deletions: None,
        };

        let json = serde_json::to_value(&change).unwrap();
        assert_eq!(json["path"], "untracked.ts");
        assert_eq!(json["status"], "untracked");
        assert!(json["insertions"].is_null());
        assert!(json["deletions"].is_null());
    }

    #[test]
    fn validate_branch_name_empty() {
        let result = validate_branch_name("");
        assert_eq!(result, Some("Branch name cannot be empty".to_string()));
    }

    #[test]
    fn validate_branch_name_too_long() {
        let long_name = "a".repeat(251);
        let result = validate_branch_name(&long_name);
        assert_eq!(
            result,
            Some("Branch name is too long (max 250 characters)".to_string())
        );
    }

    #[test]
    fn validate_branch_name_starts_with_dot() {
        let result = validate_branch_name(".hidden");
        assert_eq!(result, Some("Branch name cannot start with '.'".to_string()));
    }

    #[test]
    fn validate_branch_name_starts_with_hyphen() {
        let result = validate_branch_name("-option");
        assert_eq!(result, Some("Branch name cannot start with '-'".to_string()));
    }

    #[test]
    fn validate_branch_name_ends_with_slash() {
        let result = validate_branch_name("feature/");
        assert_eq!(result, Some("Branch name cannot end with '/'".to_string()));
    }

    #[test]
    fn validate_branch_name_ends_with_lock() {
        let result = validate_branch_name("my-branch.lock");
        assert_eq!(
            result,
            Some("Branch name cannot end with '.lock'".to_string())
        );
    }

    #[test]
    fn validate_branch_name_contains_double_dot() {
        let result = validate_branch_name("feature..fix");
        assert_eq!(result, Some("Branch name cannot contain '..'".to_string()));
    }

    #[test]
    fn validate_branch_name_equals_at() {
        let result = validate_branch_name("@");
        assert_eq!(result, Some("Branch name cannot be '@'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_space() {
        let result = validate_branch_name("my branch");
        assert_eq!(result, Some("Branch name cannot contain ' '".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_tilde() {
        let result = validate_branch_name("feature~1");
        assert_eq!(result, Some("Branch name cannot contain '~'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_caret() {
        let result = validate_branch_name("feature^2");
        assert_eq!(result, Some("Branch name cannot contain '^'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_colon() {
        let result = validate_branch_name("feature:name");
        assert_eq!(result, Some("Branch name cannot contain ':'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_question() {
        let result = validate_branch_name("feature?name");
        assert_eq!(result, Some("Branch name cannot contain '?'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_asterisk() {
        let result = validate_branch_name("feature*");
        assert_eq!(result, Some("Branch name cannot contain '*'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_bracket() {
        let result = validate_branch_name("feature[1]");
        assert_eq!(result, Some("Branch name cannot contain '['".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_backslash() {
        let result = validate_branch_name("feature\\name");
        assert_eq!(result, Some("Branch name cannot contain '\\'".to_string()));
    }

    #[test]
    fn validate_branch_name_contains_control_char() {
        let result = validate_branch_name("feature\x00name");
        assert_eq!(
            result,
            Some("Branch name cannot contain control characters".to_string())
        );
    }

    #[test]
    fn validate_branch_name_valid_simple() {
        let result = validate_branch_name("feature-branch");
        assert_eq!(result, None);
    }

    #[test]
    fn validate_branch_name_valid_with_slash() {
        let result = validate_branch_name("feature/new-thing");
        assert_eq!(result, None);
    }

    #[test]
    fn validate_branch_name_valid_with_numbers() {
        let result = validate_branch_name("issue-123-fix");
        assert_eq!(result, None);
    }

    #[test]
    fn validate_branch_name_valid_at_boundary_length() {
        let name = "a".repeat(250);
        let result = validate_branch_name(&name);
        assert_eq!(result, None);
    }

    #[test]
    fn branch_info_serializes_with_commits_ahead() {
        let info = crate::state::BranchInfo {
            current_branch: "feature-x".to_string(),
            base_branch: "main".to_string(),
            is_on_base_branch: false,
            commits_ahead: 5,
        };

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["currentBranch"], "feature-x");
        assert_eq!(json["baseBranch"], "main");
        assert_eq!(json["isOnBaseBranch"], false);
        assert_eq!(json["commitsAhead"], 5);
    }

    #[test]
    fn branch_info_on_base_branch_has_zero_commits_ahead() {
        let info = crate::state::BranchInfo {
            current_branch: "main".to_string(),
            base_branch: "main".to_string(),
            is_on_base_branch: true,
            commits_ahead: 0,
        };

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["isOnBaseBranch"], true);
        assert_eq!(json["commitsAhead"], 0);
    }
}
