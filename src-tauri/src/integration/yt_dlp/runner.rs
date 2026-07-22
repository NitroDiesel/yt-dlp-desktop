use std::{ffi::OsString, path::Path, process::Stdio, sync::Arc};

use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
    time::{Duration, sleep},
};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::DownloadProgress,
    error::{AppError, AppResult},
};

use super::parser::{ProtocolEvent, parse_protocol_line};
use super::probe::redact;

#[derive(Debug, Clone)]
pub enum RunnerEvent {
    Progress(DownloadProgress),
    PostProcess(String),
    Output { path: String, title: Option<String> },
    Diagnostic(String),
}

#[derive(Debug)]
pub struct RunnerOutcome {
    pub cancelled: bool,
    pub output_path: Option<String>,
    pub title: Option<String>,
    pub diagnostics: Vec<String>,
    pub error: Option<String>,
}

pub async fn run_download(
    executable: &Path,
    args: Vec<OsString>,
    cancel: CancellationToken,
    events: tokio::sync::mpsc::UnboundedSender<RunnerEvent>,
) -> AppResult<RunnerOutcome> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| AppError::Process(e.to_string()))?;
    let pid = child.id().ok_or_else(|| {
        AppError::Process("The download process has no process identifier".into())
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("yt-dlp stdout is unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Process("yt-dlp stderr is unavailable".into()))?;
    let state = Arc::new(Mutex::new(OutcomeState::default()));
    let stdout_state = state.clone();
    let stdout_events = events.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            match parse_protocol_line(&line) {
                Ok(Some(ProtocolEvent::Download(progress))) => {
                    let _ = stdout_events.send(RunnerEvent::Progress(progress));
                }
                Ok(Some(ProtocolEvent::PostProcess { stage, .. })) => {
                    let _ = stdout_events.send(RunnerEvent::PostProcess(stage));
                }
                Ok(Some(ProtocolEvent::AfterMove { filepath, title })) => {
                    let mut guard = stdout_state.lock().await;
                    guard.output_path = Some(filepath.clone());
                    guard.title = title.clone();
                    let _ = stdout_events.send(RunnerEvent::Output {
                        path: filepath,
                        title,
                    });
                }
                Ok(None) => push_diagnostic(&stdout_state, &stdout_events, line).await,
                Err(error) => {
                    push_diagnostic(
                        &stdout_state,
                        &stdout_events,
                        format!("Progress record ignored: {error}"),
                    )
                    .await
                }
            }
        }
    });
    let stderr_state = state.clone();
    let stderr_events = events.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            push_diagnostic(&stderr_state, &stderr_events, redact(&line)).await;
        }
    });
    let status = tokio::select! {status=child.wait()=>status?,_=cancel.cancelled()=>{terminate_tree(pid,true).await;sleep(Duration::from_secs(2)).await;if child.try_wait()?.is_none(){terminate_tree(pid,false).await;}let _=child.wait().await;let _=stdout_task.await;let _=stderr_task.await;let guard=state.lock().await;return Ok(RunnerOutcome{cancelled:true,output_path:guard.output_path.clone(),title:guard.title.clone(),diagnostics:guard.diagnostics.clone(),error:None});}};
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    let guard = state.lock().await;
    let error = if status.success() {
        None
    } else {
        Some(classify_error(&guard.diagnostics))
    };
    Ok(RunnerOutcome {
        cancelled: false,
        output_path: guard.output_path.clone(),
        title: guard.title.clone(),
        diagnostics: guard.diagnostics.clone(),
        error,
    })
}

#[derive(Default)]
struct OutcomeState {
    output_path: Option<String>,
    title: Option<String>,
    diagnostics: Vec<String>,
    bytes: usize,
}
async fn push_diagnostic(
    state: &Arc<Mutex<OutcomeState>>,
    events: &tokio::sync::mpsc::UnboundedSender<RunnerEvent>,
    line: String,
) {
    let mut guard = state.lock().await;
    let bytes = line.len();
    while (guard.diagnostics.len() >= 250 || guard.bytes + bytes > 256 * 1024)
        && !guard.diagnostics.is_empty()
    {
        let removed = guard.diagnostics.remove(0);
        guard.bytes = guard.bytes.saturating_sub(removed.len());
    }
    guard.bytes += bytes;
    guard.diagnostics.push(line.clone());
    let _ = events.send(RunnerEvent::Diagnostic(line));
}
fn classify_error(lines: &[String]) -> String {
    let text = lines.join("\n").to_lowercase();
    if text.contains("unsupported url") {
        "unsupported_site"
    } else if text.contains("private") || text.contains("sign in") || text.contains("login") {
        "authentication_required"
    } else if text.contains("http error 429") || text.contains("rate limit") {
        "rate_limited"
    } else if text.contains("no space left") || text.contains("disk full") {
        "disk_full"
    } else if text.contains("permission denied") {
        "destination_permission"
    } else if text.contains("ffmpeg") || text.contains("ffprobe") {
        "post_processing_failure"
    } else if text.contains("timed out") || text.contains("network") {
        "network_failure"
    } else {
        "download_failed"
    }
    .into()
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP);
}
#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}
#[cfg(windows)]
async fn terminate_tree(pid: u32, graceful: bool) {
    let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".into()];
    if !graceful {
        args.push("/F".into())
    }
    let _ = Command::new("taskkill.exe")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
}
#[cfg(unix)]
async fn terminate_tree(pid: u32, graceful: bool) {
    unsafe {
        libc::kill(
            -(pid as i32),
            if graceful {
                libc::SIGINT
            } else {
                libc::SIGKILL
            },
        );
    }
}
