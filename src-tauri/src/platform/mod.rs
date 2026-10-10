use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use tokio::process::Command;

use crate::error::{AppError, AppResult};

/// Moves a file to the Recycle Bin (Windows) or Trash (macOS and Linux), so it can
/// be restored.
pub async fn move_to_trash(path: PathBuf) -> AppResult<()> {
    tokio::task::spawn_blocking(move || trash::delete(&path))
        .await
        .map_err(|error| AppError::Process(error.to_string()))?
        .map_err(|error| {
            AppError::Process(format!("The file couldn't be moved to the trash: {error}"))
        })
}

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
