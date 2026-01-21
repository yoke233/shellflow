mod config;
mod git;
mod pty;
mod state;
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
    // Find worktree path and parent project path
    let (worktree_path, project_path) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((worktree.path.clone(), project.path.clone()));
                break;
            }
        }

        found.ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    // Load config with project-specific overrides
    let cfg = config::load_config_for_project(Some(&project_path));
    let command = cfg.main.command;

    pty::spawn_pty(&app, &state, worktree_id, &worktree_path, &command, cols, rows, None).map_err(map_err)
}

#[tauri::command]
fn spawn_terminal(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find worktree path
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

    pty::spawn_pty(&app, &state, worktree_id, &worktree_path, "shell", cols, rows, None).map_err(map_err)
}

#[tauri::command]
fn spawn_task(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    task_name: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find worktree path and parent project path
    let (worktree_path, project_path) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((worktree.path.clone(), project.path.clone()));
                break;
            }
        }

        found.ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    // Load config and find the task
    let cfg = config::load_config_for_project(Some(&project_path));
    let task = cfg
        .tasks
        .iter()
        .find(|t| t.name == task_name)
        .ok_or_else(|| format!("Task not found: {}", task_name))?;

    pty::spawn_pty(&app, &state, worktree_id, &worktree_path, &task.command, cols, rows, task.shell.as_deref())
        .map_err(map_err)
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

    // Use project_id as the "worktree_id" for PTY tracking purposes
    pty::spawn_pty(&app, &state, project_id, &project_path, "shell", cols, rows, None).map_err(map_err)
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
fn get_config(project_path: Option<String>) -> config::Config {
    config::load_config_for_project(project_path.as_deref())
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
fn check_merge_feasibility(worktree_path: &str) -> Result<MergeFeasibility> {
    let path = Path::new(worktree_path);
    git::check_merge_feasibility(path).map_err(map_err)
}

#[tauri::command]
fn execute_merge_workflow(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    worktree_id: &str,
    options: MergeWorkflowOptions,
) -> Result<MergeWorkflowResult> {
    // Find worktree and project
    let (worktree_path, project_path) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((worktree.path.clone(), project.path.clone()));
                break;
            }
        }

        found.ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    let worktree_path = Path::new(&worktree_path);
    let project_path = Path::new(&project_path);

    // Emit progress: starting merge
    let _ = app.emit(
        "merge-progress",
        MergeProgress {
            phase: "merging".to_string(),
            message: format!(
                "{}...",
                if options.strategy == MergeStrategy::Rebase {
                    "Rebasing"
                } else {
                    "Merging"
                }
            ),
        },
    );

    // Execute the merge/rebase
    let branch_name =
        git::execute_merge_workflow(worktree_path, project_path, options.strategy).map_err(
            |e| {
                let _ = app.emit(
                    "merge-progress",
                    MergeProgress {
                        phase: "error".to_string(),
                        message: e.to_string(),
                    },
                );
                e.to_string()
            },
        )?;

    // Delete worktree if requested
    if options.delete_worktree {
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "cleanup".to_string(),
                message: "Removing worktree...".to_string(),
            },
        );

        // Stop watching first
        watcher::stop_watching(worktree_id);

        // Delete the worktree
        let mut persisted = state.persisted.write();
        for project in &mut persisted.projects {
            if project.worktrees.iter().any(|w| w.id == worktree_id) {
                worktree::delete_worktree(project, worktree_id).map_err(map_err)?;
                break;
            }
        }
        drop(persisted);
        state.save().map_err(map_err)?;
    }

    // Delete local branch if requested
    if options.delete_local_branch {
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "cleanup".to_string(),
                message: "Deleting local branch...".to_string(),
            },
        );

        if let Err(e) = git::delete_local_branch(project_path, &branch_name) {
            info!("Failed to delete local branch: {}", e);
            // Don't fail the whole operation for branch deletion
        }
    }

    // Delete remote branch if requested
    if options.delete_remote_branch {
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "cleanup".to_string(),
                message: "Deleting remote branch...".to_string(),
            },
        );

        if let Err(e) = git::delete_remote_branch(project_path, &branch_name) {
            info!("Failed to delete remote branch: {}", e);
            // Don't fail the whole operation for branch deletion
        }
    }

    // Emit completion
    let _ = app.emit(
        "merge-progress",
        MergeProgress {
            phase: "complete".to_string(),
            message: "Merge complete!".to_string(),
        },
    );

    Ok(MergeWorkflowResult {
        success: true,
        branch_name,
        error: None,
    })
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
) -> Result<()> {
    // Find worktree and project
    let (_worktree_path, project_path, branch_name) = {
        let persisted = state.persisted.read();
        let mut found = None;

        for project in &persisted.projects {
            if let Some(worktree) = project.worktrees.iter().find(|w| w.id == worktree_id) {
                found = Some((
                    worktree.path.clone(),
                    project.path.clone(),
                    worktree.branch.clone(),
                ));
                break;
            }
        }

        found.ok_or_else(|| format!("Worktree not found: {}", worktree_id))?
    };

    let project_path = Path::new(&project_path);

    // Delete worktree if requested
    if options.delete_worktree {
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "cleanup".to_string(),
                message: "Removing worktree...".to_string(),
            },
        );

        // Stop watching first
        watcher::stop_watching(worktree_id);

        // Delete the worktree
        let mut persisted = state.persisted.write();
        for project in &mut persisted.projects {
            if project.worktrees.iter().any(|w| w.id == worktree_id) {
                worktree::delete_worktree(project, worktree_id).map_err(map_err)?;
                break;
            }
        }
        drop(persisted);
        state.save().map_err(map_err)?;
    }

    // Delete local branch if requested
    if options.delete_local_branch {
        let _ = app.emit(
            "merge-progress",
            MergeProgress {
                phase: "cleanup".to_string(),
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
                phase: "cleanup".to_string(),
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
            message: "Cleanup complete!".to_string(),
        },
    );

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
            remove_stale_worktree,
            spawn_main,
            spawn_terminal,
            spawn_project_shell,
            spawn_task,
            pty_write,
            pty_resize,
            pty_kill,
            pty_force_kill,
            get_changed_files,
            has_uncommitted_changes,
            stash_changes,
            stash_pop,
            start_watching,
            stop_watching,
            get_config,
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
