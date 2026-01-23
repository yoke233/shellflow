mod config;
mod git;
mod pty;
mod state;
mod template;
mod watcher;
mod worktree;

use config::MergeStrategy;
use git::MergeFeasibility;
use log::info;
use serde::{Deserialize, Serialize};
use state::{AppState, FileChange, Project, Worktree};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

type Result<T> = std::result::Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// Project commands
#[tauri::command]
fn add_project(state: State<'_, Arc<AppState>>, path: &str) -> Result<Project> {
    let path = Path::new(path);
    let project = worktree::create_project(path).map_err(map_err)?;

    {
        let mut persisted = state.persisted.write();
        persisted.projects.push(project.clone());
    }

    state.save().map_err(map_err)?;
    Ok(project)
}

#[tauri::command]
fn list_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>> {
    Ok(state.persisted.read().projects.clone())
}

#[tauri::command]
fn remove_project(state: State<'_, Arc<AppState>>, project_id: &str) -> Result<()> {
    {
        let mut persisted = state.persisted.write();
        // Find and clean up watchers before removing project
        if let Some(project) = persisted.projects.iter().find(|p| p.id == project_id) {
            // Stop watching individual worktrees
            for wt in &project.worktrees {
                watcher::stop_watching(&wt.id);
            }
        }
        persisted.projects.retain(|p| p.id != project_id);
    }
    state.save().map_err(map_err)?;
    Ok(())
}

// Worktree commands
#[tauri::command]
fn create_worktree(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_path: &str,
    name: Option<String>,
) -> Result<Worktree> {
    let total_start = Instant::now();
    info!("[create_worktree] Starting...");

    let start = Instant::now();
    let cfg = config::load_config_for_project(Some(project_path));
    info!("[create_worktree] load_config took {:?}", start.elapsed());

    let start = Instant::now();
    let mut persisted = state.persisted.write();
    info!("[create_worktree] acquire write lock took {:?}", start.elapsed());

    let project = persisted
        .projects
        .iter_mut()
        .find(|p| p.path == project_path)
        .ok_or_else(|| format!("Project not found: {}", project_path))?;

    let project_path_buf = Path::new(&project.path).to_path_buf();

    let start = Instant::now();
    let wt = worktree::create_worktree(
        project,
        name,
        cfg.worktree.directory.as_deref(),
        &cfg.worktree.base_branch,
    )
    .map_err(map_err)?;
    info!("[create_worktree] worktree::create_worktree took {:?}", start.elapsed());

    // Copy gitignored files if enabled in config (in background thread)
    if cfg.worktree.copy.gitignored {
        let worktree_path = wt.path.clone();
        let worktree_id = wt.id.clone();
        let except = cfg.worktree.copy.except.clone();
        let app_handle = app.clone();
        let project_path_buf_clone = project_path_buf.clone();

        // Emit copy started event
        let _ = app_handle.emit("worktree-copy-started", &worktree_id);

        std::thread::spawn(move || {
            let start = Instant::now();
            let result = worktree::copy_gitignored_files(
                &project_path_buf_clone,
                Path::new(&worktree_path),
                &except,
            );

            match &result {
                Ok(()) => info!("[create_worktree] background copy_gitignored_files took {:?}", start.elapsed()),
                Err(e) => info!("[create_worktree] background copy_gitignored_files failed: {}", e),
            }

            // Emit copy completed event
            let _ = app_handle.emit("worktree-copy-completed", serde_json::json!({
                "worktreeId": worktree_id,
                "success": result.is_ok(),
                "durationMs": start.elapsed().as_millis() as u64,
            }));
        });
        info!("[create_worktree] spawned background thread for copy_gitignored_files");
    }

    // Start file watcher for this worktree
    let start = Instant::now();
    watcher::watch_worktree(app.clone(), wt.id.clone(), wt.path.clone());
    info!("[create_worktree] watch_worktree took {:?}", start.elapsed());

    drop(persisted);

    let start = Instant::now();
    state.save().map_err(map_err)?;
    info!("[create_worktree] state.save took {:?}", start.elapsed());

    info!("[create_worktree] TOTAL took {:?}", total_start.elapsed());
    Ok(wt)
}

#[tauri::command]
fn list_worktrees(state: State<'_, Arc<AppState>>, project_path: &str) -> Result<Vec<Worktree>> {
    let persisted = state.persisted.read();

    let project = persisted
        .projects
        .iter()
        .find(|p| p.path == project_path)
        .ok_or_else(|| format!("Project not found: {}", project_path))?;

    Ok(project.worktrees.clone())
}

