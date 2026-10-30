use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::{
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub version: String,
    pub current_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// New app releases from the signed `latest.json` on GitHub Releases. The
/// update found by the last check waits here until the UI installs it.
#[derive(Default)]
pub struct AppUpdates {
    pending: Mutex<Option<Update>>,
}

impl AppUpdates {
    pub async fn check(
        &self,
        app: &AppHandle,
        proxy: Option<&str>,
    ) -> AppResult<Option<AppUpdateInfo>> {
        // Development builds carry the next version and must never replace themselves.
        if cfg!(debug_assertions) {
            return Ok(None);
        }
        let mut builder = app.updater_builder().timeout(Duration::from_secs(30));
        if let Some(proxy) = proxy.and_then(|proxy| url::Url::parse(proxy).ok()) {
            builder = builder.proxy(proxy);
        }
        let update = builder
            .build()
            .map_err(update_error)?
            .check()
            .await
            .map_err(update_error)?;
        let info = update.as_ref().map(|update| AppUpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
        });
        *self.pending.lock().await = update;
        Ok(info)
    }

    /// Downloads, verifies, and installs the pending update, then restarts.
    /// On Windows the installer closes the app itself and starts it again.
    pub async fn install(&self, app: &AppHandle) -> AppResult<()> {
        let update = self
            .pending
            .lock()
            .await
            .clone()
            .ok_or_else(|| AppError::Validation("There is no update to install".into()))?;
        let mut downloaded = 0_u64;
        let mut last_emit: Option<Instant> = None;
        update
            .download_and_install(
                |chunk, total| {
                    downloaded += chunk as u64;
                    let now = Instant::now();
                    if last_emit.is_none_or(|last| now - last >= Duration::from_millis(250)) {
                        last_emit = Some(now);
                        let _ = app.emit(
                            "app-update-progress",
                            AppUpdateProgress { downloaded, total },
                        );
                    }
                },
                || {},
            )
            .await
            .map_err(update_error)?;
        app.restart();
    }
}

fn update_error(error: tauri_plugin_updater::Error) -> AppError {
    AppError::Process(format!("The app update failed: {error}"))
}
