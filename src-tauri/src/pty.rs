use crate::state::{AppState, PtySession};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use uuid::Uuid;

#[cfg(unix)]
use std::process::Command;

/// Get the user's PATH by running their login shell.
/// This ensures we get the same PATH they'd have in a terminal.
fn get_user_path() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    eprintln!("[PTY] Using shell: {}", shell);

    // Run login shell and use printenv (works consistently across bash/zsh/fish)
    if let Ok(output) = std::process::Command::new(&shell)
        .args(["-l", "-c", "printenv PATH"])
        .output()
    {
        eprintln!("[PTY] Shell exit status: {:?}", output.status);
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    eprintln!("[PTY] Got PATH with {} chars", path.len());
                    return path.to_string();
                }
            }
        } else {
            eprintln!("[PTY] Shell stderr: {}", String::from_utf8_lossy(&output.stderr));
        }
    }

    // Fallback to current PATH or empty
    let fallback = std::env::var("PATH").unwrap_or_default();
    eprintln!("[PTY] Using fallback PATH: {}", fallback);
    fallback
}

#[derive(Error, Debug)]
pub enum PtyError {
    #[error("PTY error: {0}")]
    Pty(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
}

impl From<Box<dyn std::error::Error + Send + Sync>> for PtyError {
    fn from(err: Box<dyn std::error::Error + Send + Sync>) -> Self {
        PtyError::Pty(err.to_string())
    }
}

impl From<anyhow::Error> for PtyError {
    fn from(err: anyhow::Error) -> Self {
        PtyError::Pty(err.to_string())
    }
}

#[derive(Clone, serde::Serialize)]
pub struct PtyOutput {
    pub pty_id: String,
    pub data: String,
}

// Thread-safe writer wrapper
struct PtyWriter {
    writer: Box<dyn Write + Send>,
}

impl PtyWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()
    }
}

// Global storage for PTY writers (separate from AppState for thread safety)
lazy_static::lazy_static! {
    static ref PTY_WRITERS: Mutex<HashMap<String, Arc<Mutex<PtyWriter>>>> = Mutex::new(HashMap::new());
    static ref PTY_MASTERS: Mutex<HashMap<String, Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>>> = Mutex::new(HashMap::new());
    // Cache the user's PATH to avoid spawning shell on every PTY creation
    static ref CACHED_USER_PATH: Mutex<Option<String>> = Mutex::new(None);
    // Cache the user's shell
    static ref CACHED_USER_SHELL: Mutex<Option<String>> = Mutex::new(None);
    // Track if shutdown is already in progress
    static ref SHUTDOWN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
}

/// Get the user's PATH, using cached value if available
fn get_cached_user_path() -> String {
    let mut cache = CACHED_USER_PATH.lock();
    if let Some(path) = cache.as_ref() {
        return path.clone();
    }
    let path = get_user_path();
    *cache = Some(path.clone());
    path
}