#[tauri::command]
fn delete_worktree(state: State<'_, Arc<AppState>>, worktree_id: &str) -> Result<()> {
    let mut persisted = state.persisted.write();

    // Find the project containing this worktree
    for project in &mut persisted.projects {
        if project.worktrees.iter().any(|w| w.id == worktree_id) {
            worktree::delete_worktree(project, worktree_id).map_err(map_err)?;
            drop(persisted);
            state.save().map_err(map_err)?;
            return Ok(());
        }
    }

    Err(format!("Worktree not found: {}", worktree_id))
}

#[tauri::command]
fn execute_delete_worktree_workflow(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
) {
    // Extract worktree info before spawning thread
    let worktree_info = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((
                    worktree.name.clone(),
                    worktree.path.clone(),
                    project.path.clone(),
                ));
                break;
            }
        }

        match found {
            Some(data) => data,
            None => {
                let _ = app.emit(
                    "delete-worktree-completed",
                    DeleteWorktreeCompleted {
                        worktree_id: worktree_id.to_string(),
                        success: false,
                        error: Some(format!("Worktree not found: {}", worktree_id)),
                    },
                );
                return;
            }
        }
    };

    let worktree_id = worktree_id.to_string();
    let app_state = Arc::clone(&*state);
    let (worktree_name, worktree_path, project_path) = worktree_info;

    // Spawn background thread to avoid blocking UI
    std::thread::spawn(move || {
        // Step 1: Stop file watcher
        let _ = app.emit(
            "delete-worktree-progress",
            DeleteWorktreeProgress {
                phase: "stop-watcher".to_string(),
                message: "Stopping file watcher...".to_string(),
            },
        );
        watcher::stop_watching(&worktree_id);

        // Step 2: Remove git worktree (this also deletes the directory)
        let _ = app.emit(
            "delete-worktree-progress",
            DeleteWorktreeProgress {
                phase: "remove-worktree".to_string(),
                message: "Removing worktree...".to_string(),
            },
        );
        let project_path = Path::new(&project_path);
        if let Err(e) = git::delete_worktree(project_path, &worktree_name) {
            let _ = app.emit(
                "delete-worktree-progress",
                DeleteWorktreeProgress {
                    phase: "error".to_string(),
                    message: e.to_string(),
                },
            );
            let _ = app.emit(
                "delete-worktree-completed",
                DeleteWorktreeCompleted {
                    worktree_id,
                    success: false,
                    error: Some(e.to_string()),
                },
            );
            return;
        }

        // Clean up directory if git didn't remove it
        let worktree_path = Path::new(&worktree_path);
        if worktree_path.exists() {
            if let Err(e) = std::fs::remove_dir_all(worktree_path) {
                info!("Failed to remove worktree directory: {}", e);
            }
        }

        // Step 3: Save changes
        let _ = app.emit(
            "delete-worktree-progress",
            DeleteWorktreeProgress {
                phase: "save".to_string(),
                message: "Saving...".to_string(),
            },
        );
        {
            let mut persisted = app_state.persisted.write();
            for project in &mut persisted.projects {
                if let Some(idx) = project.worktrees.iter().position(|w| w.id == worktree_id) {
                    project.worktrees.remove(idx);
                    break;
                }
            }
        }

        if let Err(e) = app_state.save() {
            info!("Failed to save state after worktree deletion: {}", e);
        }

        // Emit completion
        let _ = app.emit(
            "delete-worktree-progress",
            DeleteWorktreeProgress {
                phase: "complete".to_string(),
                message: "Done".to_string(),
            },
        );

        let _ = app.emit(
            "delete-worktree-completed",
            DeleteWorktreeCompleted {
                worktree_id,
                success: true,
                error: None,
            },
        );
    });

    info!("[execute_delete_worktree_workflow] spawned background thread");
}

/// Remove a worktree from state by its path (used when worktree folder is deleted externally)
#[tauri::command]
fn remove_stale_worktree(state: State<'_, Arc<AppState>>, worktree_path: &str) -> Result<()> {
    let mut persisted = state.persisted.write();

    for project in &mut persisted.projects {
        if let Some(idx) = project.worktrees.iter().position(|w| w.path == worktree_path) {
            let worktree = &project.worktrees[idx];
            info!(
                "[remove_stale_worktree] Removing '{}' from project '{}'",
                worktree.name, project.name
            );

            // Stop watching this worktree
            watcher::stop_watching(&worktree.id);

            // Remove from state (don't try to delete files - they're already gone)
            project.worktrees.remove(idx);
            drop(persisted);
            state.save().map_err(map_err)?;
            return Ok(());
        }
    }

    // Not found is OK - might have already been cleaned up
    Ok(())
}

