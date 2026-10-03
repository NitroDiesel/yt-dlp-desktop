use std::{path::Path, process::Stdio};

use tokio::process::Command;

use crate::error::{AppError, AppResult};

pub async fn open_path(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::Validation(
            "The downloaded file no longer exists".into(),
        ));
    }
    let mut command = platform_command(path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

#[cfg(windows)]
fn platform_command(path: &Path) -> Command {
    let mut command = Command::new("explorer.exe");
    command.arg(path);
    command
}
#[cfg(target_os = "macos")]
fn platform_command(path: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg(path);
    command
}
#[cfg(all(unix, not(target_os = "macos")))]
fn platform_command(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
}