/// Get the user's shell, using cached value if available
fn get_cached_user_shell() -> String {
    let mut cache = CACHED_USER_SHELL.lock();
    if let Some(shell) = cache.as_ref() {
        return shell.clone();
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    *cache = Some(shell.clone());
    shell
}

pub fn spawn_pty(
    app: &AppHandle,
    state: &AppState,
    worktree_id: &str,
    worktree_path: &str,
    command: &str,
    cols: Option<u16>,
    rows: Option<u16>,
    shell_override: Option<&str>,
) -> Result<String, PtyError> {
    let pty_system = native_pty_system();

    let pair = pty_system.openpty(PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    })?;

    // Get user's PATH (cached after first call)
    let user_path = get_cached_user_path();

    eprintln!("[PTY] Spawning command: {} in {}", command, worktree_path);

    // "shell" is a special command that spawns the user's login shell
    // Any other command is run through the shell with -c to support shell features
    let is_main_command = command != "shell";

    // Use shell override if provided, otherwise use cached user shell
    let shell = shell_override
        .map(|s| s.to_string())
        .unwrap_or_else(get_cached_user_shell);

    let mut cmd = if command == "shell" {
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.cwd(worktree_path);
        cmd
    } else {
        // Run command through shell to support pipes, aliases, arguments, etc.
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-c");
        cmd.arg(command);
        cmd.cwd(worktree_path);
        cmd
    };

    cmd.env("PATH", &user_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    eprintln!("[PTY] Command built, spawning child...");

    let child = pair.slave.spawn_command(cmd)?;
    let child_pid = child.process_id().unwrap_or(0);
    eprintln!("[PTY] Child spawned with PID: {}", child_pid);

    let pty_id = Uuid::new_v4().to_string();

    // Store the master for resize operations
    PTY_MASTERS.lock().insert(
        pty_id.clone(),
        Arc::new(Mutex::new(pair.master)),
    );

    // Get writer and reader from the master we just stored
    let master = PTY_MASTERS.lock().get(&pty_id).unwrap().clone();
    let writer = master.lock().take_writer()?;
    let reader = master.lock().try_clone_reader()?;

    // Store the writer
    PTY_WRITERS.lock().insert(
        pty_id.clone(),
        Arc::new(Mutex::new(PtyWriter { writer })),
    );

    // Store session info in app state
    let session = Arc::new(PtySession {
        worktree_id: worktree_id.to_string(),
        child_pid,
    });
    state.pty_sessions.write().insert(pty_id.clone(), session);

    // Spawn reader thread
    let app_handle = app.clone();
    let pty_id_clone = pty_id.clone();
    let worktree_id_clone = worktree_id.to_string();
    let command_name = command.to_string();
    let ready_emitted = Arc::new(AtomicBool::new(false));
    let ready_emitted_clone = ready_emitted.clone();

    thread::spawn(move || {
        eprintln!("[PTY:{}] Reader thread started", pty_id_clone);
        let mut child = child;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut consecutive_empty = 0;
        let mut total_bytes = 0usize;
        let mut read_count = 0usize;
        // Buffer for incomplete UTF-8 sequences (max 3 bytes needed)
        let mut utf8_buf: Vec<u8> = Vec::with_capacity(4);

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF - but add backoff to prevent spinning if read is non-blocking
                    consecutive_empty += 1;
                    if consecutive_empty > 10 {
                        eprintln!("[PTY:{}] EOF after {} reads, {} bytes total", pty_id_clone, read_count, total_bytes);
                        break;
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Ok(n) => {
                    consecutive_empty = 0;
                    read_count += 1;
                    total_bytes += n;
                    if read_count <= 5 || read_count % 100 == 0 {
                        eprintln!("[PTY:{}] Read {} bytes (total: {})", pty_id_clone, n, total_bytes);
                    }

                    // Emit pty-ready event on first substantial output for main command
                    if is_main_command && !ready_emitted_clone.load(Ordering::SeqCst) && total_bytes > 50 {
                        ready_emitted_clone.store(true, Ordering::SeqCst);
                        eprintln!("[PTY:{}] Emitting pty-ready event for worktree {}", pty_id_clone, worktree_id_clone);
                        let _ = app_handle.emit("pty-ready", serde_json::json!({
                            "ptyId": pty_id_clone,
                            "worktreeId": worktree_id_clone,
                        }));
                    }

                    // Combine any leftover bytes with new data
                    utf8_buf.extend_from_slice(&buf[..n]);

                    // Find the last valid UTF-8 boundary
                    let valid_up_to = match std::str::from_utf8(&utf8_buf) {
                        Ok(_) => utf8_buf.len(),
                        Err(e) => e.valid_up_to(),
                    };

                    if valid_up_to > 0 {
                        // Safe because we just validated this portion
                        let data = unsafe {
                            std::str::from_utf8_unchecked(&utf8_buf[..valid_up_to])
                        }.to_string();

                        let _ = app_handle.emit(
                            "pty-output",
                            PtyOutput {
                                pty_id: pty_id_clone.clone(),
                                data,
                            },
                        );
                    }

                    // Keep any incomplete bytes for next read
                    let leftover = utf8_buf.split_off(valid_up_to);
                    utf8_buf = leftover;
                }
                Err(e) => {
                    eprintln!("[PTY:{}] Read error: {:?}", pty_id_clone, e);
                    // Check if it's a "would block" error (non-blocking read)
                    if e.kind() == std::io::ErrorKind::WouldBlock {
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    break;
                }
            }
        }
        // Wait for child process to get exit status
        let exit_code = match child.wait() {
            Ok(status) => {
                eprintln!("[PTY:{}] Child exited with status: {:?}", pty_id_clone, status);
                Some(status.exit_code())
            }
            Err(e) => {
                eprintln!("[PTY:{}] Failed to wait for child: {:?}", pty_id_clone, e);
                None
            }
        };

        eprintln!("[PTY:{}] Reader thread exiting, emitting pty-exit event", pty_id_clone);
        let _ = app_handle.emit("pty-exit", serde_json::json!({
            "ptyId": pty_id_clone,
            "worktreeId": worktree_id_clone,
            "command": command_name,
            "exitCode": exit_code,
        }));
    });

    Ok(pty_id)
}

pub fn write_to_pty(_state: &AppState, pty_id: &str, data: &str) -> Result<(), PtyError> {
    let writers = PTY_WRITERS.lock();
    let writer = writers
        .get(pty_id)
        .ok_or_else(|| PtyError::SessionNotFound(pty_id.to_string()))?
        .clone();
    drop(writers);

    writer.lock().write(data.as_bytes())?;
    Ok(())
}

pub fn resize_pty(_state: &AppState, pty_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
    let masters = PTY_MASTERS.lock();
    let master = masters
        .get(pty_id)
        .ok_or_else(|| PtyError::SessionNotFound(pty_id.to_string()))?
        .clone();
    drop(masters);

    master.lock().resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    Ok(())
}

/// Kill a PTY session with SIGTERM (can be caught/ignored by the process)
#[cfg(unix)]
pub fn kill_pty(state: &AppState, pty_id: &str) -> Result<(), PtyError> {
    use libc::SIGTERM;

    // Get the child PID before removing session
    let child_pid = state
        .pty_sessions
        .read()
        .get(pty_id)
        .map(|s| s.child_pid);

    if let Some(pid) = child_pid {
        // Kill all children first, then the main process
        let children = get_child_pids(pid);
        for child_pid in children {
            send_signal(child_pid, SIGTERM);
        }
        send_signal(pid, SIGTERM);
    }

    // Note: Don't clean up state here - wait for pty-exit event
    // The process might still be running if it ignores SIGTERM
    Ok(())
}

#[cfg(not(unix))]
pub fn kill_pty(state: &AppState, pty_id: &str) -> Result<(), PtyError> {
    // On non-Unix, just remove the session (will close the PTY)
    state.pty_sessions.write().remove(pty_id);
    PTY_WRITERS.lock().remove(pty_id);
    PTY_MASTERS.lock().remove(pty_id);
    Ok(())
}

/// Force kill a PTY session with SIGKILL (cannot be ignored)
#[cfg(unix)]
pub fn force_kill_pty(state: &AppState, pty_id: &str) -> Result<(), PtyError> {
    use libc::SIGKILL;

    // Get the child PID before removing session
    let child_pid = state
        .pty_sessions
        .read()
        .get(pty_id)
        .map(|s| s.child_pid);

    if let Some(pid) = child_pid {
        // Kill all children first, then the main process
        let children = get_child_pids(pid);
        for child_pid in children {
            send_signal(child_pid, SIGKILL);
        }
        send_signal(pid, SIGKILL);
    }

    // Clean up state
    state.pty_sessions.write().remove(pty_id);
    PTY_WRITERS.lock().remove(pty_id);
    PTY_MASTERS.lock().remove(pty_id);
    Ok(())
}

#[cfg(not(unix))]
pub fn force_kill_pty(state: &AppState, pty_id: &str) -> Result<(), PtyError> {
    // On non-Unix, just do regular kill
    kill_pty(state, pty_id)
}

/// Shutdown progress event payload
#[derive(Clone, serde::Serialize)]
pub struct ShutdownProgress {
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

/// Check if a process is still running
#[cfg(unix)]
fn is_process_alive(pid: u32) -> bool {
    // kill with signal 0 checks if process exists without sending a signal
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

/// Get process name from PID using ps command
#[cfg(unix)]
fn get_process_name(pid: u32) -> Option<String> {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            }
        })
}