// PTY commands
#[tauri::command]
fn spawn_main(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find worktree info and parent project path
    let (worktree_path, worktree_name, worktree_branch, project_path) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((
                    worktree.path.clone(),
                    worktree.name.clone(),
                    worktree.branch.clone(),
                    project.path.clone(),
                ));
                break;
            }
        }

        found.ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    // Load config with project-specific overrides
    let cfg = config::load_config_for_project(Some(&project_path));

    // Expand template variables in command
    let ctx = template::TemplateContext::new(&project_path)
        .with_branch(&worktree_branch)
        .with_worktree_name(&worktree_name);
    let command = template::expand_template(&cfg.main.command, &ctx).map_err(map_err)?;

    pty::spawn_pty(&app, &state, worktree_id, &worktree_path, &command, cols, rows, None, None).map_err(map_err)
}

#[tauri::command]
fn spawn_terminal(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find path - can be either a worktree or a project
    let path = {
        let persisted = state.persisted.read();

        // First try to find a worktree with this ID
        let worktree_path = persisted
            .projects
            .iter()
            .flat_map(|p| &p.worktrees)
            .find(|w| w.id == worktree_id)
            .map(|w| w.path.clone());

        // If not found, try to find a project with this ID
        worktree_path.or_else(|| {
            persisted
                .projects
                .iter()
                .find(|p| p.id == worktree_id)
                .map(|p| p.path.clone())
        }).ok_or_else(|| format!("Worktree or project not found: {}", worktree_id))?
    };

    pty::spawn_pty(&app, &state, worktree_id, &path, "shell", cols, rows, None, None).map_err(map_err)
}

