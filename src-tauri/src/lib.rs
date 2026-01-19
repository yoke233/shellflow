mod git;
mod pty;
mod state;
mod watcher;
mod workspace;

use state::{AppState, FileChange, Project, Workspace};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State};

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

// Workspace commands
#[tauri::command]
fn create_workspace(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_path: &str,
    name: Option<String>,
) -> Result<Workspace> {
    let mut persisted = state.persisted.write();

    let project = persisted
        .projects
        .iter_mut()
        .find(|p| p.path == project_path)
        .ok_or_else(|| format!("Project not found: {}", project_path))?;

    let ws = workspace::create_workspace(project, name).map_err(map_err)?;

    // Start file watcher for this workspace
    watcher::watch_workspace(app.clone(), ws.id.clone(), ws.path.clone());

    drop(persisted);
    state.save().map_err(map_err)?;

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
fn spawn_claude(
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

    pty::spawn_pty(&app, &state, workspace_id, &workspace_path, "claude", cols, rows).map_err(map_err)
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
    let app_state = Arc::new(AppState::load_or_default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            add_project,
            list_projects,
            create_workspace,
            list_workspaces,
            delete_workspace,
            spawn_claude,
            spawn_terminal,
            pty_write,
            pty_resize,
            pty_kill,
            get_changed_files,
            start_watching,
            stop_watching,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                watcher::stop_all_watchers();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
