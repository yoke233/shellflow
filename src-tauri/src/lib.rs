mod config;
mod git;
mod pty;
mod state;
mod watcher;
mod workspace;

use log::info;
use state::{AppState, FileChange, Project, Workspace};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

type Result<T> = std::result::Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// Project commands
#[tauri::command]
fn add_project(state: State<'_, Arc<AppState>>, path: &str) -> Result<Project> {
    let path = Path::new(path);
    let project = workspace::create_project(path).map_err(map_err)?;

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
        persisted.projects.retain(|p| p.id != project_id);
    }
    state.save().map_err(map_err)?;
    Ok(())
}

// Workspace commands
#[tauri::command]
fn create_workspace(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_path: &str,
    name: Option<String>,
) -> Result<Workspace> {
    let total_start = Instant::now();
    info!("[create_workspace] Starting...");

    let start = Instant::now();
    let cfg = config::load_config();
    info!("[create_workspace] load_config took {:?}", start.elapsed());

    let start = Instant::now();
    let mut persisted = state.persisted.write();
    info!("[create_workspace] acquire write lock took {:?}", start.elapsed());

    let project = persisted
        .projects
        .iter_mut()
        .find(|p| p.path == project_path)
        .ok_or_else(|| format!("Project not found: {}", project_path))?;

    let project_path_buf = Path::new(&project.path).to_path_buf();

    let start = Instant::now();
    let ws = workspace::create_workspace(
        project,
        name,
        cfg.worktree.directory.as_deref(),
    )
    .map_err(map_err)?;
    info!("[create_workspace] workspace::create_workspace took {:?}", start.elapsed());

    // Copy gitignored files if enabled in config (in background thread)
    if cfg.worktree.copy.gitignored {
        let workspace_path = ws.path.clone();
        let workspace_id = ws.id.clone();
        let except = cfg.worktree.copy.except.clone();
        let app_handle = app.clone();

        // Emit copy started event
        let _ = app_handle.emit("workspace-copy-started", &workspace_id);

        std::thread::spawn(move || {
            let start = Instant::now();
            let result = workspace::copy_gitignored_files(
                &project_path_buf,
                Path::new(&workspace_path),
                &except,
            );

            match &result {
                Ok(()) => info!("[create_workspace] background copy_gitignored_files took {:?}", start.elapsed()),
                Err(e) => info!("[create_workspace] background copy_gitignored_files failed: {}", e),
            }

            // Emit copy completed event
            let _ = app_handle.emit("workspace-copy-completed", serde_json::json!({
                "workspaceId": workspace_id,
                "success": result.is_ok(),
                "durationMs": start.elapsed().as_millis() as u64,
            }));
        });
        info!("[create_workspace] spawned background thread for copy_gitignored_files");
    }

    // Start file watcher for this workspace
    let start = Instant::now();
    watcher::watch_workspace(app.clone(), ws.id.clone(), ws.path.clone());
    info!("[create_workspace] watch_workspace took {:?}", start.elapsed());

    drop(persisted);

    let start = Instant::now();
    state.save().map_err(map_err)?;
    info!("[create_workspace] state.save took {:?}", start.elapsed());

    info!("[create_workspace] TOTAL took {:?}", total_start.elapsed());
    Ok(ws)
}

#[tauri::command]
fn list_workspaces(state: State<'_, Arc<AppState>>, project_path: &str) -> Result<Vec<Workspace>> {
    let persisted = state.persisted.read();

    let project = persisted
        .projects
        .iter()
        .find(|p| p.path == project_path)
        .ok_or_else(|| format!("Project not found: {}", project_path))?;

    Ok(project.workspaces.clone())
}

#[tauri::command]
fn delete_workspace(state: State<'_, Arc<AppState>>, workspace_id: &str) -> Result<()> {
    let mut persisted = state.persisted.write();

    // Find the project containing this workspace
    for project in &mut persisted.projects {
        if project.workspaces.iter().any(|w| w.id == workspace_id) {
            workspace::delete_workspace(project, workspace_id).map_err(map_err)?;
            drop(persisted);
            state.save().map_err(map_err)?;
            return Ok(());
        }
    }

    Err(format!("Workspace not found: {}", workspace_id))
}

// PTY commands
#[tauri::command]
fn spawn_main(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    workspace_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find workspace path
    let workspace_path = {
        let persisted = state.persisted.read();
        persisted
            .projects
            .iter()
            .flat_map(|p| &p.workspaces)
            .find(|w| w.id == workspace_id)
            .map(|w| w.path.clone())
            .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?
    };

    pty::spawn_pty(&app, &state, workspace_id, &workspace_path, "main", cols, rows).map_err(map_err)
}

#[tauri::command]
fn spawn_terminal(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    workspace_id: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String> {
    // Find workspace path
    let workspace_path = {
        let persisted = state.persisted.read();
        persisted
            .projects
            .iter()
            .flat_map(|p| &p.workspaces)
            .find(|w| w.id == workspace_id)
            .map(|w| w.path.clone())
            .ok_or_else(|| format!("Workspace not found: {}", workspace_id))?
    };

    pty::spawn_pty(&app, &state, workspace_id, &workspace_path, "shell", cols, rows).map_err(map_err)
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

// Config commands
#[tauri::command]
fn get_config() -> config::Config {
    config::load_config()
}

// Git commands
#[tauri::command]
fn get_changed_files(workspace_path: &str) -> Result<Vec<FileChange>> {
    let path = Path::new(workspace_path);
    git::get_changed_files(path).map_err(map_err)
}

#[tauri::command]
fn start_watching(app: AppHandle, workspace_id: String, workspace_path: String) {
    watcher::watch_workspace(app, workspace_id, workspace_path);
}

#[tauri::command]
fn stop_watching(workspace_id: String) {
    watcher::stop_watching(&workspace_id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let app_state = Arc::new(AppState::load_or_default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            add_project,
            list_projects,
            remove_project,
            create_workspace,
            list_workspaces,
            delete_workspace,
            spawn_main,
            spawn_terminal,
            pty_write,
            pty_resize,
            pty_kill,
            get_changed_files,
            start_watching,
            stop_watching,
            get_config,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                watcher::stop_all_watchers();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