#[tauri::command]
fn spawn_action(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    prompt: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find worktree path and project path
    let (worktree_path, project_path) = {
        let persisted = state.persisted.read();
        persisted
            .projects
            .iter()
            .find_map(|p| {
                p.worktrees
                    .iter()
                    .find(|w| w.id == worktree_id)
                    .map(|w| (w.path.clone(), p.path.clone()))
            })
            .ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    // Load config to get the action command
    let config = config::load_config_for_project(Some(&project_path));
    let action_command = &config.actions.command;

    // Start action command with initial prompt (stays interactive)
    // Run through shell so shell escaping works properly
    let command = format!("{} {}", action_command, shell_escape::escape(prompt.into()));

    // Get user's shell to run the command through
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    pty::spawn_pty(&app, &state, worktree_id, &worktree_path, &command, cols, rows, Some(&shell), None).map_err(map_err)
}

#[tauri::command]
fn watch_merge_state(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
) -> Result<()> {
    // Find project path (where the merge is happening, not the worktree path)
    let project_path = {
        let persisted = state.persisted.read();
        persisted
            .projects
            .iter()
            .find(|p| p.worktrees.iter().any(|w| w.id == worktree_id))
            .map(|p| p.path.clone())
            .ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    watcher::watch_merge_state(app, worktree_id.to_string(), project_path);
    Ok(())
}

#[tauri::command]
fn stop_merge_watcher(worktree_id: &str) {
    watcher::stop_merge_watcher(worktree_id);
}

#[tauri::command]
fn watch_rebase_state(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
) -> Result<()> {
    // Find worktree path - rebase happens in the worktree, not the project
    let worktree_path = {
        let persisted = state.persisted.read();
        persisted
            .projects
            .iter()
            .flat_map(|p| &p.worktrees)
            .find(|w| w.id == worktree_id)
            .map(|w| w.path.clone())
            .ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    watcher::watch_rebase_state(app, worktree_id.to_string(), worktree_path);
    Ok(())
}

#[tauri::command]
fn stop_rebase_watcher(worktree_id: &str) {
    watcher::stop_rebase_watcher(worktree_id);
}

#[tauri::command]
fn spawn_task(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    entity_id: &str,
    task_name: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find entity info and project path (entity can be a worktree or a project)
    // Returns: (entity_path, project_path, branch, optional_worktree_name)
    let (entity_path, project_path, branch, worktree_name) = {
        let persisted = state.persisted.read();
        let mut found = None;

        // First, try to find a worktree with this ID
        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == entity_id) {
                found = Some((
                    worktree.path.clone(),
                    project.path.clone(),
                    worktree.branch.clone(),
                    Some(worktree.name.clone()),
                ));
                break;
            }
        }

        // If not found as worktree, try to find a project with this ID
        if found.is_none() {
            if let Some(project) = persisted.projects.iter().find(|p| p.id == entity_id) {
                // For main project, get current branch from git
                let repo = git2::Repository::open(&project.path).map_err(map_err)?;
                let branch = git::get_current_branch(&repo).map_err(map_err)?;
                found = Some((project.path.clone(), project.path.clone(), branch, None));
            }
        }

        found.ok_or_else(|| format!("Entity not found: {}", entity_id))?
    };

    // Load config and find the task
    let cfg = config::load_config_for_project(Some(&project_path));
    let task = cfg
        .tasks
        .iter()
        .find(|t| t.name == task_name)
        .ok_or_else(|| format!("Task not found: {}", task_name))?;

    // Expand template variables in command
    let mut ctx = template::TemplateContext::new(&project_path).with_branch(&branch);
    if let Some(name) = worktree_name {
        ctx = ctx.with_worktree_name(name);
    }
    let command = template::expand_template(&task.command, &ctx).map_err(map_err)?;

    // Expand template variables in env vars
    let expanded_env: std::collections::HashMap<String, String> = task
        .env
        .iter()
        .map(|(key, value)| {
            let expanded = template::expand_template(value, &ctx).unwrap_or_else(|_| value.clone());
            (key.clone(), expanded)
        })
        .collect();
    let env_vars = if expanded_env.is_empty() { None } else { Some(&expanded_env) };

    pty::spawn_pty(&app, &state, entity_id, &entity_path, &command, cols, rows, task.shell.as_deref(), env_vars)
        .map_err(map_err)
}

/// A named URL returned from get_task_urls
#[derive(Debug, Clone, Serialize)]
struct NamedUrl {
    name: String,
    url: String,
}

#[tauri::command]
fn get_task_urls(
    state: State<'_, Arc<AppState>>,
    entity_id: &str,
    task_name: &str,
) -> Result<Vec<NamedUrl>> {
    use template::{expand_template, TemplateContext};

    // Find entity info (worktree or project) to get branch and paths
    let (branch, project_path) = {
        let persisted = state.persisted.read();
        let mut found = None;

        // First, try to find a worktree with this ID
        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == entity_id) {
                found = Some((worktree.branch.clone(), project.path.clone()));
                break;
            }
        }

        // If not found as worktree, try to find a project with this ID
        if found.is_none() {
            if let Some(project) = persisted.projects.iter().find(|p| p.id == entity_id) {
                // For main project, get current branch from git
                let repo = git2::Repository::open(&project.path).map_err(map_err)?;
                let branch = git::get_current_branch(&repo).map_err(map_err)?;
                found = Some((branch, project.path.clone()));
            }
        }

        found.ok_or_else(|| format!("Entity not found: {}", entity_id))?
    };

    // Load config and find the task
    let cfg = config::load_config_for_project(Some(&project_path));
    let task = cfg
        .tasks
        .iter()
        .find(|t| t.name == task_name)
        .ok_or_else(|| format!("Task not found: {}", task_name))?;

    // Build template context
    let ctx = TemplateContext::new(&project_path).with_branch(&branch);

    // Render each URL template, keeping the name
    let urls: Vec<NamedUrl> = task
        .urls
        .iter()
        .filter_map(|(name, url_template)| {
            expand_template(url_template, &ctx)
                .ok()
                .map(|url| NamedUrl { name: name.clone(), url })
        })
        .collect();

    Ok(urls)
}

#[tauri::command]
fn spawn_project_shell(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find project path
    let project_path = {
        let persisted = state.persisted.read();
        persisted
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .map(|p| p.path.clone())
            .ok_or_else(|| format!("Project not found: {}", project_id))?
    };

    // Load config with project-specific overrides
    let cfg = config::load_config_for_project(Some(&project_path));

    // Expand template variables in command (no branch/worktree_name for projects)
    let ctx = template::TemplateContext::new(&project_path);
    let command = template::expand_template(&cfg.main.command, &ctx).map_err(map_err)?;

    // Use project_id as the "worktree_id" for PTY tracking purposes
    pty::spawn_pty(&app, &state, project_id, &project_path, &command, cols, rows, None, None).map_err(map_err)
}

#[tauri::command]
fn pty_write(state: State<'_, Arc<AppState>>, pty_id: &str, data: &str) -> Result<()> {
    pty::write_to_pty(&state, pty_id, data).map_err(map_err)
}

#[tauri::command]
fn pty_resize(state: State<'_, Arc<AppState>>, pty_id: &str, cols: u16, rows: u16) -> Result<()> {
    pty::resize_pty(&state, pty_id, cols, rows).map_err(map_err)
}

