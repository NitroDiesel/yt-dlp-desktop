use std::{path::Path, process::Stdio};

use tokio::process::Command;

use crate::error::{AppError, AppResult};

pub async fn open_path(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::Validation(
            "The downloaded file no longer exists".into(),
        ));
    }
    let mut command = platform_command(path, false);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}
pub async fn reveal_path(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::Validation(
            "The downloaded file no longer exists".into(),
        ));
    }
    let mut command = platform_command(path, true);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

#[cfg(windows)]
fn platform_command(path: &Path, reveal: bool) -> Command {
    let mut command = Command::new("explorer.exe");
    if reveal {
        command.arg(format!("/select,{}", path.to_string_lossy()));
    } else {
        command.arg(path);
    }
    command
}
#[cfg(target_os = "macos")]
fn platform_command(path: &Path, reveal: bool) -> Command {
    let mut command = Command::new("open");
    if reveal {
        command.arg("-R");
    }
    command.arg(path);
    command
}
#[cfg(all(unix, not(target_os = "macos")))]
fn platform_command(path: &Path, reveal: bool) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(if reveal {
        path.parent().unwrap_or(path)
    } else {
        path
    });
    command
}
