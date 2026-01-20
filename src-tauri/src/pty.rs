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
}

pub fn spawn_pty(
    app: &AppHandle,
    state: &AppState,
    workspace_id: &str,
    workspace_path: &str,
    command: &str,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, PtyError> {
    let pty_system = native_pty_system();

    let pair = pty_system.openpty(PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    })?;

    // Get user's PATH from their login shell
    let user_path = get_user_path();

    eprintln!("[PTY] Spawning command: {} in {}", command, workspace_path);

    let mut cmd = if command == "main" {
        let mut cmd = CommandBuilder::new("claude");
        cmd.cwd(workspace_path);
        cmd
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.cwd(workspace_path);
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
        workspace_id: workspace_id.to_string(),
        child_pid,
    });
    state.pty_sessions.write().insert(pty_id.clone(), session);

    // Spawn reader thread
    let app_handle = app.clone();
    let pty_id_clone = pty_id.clone();
    let workspace_id_clone = workspace_id.to_string();
    let is_main_command = command == "main";
    let ready_emitted = Arc::new(AtomicBool::new(false));
    let ready_emitted_clone = ready_emitted.clone();

    thread::spawn(move || {
        eprintln!("[PTY:{}] Reader thread started", pty_id_clone);
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
                        eprintln!("[PTY:{}] Emitting pty-ready event for workspace {}", pty_id_clone, workspace_id_clone);
                        let _ = app_handle.emit("pty-ready", serde_json::json!({
                            "ptyId": pty_id_clone,
                            "workspaceId": workspace_id_clone,
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
        eprintln!("[PTY:{}] Reader thread exiting", pty_id_clone);
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

pub fn kill_pty(state: &AppState, pty_id: &str) -> Result<(), PtyError> {
    state.pty_sessions.write().remove(pty_id);
    PTY_WRITERS.lock().remove(pty_id);
    PTY_MASTERS.lock().remove(pty_id);
    Ok(())
}