#[tauri::command]
fn pty_kill(state: State<'_, Arc<AppState>>, pty_id: &str) -> Result<()> {
    pty::kill_pty(&state, pty_id).map_err(map_err)
}

#[tauri::command]
fn pty_force_kill(state: State<'_, Arc<AppState>>, pty_id: &str) -> Result<()> {
    pty::force_kill_pty(&state, pty_id).map_err(map_err)
}

// Config commands
#[tauri::command]
fn get_config(project_path: Option<String>) -> config::ConfigResult {
    config::load_config_with_errors(project_path.as_deref())
}

#[tauri::command]
fn watch_config(app: AppHandle, project_path: Option<String>) {
    watcher::watch_config(app, project_path);
}

#[tauri::command]
fn stop_config_watcher() {
    watcher::stop_config_watcher();
}

// Action commands
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPromptContext {
    pub worktree_dir: String,
    pub worktree_name: String,
    pub branch: String,
    pub target_branch: String,
}

#[tauri::command]
fn expand_action_prompt(
    action_name: &str,
    context: ActionPromptContext,
    project_path: Option<String>,
) -> Result<String> {
    let cfg = config::load_config_for_project(project_path.as_deref());

    let (template, ctx) = match action_name {
        "merge_worktree_with_conflicts" => {
            let template = &cfg.actions.merge_worktree_with_conflicts;

            // Get conflicted files for context
            let conflicted_files = git::get_conflicted_files(Path::new(&context.worktree_dir))
                .unwrap_or_default();

            let ctx = minijinja::context! {
                worktree_dir => context.worktree_dir,
                worktree_name => context.worktree_name,
                branch => context.branch,
                target_branch => context.target_branch,
                conflicted_files => conflicted_files,
            };
            (template.clone(), ctx)
        }
        "rebase_worktree_with_conflicts" => {
            let template = &cfg.actions.rebase_worktree_with_conflicts;

            // Get conflicted files for context
            let conflicted_files = git::get_conflicted_files(Path::new(&context.worktree_dir))
                .unwrap_or_default();

            let ctx = minijinja::context! {
                worktree_dir => context.worktree_dir,
                worktree_name => context.worktree_name,
                branch => context.branch,
                target_branch => context.target_branch,
                conflicted_files => conflicted_files,
            };
            (template.clone(), ctx)
        }
        _ => return Err(format!("Unknown action: {}", action_name)),
    };

    template::expand_action_template(&template, ctx).map_err(map_err)
}

// Git commands
#[tauri::command]
fn get_changed_files(worktree_path: &str) -> Result<Vec<FileChange>> {
    let path = Path::new(worktree_path);
    git::get_changed_files(path).map_err(map_err)
}

#[tauri::command]
fn has_uncommitted_changes(project_path: &str) -> Result<bool> {
    let path = Path::new(project_path);
    git::has_uncommitted_changes_at_path(path).map_err(map_err)
}

#[tauri::command]
fn stash_changes(project_path: &str) -> Result<String> {
    let path = Path::new(project_path);
    git::stash_changes(path).map_err(map_err)
}

#[tauri::command]
fn stash_pop(project_path: &str, stash_id: &str) -> Result<()> {
    let path = Path::new(project_path);
    git::stash_pop(path, stash_id).map_err(map_err)
}

#[tauri::command]
fn abort_merge(project_path: &str) -> Result<()> {
    let path = Path::new(project_path);
    git::abort_merge(path).map_err(map_err)
}

#[tauri::command]
fn abort_rebase(project_path: &str) -> Result<()> {
    let path = Path::new(project_path);
    git::abort_rebase(path).map_err(map_err)
}

#[tauri::command]
fn start_watching(app: AppHandle, worktree_id: String, worktree_path: String) {
    watcher::watch_worktree(app, worktree_id, worktree_path);
}

#[tauri::command]
fn stop_watching(worktree_id: String) {
    watcher::stop_watching(&worktree_id);
}