/// Send a signal to a process
#[cfg(unix)]
fn send_signal(pid: u32, signal: i32) -> bool {
    unsafe { libc::kill(pid as i32, signal) == 0 }
}

/// Get all child PIDs of a process (recursive)
#[cfg(unix)]
fn get_child_pids(pid: u32) -> Vec<u32> {
    let mut children = Vec::new();

    // Use pgrep to find children
    if let Ok(output) = Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                for line in stdout.lines() {
                    if let Ok(child_pid) = line.trim().parse::<u32>() {
                        // Recursively get children of this child
                        children.extend(get_child_pids(child_pid));
                        children.push(child_pid);
                    }
                }
            }
        }
    }

    children
}

/// Shutdown all PTY sessions gracefully with cascading signals
/// Returns when all processes have been terminated
#[cfg(unix)]
pub fn shutdown_all_ptys(app: &AppHandle, state: &AppState) {
    use libc::{SIGHUP, SIGKILL, SIGTERM};

    // Prevent double-shutdown
    if SHUTDOWN_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }

    let emit_progress = |phase: &str, message: &str, process_name: Option<String>, pid: Option<u32>, signal: Option<&str>| {
        let _ = app.emit("shutdown-progress", ShutdownProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            process_name,
            pid,
            signal: signal.map(|s| s.to_string()),
        });
    };

    // Collect all PIDs and their children
    let sessions: Vec<(String, u32)> = {
        let sessions = state.pty_sessions.read();
        sessions.iter().map(|(id, s)| (id.clone(), s.child_pid)).collect()
    };

    // If no sessions, emit complete immediately and return
    if sessions.is_empty() {
        emit_progress("complete", "Done", None, None, None);
        return;
    }

    emit_progress("starting", "Cleaning up...", None, None, None);

    // Build a list of all PIDs to kill (PTY processes + their children)
    let mut all_pids: Vec<(u32, Option<String>)> = Vec::new();

    for (_, pid) in &sessions {
        if *pid == 0 || !is_process_alive(*pid) {
            continue;
        }

        // Get children first (we want to kill them in reverse order: children before parents)
        let children = get_child_pids(*pid);
        for child_pid in children {
            if is_process_alive(child_pid) {
                let name = get_process_name(child_pid);
                all_pids.push((child_pid, name));
            }
        }

        // Then add the parent
        let name = get_process_name(*pid);
        all_pids.push((*pid, name));
    }

    // Remove duplicates while preserving order
    let mut seen = std::collections::HashSet::new();
    all_pids.retain(|(pid, _)| seen.insert(*pid));

    emit_progress("signaling", &format!("Terminating {} processes...", all_pids.len()), None, None, None);

    // Phase 1: Send SIGHUP to all processes
    for (pid, _) in &all_pids {
        if is_process_alive(*pid) {
            send_signal(*pid, SIGHUP);
        }
    }

    // Wait for processes to exit
    thread::sleep(Duration::from_millis(500));

    // Phase 2: Send SIGTERM to remaining processes
    let remaining: Vec<_> = all_pids.iter().filter(|(pid, _)| is_process_alive(*pid)).cloned().collect();
    if !remaining.is_empty() {
        for (pid, _) in &remaining {
            if is_process_alive(*pid) {
                send_signal(*pid, SIGTERM);
            }
        }
        thread::sleep(Duration::from_millis(500));
    }

    // Phase 3: Force kill any remaining processes
    let remaining: Vec<_> = all_pids.iter().filter(|(pid, _)| is_process_alive(*pid)).cloned().collect();
    if !remaining.is_empty() {
        emit_progress("signaling", &format!("Force killing {} processes...", remaining.len()), None, None, None);
        for (pid, _) in &remaining {
            if is_process_alive(*pid) {
                send_signal(*pid, SIGKILL);
            }
        }
    }

    // Clean up internal state
    for (pty_id, _) in &sessions {
        state.pty_sessions.write().remove(pty_id);
        PTY_WRITERS.lock().remove(pty_id);
        PTY_MASTERS.lock().remove(pty_id);
    }

    emit_progress("complete", "All processes terminated", None, None, None);
}

#[cfg(not(unix))]
pub fn shutdown_all_ptys(app: &AppHandle, state: &AppState) {
    // On non-Unix platforms, just clean up the state
    let _ = app.emit("shutdown-progress", ShutdownProgress {
        phase: "complete".to_string(),
        message: "Cleanup complete".to_string(),
        process_name: None,
        pid: None,
        signal: None,
    });

    let pty_ids: Vec<String> = state.pty_sessions.read().keys().cloned().collect();
    for pty_id in pty_ids {
        state.pty_sessions.write().remove(&pty_id);
        PTY_WRITERS.lock().remove(&pty_id);
        PTY_MASTERS.lock().remove(&pty_id);
    }
}
