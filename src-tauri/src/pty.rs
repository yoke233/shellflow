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

#[cfg(windows)]
fn find_in_path(candidates: &[&str]) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in candidates {
            let full = dir.join(name);
            if full.is_file() {
                return Some(full.to_string_lossy().to_string());
            }
        }
    }
    None
}

/// Get the user's PATH by running their login shell.
/// This ensures we get the same PATH they'd have in a terminal.
fn get_user_path() -> String {
    #[cfg(windows)]
    {
        let fallback = std::env::var("PATH").unwrap_or_default();
        eprintln!("[PTY] Using fallback PATH: {}", fallback);
        return fallback;
    }

    #[cfg(not(windows))]
    {
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
    pub(crate) static ref SHUTDOWN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
}

/// Get the user's PATH, using cached value if available.
/// This runs the user's login shell to get their actual PATH,
/// which may differ from the process environment.
pub fn get_cached_user_path() -> String {
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

    #[cfg(windows)]
    let shell = {
        let preferred = ["pwsh.exe", "pwsh", "powershell.exe", "powershell", "cmd.exe", "cmd"];
        if let Some(found) = find_in_path(&preferred) {
            found
        } else {
            "cmd.exe".to_string()
        }
    };

    #[cfg(not(windows))]
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    *cache = Some(shell.clone());
    shell
}

pub fn get_default_shell_command() -> String {
    get_cached_user_shell()
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
    env_vars: Option<&std::collections::HashMap<String, String>>,
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

    // "shell" is a special command that spawns the user's login shell
    // Any other command is run through the shell with -c to support shell features

    // Use shell override if provided, otherwise use cached user shell
    let shell = shell_override
        .map(|s| s.to_string())
        .unwrap_or_else(get_cached_user_shell);

    // Parse command into executable and arguments.
    // If the entire command is an existing path (common on Windows), treat it as the executable.
    let trimmed_command = command.trim();
    let (executable, args) = if trimmed_command.is_empty() {
        (command, vec![])
    } else {
        let unquoted = if trimmed_command.starts_with('"') && trimmed_command.ends_with('"') && trimmed_command.len() >= 2 {
            &trimmed_command[1..trimmed_command.len() - 1]
        } else {
            trimmed_command
        };
        if std::path::Path::new(unquoted).is_file() {
            (unquoted, Vec::new())
        } else {
            let parts: Vec<&str> = trimmed_command.split_whitespace().collect();
            if parts.is_empty() {
                (trimmed_command, Vec::new())
            } else {
                (parts[0], parts[1..].to_vec())
            }
        }
    };

    eprintln!("[PTY] Spawning command: '{}' in '{}' (raw: '{}')", executable, worktree_path, command);
    eprintln!("[PTY] PATH length: {} chars", user_path.len());
    eprintln!("[PTY] Worktree path exists: {}", std::path::Path::new(worktree_path).exists());

    // Known shell commands that should be run as login shells
    #[cfg(windows)]
    let shell_commands = ["pwsh", "pwsh.exe", "powershell", "powershell.exe", "cmd", "cmd.exe"];
    #[cfg(not(windows))]
    let shell_commands = ["fish", "bash", "zsh", "sh"];

    let is_shell_command = shell_commands
        .iter()
        .any(|s| executable.eq_ignore_ascii_case(*s) || executable.ends_with(&format!("/{}", s)));

    let shell_lower = shell.to_lowercase();
    let is_pwsh = shell_lower.ends_with("pwsh") || shell_lower.ends_with("pwsh.exe");
    let is_powershell = shell_lower.ends_with("powershell") || shell_lower.ends_with("powershell.exe");
    let is_cmd = shell_lower.ends_with("cmd") || shell_lower.ends_with("cmd.exe");

    let mut cmd = if command == "shell" {
        let mut cmd = CommandBuilder::new(&shell);
        #[cfg(not(windows))]
        cmd.arg("-l");
        cmd.cwd(worktree_path);
        cmd
    } else if shell_override.is_some() {
        // When shell is explicitly specified, run the command through that shell
        let mut cmd = CommandBuilder::new(&shell);
        #[cfg(windows)]
        {
            if is_pwsh || is_powershell {
                cmd.arg("-NoProfile");
                cmd.arg("-Command");
            } else if is_cmd {
                cmd.arg("/C");
            } else {
                cmd.arg("-c");
            }
        }
        #[cfg(not(windows))]
        {
            cmd.arg("-c");
        }
        cmd.arg(command);
        cmd.cwd(worktree_path);
        eprintln!("[PTY] Running command via {}: {:?}", shell, command);
        cmd
    } else if is_shell_command {
        #[cfg(windows)]
        {
            // Run shell commands directly on Windows
            let mut cmd = CommandBuilder::new(executable);
            for arg in &args {
                cmd.arg(*arg);
            }
            cmd.cwd(worktree_path);
            eprintln!("[PTY] Running {} with args {:?} (shell mode)", executable, args);
            cmd
        }
        #[cfg(not(windows))]
        {
            // Run shell commands via /usr/bin/env to avoid exec issues with portable_pty
            // See: https://github.com/rust-lang/rust/issues/125952
            let mut cmd = CommandBuilder::new("/usr/bin/env");
            cmd.arg(executable);
            for arg in &args {
                cmd.arg(*arg);
            }
            cmd.cwd(worktree_path);
            eprintln!("[PTY] Running {} via /usr/bin/env with args {:?} (shell mode)", executable, args);
            cmd
        }
    } else {
        // Run non-shell commands directly
        let mut cmd = CommandBuilder::new(executable);
        for arg in &args {
            cmd.arg(*arg);
        }
        cmd.cwd(worktree_path);
        cmd
    };

    cmd.env("PATH", &user_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Ensure essential environment variables are set
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", user);
    }
    if let Ok(shell) = std::env::var("SHELL") {
        cmd.env("SHELL", shell);
    }
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", lang);
    }
    if let Ok(lc_all) = std::env::var("LC_ALL") {
        cmd.env("LC_ALL", lc_all);
    }
    // Set LC_ALL to a sensible default if not set
    if std::env::var("LC_ALL").is_err() && std::env::var("LANG").is_ok() {
        cmd.env("LC_ALL", std::env::var("LANG").unwrap());
    }
    if let Ok(xdg_config) = std::env::var("XDG_CONFIG_HOME") {
        cmd.env("XDG_CONFIG_HOME", xdg_config);
    }
    if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
        cmd.env("XDG_DATA_HOME", xdg_data);
    }
    // PWD is important for some shells
    cmd.env("PWD", worktree_path);

    // Apply custom environment variables from task config
    if let Some(env) = env_vars {
        for (key, value) in env {
            eprintln!("[PTY] Setting env {}={}", key, value);
            cmd.env(key, value);
        }
    }

    // Log the environment we're setting
    eprintln!("[PTY] HOME={:?}", std::env::var("HOME"));
    eprintln!("[PTY] USER={:?}", std::env::var("USER"));
    eprintln!("[PTY] SHELL={:?}", std::env::var("SHELL"));
    eprintln!("[PTY] Command built, spawning child...");

    let child = pair.slave.spawn_command(cmd)?;
    let child_pid = child.process_id().unwrap_or(0);
    eprintln!("[PTY] Child spawned with PID: {}", child_pid);

    // Track PID for crash recovery
    if child_pid > 0 {
        crate::cleanup::add_pid(child_pid);
    }

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
    let child_pid_for_cleanup = child_pid;

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
                        // Debug: show first read content
                        if read_count == 1 {
                            let preview = String::from_utf8_lossy(&buf[..n.min(200)]);
                            eprintln!("[PTY:{}] First read content: {:?}", pty_id_clone, preview);
                        }
                    }

                    // Emit pty-ready event on first substantial output
                    if !ready_emitted_clone.load(Ordering::SeqCst) && total_bytes > 50 {
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

        // Remove PID from crash recovery tracking
        if child_pid_for_cleanup > 0 {
            crate::cleanup::remove_pid(child_pid_for_cleanup);
        }

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

/// Send SIGINT to interrupt the foreground process in a PTY session
#[cfg(unix)]
pub fn interrupt_pty(state: &AppState, pty_id: &str) -> Result<(), PtyError> {
    use libc::SIGINT;

    // Get the child PID
    let child_pid = state
        .pty_sessions
        .read()
        .get(pty_id)
        .map(|s| s.child_pid);

    if let Some(pid) = child_pid {
        // Send SIGINT to the entire process group by using negative PID.
        // The shell spawned by the PTY is the process group leader, so -pid
        // sends the signal to the shell and all its children (like `yes`).
        // This is instant, unlike using pgrep to find children.
        let result = unsafe { libc::kill(-(pid as i32), SIGINT) == 0 };

        // Fallback: send directly to the process in case it's not in the same group
        if !result {
            send_signal(pid, SIGINT);
        }
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn interrupt_pty(_state: &AppState, _pty_id: &str) -> Result<(), PtyError> {
    // On non-Unix, this is a no-op (Ctrl+C should work via terminal)
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
pub(crate) fn is_process_alive(pid: u32) -> bool {
    // kill with signal 0 checks if process exists without sending a signal
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

/// Get process name from PID using ps command
#[cfg(unix)]
pub(crate) fn get_process_name(pid: u32) -> Option<String> {
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
pub(crate) fn send_signal(pid: u32, signal: i32) -> bool {
    unsafe { libc::kill(pid as i32, signal) == 0 }
}

/// Get all child PIDs of a process (recursive)
#[cfg(unix)]
pub(crate) fn get_child_pids(pid: u32) -> Vec<u32> {
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

    // Delete PID file on clean shutdown
    crate::cleanup::delete_pid_file();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn test_interrupt_pty_returns_ok_for_missing_session() {
        // interrupt_pty should not panic or error when session doesn't exist
        let state = AppState::new();
        let result = interrupt_pty(&state, "nonexistent-pty-id");
        assert!(result.is_ok(), "interrupt_pty should succeed even for missing session");
    }

    #[test]
    fn test_kill_pty_returns_ok_for_missing_session() {
        // kill_pty should not panic or error when session doesn't exist
        let state = AppState::new();
        let result = kill_pty(&state, "nonexistent-pty-id");
        assert!(result.is_ok(), "kill_pty should succeed even for missing session");
    }

    #[test]
    fn test_force_kill_pty_returns_ok_for_missing_session() {
        // force_kill_pty should not panic or error when session doesn't exist
        let state = AppState::new();
        let result = force_kill_pty(&state, "nonexistent-pty-id");
        assert!(result.is_ok(), "force_kill_pty should succeed even for missing session");
    }

    #[test]
    fn test_write_to_pty_returns_error_for_missing_session() {
        // write_to_pty should return an error when session doesn't exist
        let state = AppState::new();
        let result = write_to_pty(&state, "nonexistent-pty-id", "test data");
        assert!(result.is_err(), "write_to_pty should error for missing session");

        let err = result.unwrap_err();
        match err {
            PtyError::SessionNotFound(id) => {
                assert_eq!(id, "nonexistent-pty-id");
            }
            _ => panic!("Expected SessionNotFound error, got {:?}", err),
        }
    }

    #[test]
    fn test_resize_pty_returns_error_for_missing_session() {
        // resize_pty should return an error when session doesn't exist
        let state = AppState::new();
        let result = resize_pty(&state, "nonexistent-pty-id", 80, 24);
        assert!(result.is_err(), "resize_pty should error for missing session");

        let err = result.unwrap_err();
        match err {
            PtyError::SessionNotFound(id) => {
                assert_eq!(id, "nonexistent-pty-id");
            }
            _ => panic!("Expected SessionNotFound error, got {:?}", err),
        }
    }

    #[cfg(unix)]
    #[test]
    fn test_send_signal_returns_false_for_nonexistent_pid() {
        // send_signal should return false for a PID that doesn't exist
        // Using a very high PID that is unlikely to exist
        let result = send_signal(4194304, libc::SIGINT);
        assert!(!result, "Signal to nonexistent PID should fail");
    }

    #[cfg(unix)]
    #[test]
    fn test_is_process_alive_returns_false_for_invalid_pid() {
        // is_process_alive should return false for PID that doesn't exist
        let result = is_process_alive(999999999);
        assert!(!result, "Invalid PID should not be alive");
    }

    #[cfg(unix)]
    #[test]
    fn test_get_child_pids_returns_empty_for_invalid_pid() {
        // get_child_pids should return empty vec for PID that doesn't exist
        let children = get_child_pids(999999999);
        assert!(children.is_empty(), "Invalid PID should have no children");
    }

    #[cfg(unix)]
    #[test]
    fn test_get_process_name_returns_none_for_invalid_pid() {
        // get_process_name should return None for PID that doesn't exist
        let name = get_process_name(999999999);
        assert!(name.is_none(), "Invalid PID should have no process name");
    }

    #[test]
    fn test_get_cached_user_path_returns_non_empty() {
        // get_cached_user_path should return a non-empty PATH
        let path = get_cached_user_path();
        assert!(!path.is_empty(), "User PATH should not be empty");
    }

    #[test]
    fn test_get_cached_user_shell_returns_valid_shell() {
        // get_cached_user_shell should return a valid shell path
        let shell = get_cached_user_shell();
        assert!(!shell.is_empty(), "User shell should not be empty");
        assert!(shell.contains("sh"), "Shell should contain 'sh': {}", shell);
    }
}