// Merge workflow commands
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeWorkflowOptions {
    pub strategy: MergeStrategy,
    pub delete_worktree: bool,
    pub delete_local_branch: bool,
    pub delete_remote_branch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeWorkflowResult {
    pub success: bool,
    pub branch_name: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeProgress {
    pub phase: String,
    pub message: String,
}

#[tauri::command]
fn check_merge_feasibility(worktree_path: &str, project_path: Option<String>) -> Result<MergeFeasibility> {
    let path = Path::new(worktree_path);
    let cfg = config::load_config_for_project(project_path.as_deref());
    git::check_merge_feasibility(path, &cfg.worktree.base_branch).map_err(map_err)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCompleted {
    pub worktree_id: String,
    pub success: bool,
    pub branch_name: String,
    pub deleted_worktree: bool,
    pub error: Option<String>,
}

// Delete worktree workflow types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorktreeProgress {
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorktreeCompleted {
    pub worktree_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
fn execute_merge_workflow(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    options: MergeWorkflowOptions,
) {
    // Find worktree and project - extract all data we need before spawning thread
    let (worktree_path, project_path) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((worktree.path.clone(), project.path.clone()));
                break;
            }
        }

        match found {
            Some(data) => data,
            None => {
                let _ = app.emit(
                    "merge-completed",
                    MergeCompleted {
                        worktree_id: worktree_id.to_string(),
                        success: false,
                        branch_name: String::new(),
                        deleted_worktree: false,
                        error: Some(format!("Worktree not found: {}", worktree_id)),
                    },
                );
                return;
            }
        }
    };

    // Clone data for the background thread
    let worktree_id = worktree_id.to_string();
    let app_state = Arc::clone(&*state);
    let delete_worktree = options.delete_worktree;

    // Spawn background thread to avoid blocking UI
    std::thread::spawn(move || {
        let worktree_path = Path::new(&worktree_path);
        let project_path = Path::new(&project_path);

        // Emit progress: starting merge
        let phase = if options.strategy == MergeStrategy::Rebase {
            "rebase"
        } else {
            "merge"
        };
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: phase.to_string(),
                message: format!("{}...", if phase == "rebase" { "Rebasing" } else { "Merging" }),
            },
        );

        // Execute the merge/rebase
        let branch_name = match git::execute_merge_workflow(worktree_path, project_path, options.strategy) {
            Ok(name) => name,
            Err(e) => {
                let _ = app.emit(
                    "merge-progress",
                    MergeProgress {
                        phase: "error".to_string(),
                        message: e.to_string(),
                    },
                );
                let _ = app.emit(
                    "merge-completed",
                    MergeCompleted {
                        worktree_id,
                        success: false,
                        branch_name: String::new(),
                        deleted_worktree: false,
                        error: Some(e.to_string()),
                    },
                );
                return;
            }
        };

        // Delete worktree if requested
        if options.delete_worktree {
            let _ = app.emit(
                "merge-progress",
                MergeProgress {
                    phase: "delete-worktree".to_string(),
                    message: "Removing worktree...".to_string(),
                },
            );

            // Stop watching first
            watcher::stop_watching(&worktree_id);

            // Delete the worktree
            let mut persisted = app_state.persisted.write();
            for project in &mut persisted.projects {
                if project.worktrees.iter().any(|w| w.id == worktree_id) {
                    if let Err(e) = worktree::delete_worktree(project, &worktree_id) {
                        info!("Failed to delete worktree: {}", e);
                    }
                    break;
                }
            }
            drop(persisted);
            if let Err(e) = app_state.save() {
                info!("Failed to save state: {}", e);
            }
        }

        // Delete local branch if requested
        if options.delete_local_branch {
            let _ = app.emit(
                "merge-progress",
                MergeProgress {
                    phase: "delete-local-branch".to_string(),
                    message: "Deleting local branch...".to_string(),
                },
            );

            if let Err(e) = git::delete_local_branch(project_path, &branch_name) {
                info!("Failed to delete local branch: {}", e);
            }
        }

        // Delete remote branch if requested
        if options.delete_remote_branch {
            let _ = app.emit(
                "merge-progress",
                MergeProgress {
                    phase: "delete-remote-branch".to_string(),
                    message: "Deleting remote branch...".to_string(),
                },
            );

            if let Err(e) = git::delete_remote_branch(project_path, &branch_name) {
                info!("Failed to delete remote branch: {}", e);
            }
        }

        // Emit completion
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "complete".to_string(),
                message: "Done".to_string(),
            },
        );

        let _ = app.emit(
            "merge-completed",
            MergeCompleted {
                worktree_id,
                success: true,
                branch_name,
                deleted_worktree: delete_worktree,
                error: None,
            },
        );
    });

    info!("[execute_merge_workflow] spawned background thread");
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOptions {
    pub delete_worktree: bool,
    pub delete_local_branch: bool,
    pub delete_remote_branch: bool,
}

