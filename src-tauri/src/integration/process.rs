#[cfg(windows)]
use std::process::Stdio;

use tokio::process::Command;

#[cfg(windows)]
const BACKGROUND_PROCESS_FLAGS: u32 = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

#[cfg(windows)]
const GROUPED_BACKGROUND_PROCESS_FLAGS: u32 =
    BACKGROUND_PROCESS_FLAGS | windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;

pub(crate) fn configure_background_process(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(BACKGROUND_PROCESS_FLAGS);

    #[cfg(not(windows))]
    let _ = command;
}

pub(crate) fn configure_grouped_background_process(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(GROUPED_BACKGROUND_PROCESS_FLAGS);

    #[cfg(unix)]
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
pub(crate) async fn terminate_process_tree(pid: u32, graceful: bool) {
    let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".into()];
    if !graceful {
        args.push("/F".into());
    }
    let mut command = Command::new("taskkill.exe");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_background_process(&mut command);
    let _ = command.status().await;
}

#[cfg(unix)]
pub(crate) async fn terminate_process_tree(pid: u32, graceful: bool) {
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn background_processes_never_create_console_windows() {
        let no_window = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
        let new_group = windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;

        assert_ne!(BACKGROUND_PROCESS_FLAGS & no_window, 0);
        assert_ne!(GROUPED_BACKGROUND_PROCESS_FLAGS & no_window, 0);
        assert_ne!(GROUPED_BACKGROUND_PROCESS_FLAGS & new_group, 0);
    }
}