#[tauri::command]
fn cleanup_worktree(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    options: CleanupOptions,
) {
    // Find worktree and project - extract all data we need before spawning thread
    let (project_path, branch_name) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((project.path.clone(), worktree.branch.clone()));
                break;
            }
        }

        match found {
            Some(data) => data,
            None => {
                let _ = app.emit(
                    "merge-completed",
                    MergeCompleted {
                        worktree_id: worktree_id.to_string(),
                        success: false,
                        branch_name: String::new(),
                        deleted_worktree: false,
                        error: Some(format!("Worktree not found: {}", worktree_id)),
                    },
                );
                return;
            }
        }
    };

    // Clone data for the background thread
    let worktree_id = worktree_id.to_string();
    let app_state = Arc::clone(&*state);
    let delete_worktree = options.delete_worktree;

    // Spawn background thread to avoid blocking UI
    std::thread::spawn(move || {
        let project_path = Path::new(&project_path);

        // Delete worktree if requested
        if options.delete_worktree {
            let _ = app.emit(
                "merge-progress",
                MergeProgress {
                    phase: "delete-worktree".to_string(),
                    message: "Removing worktree...".to_string(),
                },
            );

            // Stop watching first
            watcher::stop_watching(&worktree_id);

            // Delete the worktree
            let mut persisted = app_state.persisted.write();
            for project in &mut persisted.projects {
                if project.worktrees.iter().any(|w| w.id == worktree_id) {
                    if let Err(e) = worktree::delete_worktree(project, &worktree_id) {
                        info!("Failed to delete worktree: {}", e);
                    }
                    break;
                }
            }
            drop(persisted);
            if let Err(e) = app_state.save() {
                info!("Failed to save state: {}", e);
            }
        }

        // Delete local branch if requested
        if options.delete_local_branch {
            let _ = app.emit(
                "merge-progress",
                MergeProgress {
                    phase: "delete-local-branch".to_string(),
                    message: "Deleting local branch...".to_string(),
                },
            );

            if let Err(e) = git::delete_local_branch(project_path, &branch_name) {
                info!("Failed to delete local branch: {}", e);
            }
        }

        // Delete remote branch if requested
        if options.delete_remote_branch {
            let _ = app.emit(
                "merge-progress",
                MergeProgress {
                    phase: "delete-remote-branch".to_string(),
                    message: "Deleting remote branch...".to_string(),
                },
            );

            if let Err(e) = git::delete_remote_branch(project_path, &branch_name) {
                info!("Failed to delete remote branch: {}", e);
            }
        }

        // Emit completion
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "complete".to_string(),
                message: "Done".to_string(),
            },
        );

        let _ = app.emit(
            "merge-completed",
            MergeCompleted {
                worktree_id,
                success: true,
                branch_name,
                deleted_worktree: delete_worktree,
                error: None,
            },
        );
    });

    info!("[cleanup_worktree] spawned background thread");
}

/// Open a folder in the system file manager
#[tauri::command]
fn open_folder(path: &str) -> Result<()> {
    use std::process::Command;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Rename a worktree's branch (the worktree's display name comes from its branch)
#[tauri::command]
fn rename_worktree(
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    new_name: &str,
) -> Result<()> {
    // Validate the new name
    if let Some(error) = git::validate_branch_name(new_name) {
        return Err(error);
    }

    let mut persisted = state.persisted.write();

    // Find the worktree and its project
    let mut found = None;
    for project in &mut persisted.projects {
        if let Some(worktree) = project.worktrees.iter_mut().find(|w| w.id == worktree_id) {
            found = Some((project.path.clone(), worktree.branch.clone()));
            break;
        }
    }

    let (project_path, old_name) = found.ok_or_else(|| format!("Worktree not found: {}", worktree_id))?;

    // Check if new name is same as old name
    if old_name == new_name {
        return Ok(());
    }

    // Check if the new branch name already exists
    let project_path = std::path::Path::new(&project_path);
    if git::branch_exists(project_path, new_name).map_err(map_err)? {
        return Err(format!("Branch '{}' already exists", new_name));
    }

    // Rename the git branch
    git::rename_branch(project_path, &old_name, new_name).map_err(map_err)?;

    // Update the worktree state
    for project in &mut persisted.projects {
        if let Some(worktree) = project.worktrees.iter_mut().find(|w| w.id == worktree_id) {
            worktree.name = new_name.to_string();
            worktree.branch = new_name.to_string();
            break;
        }
    }

    drop(persisted);
    state.save().map_err(map_err)?;

    info!("[rename_worktree] Renamed worktree {} from '{}' to '{}'", worktree_id, old_name, new_name);
    Ok(())
}

/// Reorder projects by providing the new order of project IDs
#[tauri::command]
fn reorder_projects(state: State<'_, Arc<AppState>>, project_ids: Vec<String>) -> Result<()> {
    let mut persisted = state.persisted.write();

    // Create order map from the provided order
    let order_map: std::collections::HashMap<String, i32> = project_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i as i32))
        .collect();

    // Update project orders
    for project in &mut persisted.projects {
        if let Some(&order) = order_map.get(&project.id) {
            project.order = order;
        }
    }

    // Sort projects by order
    persisted.projects.sort_by_key(|p| p.order);

    drop(persisted);
    state.save().map_err(map_err)?;

    info!("[reorder_projects] Reordered {} projects", project_ids.len());
    Ok(())
}

/// Reorder worktrees within a project by providing the new order of worktree IDs
#[tauri::command]
fn reorder_worktrees(
    state: State<'_, Arc<AppState>>,
    project_id: &str,
    worktree_ids: Vec<String>,
) -> Result<()> {
    let mut persisted = state.persisted.write();

    let project = persisted
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| format!("Project not found: {}", project_id))?;

    // Create order map from the provided order
    let order_map: std::collections::HashMap<String, i32> = worktree_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i as i32))
        .collect();

    // Update worktree orders
    for worktree in &mut project.worktrees {
        if let Some(&order) = order_map.get(&worktree.id) {
            worktree.order = order;
        }
    }

    // Sort worktrees by order
    project.worktrees.sort_by_key(|w| w.order);

    drop(persisted);
    state.save().map_err(map_err)?;

    info!("[reorder_worktrees] Reordered {} worktrees in project {}", worktree_ids.len(), project_id);
    Ok(())
}

// Shutdown command - gracefully terminates all PTY processes
// Spawns a background thread and returns immediately so events can stream to frontend
#[tauri::command]
fn shutdown(app: AppHandle, state: State<'_, Arc<AppState>>) -> bool {
    info!("[Shutdown] Starting graceful shutdown...");

    // Check if there are any active PTY sessions
    let has_sessions = !state.pty_sessions.read().is_empty();

    let app_clone = app.clone();
    let state_clone = Arc::clone(&state);

    // Run shutdown in a background thread so events stream to frontend
    std::thread::spawn(move || {
        pty::shutdown_all_ptys(&app_clone, &state_clone);
        watcher::stop_all_watchers();
        info!("[Shutdown] Shutdown complete, exiting app");

        // Only delay if we had processes to show in the UI
        if has_sessions {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }

        // Exit the app
        app_clone.exit(0);
    });

    // Return whether we have sessions (so frontend knows whether to show UI)
    has_sessions
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let app_state = Arc::new(AppState::load_or_default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .setup(|app| {
            // Create custom app menu with our own Quit handler
            let quit_item = MenuItemBuilder::with_id("quit", "Quit One Man Band")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "One Man Band")
                .item(&quit_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .build()?;

            app.set_menu(menu)?;

            // Handle our custom quit menu item
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == "quit" {
                    // Trigger graceful shutdown via window close
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("close-requested", ());
                    }
                }
            });

            // Start file watchers for all existing worktrees
            // This enables detection of externally deleted worktree folders
            let app_state = app.state::<Arc<AppState>>();
            let persisted = app_state.persisted.read();
            for project in &persisted.projects {
                for wt in &project.worktrees {
                    watcher::watch_worktree(
                        app.handle().clone(),
                        wt.id.clone(),
                        wt.path.clone(),
                    );
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_project,
            list_projects,
            remove_project,
            create_worktree,
            list_worktrees,
            delete_worktree,
            execute_delete_worktree_workflow,
            remove_stale_worktree,
            rename_worktree,
            reorder_projects,
            reorder_worktrees,
            open_folder,
            spawn_main,
            spawn_terminal,
            spawn_action,
            watch_merge_state,
            stop_merge_watcher,
            watch_rebase_state,
            stop_rebase_watcher,
            spawn_project_shell,
            spawn_task,
            get_task_urls,
            pty_write,
            pty_resize,
            pty_kill,
            pty_force_kill,
            get_changed_files,
            has_uncommitted_changes,
            stash_changes,
            stash_pop,
            abort_merge,
            abort_rebase,
            start_watching,
            stop_watching,
            get_config,
            watch_config,
            stop_config_watcher,
            expand_action_prompt,
            check_merge_feasibility,
            execute_merge_workflow,
            cleanup_worktree,
            shutdown,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Prevent default close - let frontend handle it
                    api.prevent_close();
                    // Emit event to frontend to trigger shutdown flow
                    let _ = window.emit("close-requested", ());
                }
                tauri::WindowEvent::Destroyed => {
                    // Final cleanup (in case frontend didn't trigger shutdown)
                    watcher::stop_all_watchers();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // ExitRequested is handled via custom Quit menu item
            // No additional handling needed here
        });
}
