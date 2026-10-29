//! Local copies of download thumbnails, so the list shows them offline and after
//! a site removes the image. One file per job, named by the job's ID, served to
//! the webview through the `thumb` protocol.

use std::{collections::HashSet, path::PathBuf, time::Duration};

use crate::error::{AppError, AppResult};

/// Thumbnails are a few dozen KB; anything larger is not one.
const MAX_BYTES: usize = 2 * 1024 * 1024;

pub struct ThumbnailStore {
    dir: PathBuf,
}

impl ThumbnailStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Only job IDs (UUIDs) name files, so a request can't reach other paths.
    fn path(&self, job_id: &str) -> Option<PathBuf> {
        uuid::Uuid::parse_str(job_id).ok()?;
        Some(self.dir.join(job_id))
    }

    pub fn has(&self, job_id: &str) -> bool {
        self.path(job_id).is_some_and(|path| path.is_file())
    }

    /// Downloads `url` for `job_id` unless it is already saved. Only https
    /// JPEG, PNG, or WebP images up to 2 MB are kept.
    pub async fn fetch(&self, job_id: &str, url: &str, proxy: Option<&str>) -> AppResult<()> {
        let path = self
            .path(job_id)
            .ok_or_else(|| AppError::Validation("Unknown download".into()))?;
        if path.is_file() {
            return Ok(());
        }
        if !url.starts_with("https://") {
            return Err(AppError::Validation("Thumbnails must use https".into()));
        }
        let bytes = download(url, proxy).await?;
        if image_type(&bytes).is_none() {
            return Err(AppError::Parse("The thumbnail is not an image".into()));
        }
        tokio::fs::create_dir_all(&self.dir).await?;
        let partial = path.with_extension("part");
        tokio::fs::write(&partial, &bytes).await?;
        tokio::fs::rename(&partial, &path).await?;
        Ok(())
    }

    /// The saved image and its MIME type.
    pub async fn read(&self, job_id: &str) -> Option<(Vec<u8>, &'static str)> {
        let bytes = tokio::fs::read(self.path(job_id)?).await.ok()?;
        let mime = image_type(&bytes)?;
        Some((bytes, mime))
    }

    /// Deletes thumbnails of downloads that are no longer listed.
    pub async fn prune(&self, keep: &HashSet<String>) {
        let Ok(mut entries) = tokio::fs::read_dir(&self.dir).await else {
            return;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !keep.contains(&name) {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    #[cfg(test)]
    fn dir(&self) -> &std::path::Path {
        &self.dir
    }
}

async fn download(url: &str, proxy: Option<&str>) -> AppResult<Vec<u8>> {
    let failed = |error: reqwest::Error| {
        AppError::Process(format!("The thumbnail could not be saved: {error}"))
    };
    // reqwest is built without a bundled crypto provider; the updater uses ring too.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let mut client = reqwest::Client::builder().timeout(Duration::from_secs(20));
    if let Some(proxy) = proxy {
        client = client.proxy(reqwest::Proxy::all(proxy).map_err(failed)?);
    }
    let mut response = client
        .build()
        .map_err(failed)?
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(failed)?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BYTES as u64)
    {
        return Err(AppError::Parse("The thumbnail is too large".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(AppError::Parse("The thumbnail is too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Recognizes the image formats sites use for thumbnails by their signature.
pub fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const JOB: &str = "8f0b1a4e-3c1d-4d9e-9a51-2f3c4b5a6d7e";

    #[test]
    fn recognizes_only_thumbnail_image_formats() {
        assert_eq!(image_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(image_type(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_type(b"<html>not an image</html>"), None);
    }

    #[tokio::test]
    async fn serves_saved_thumbnails_by_job_id_only_and_prunes_removed_jobs() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbnailStore::new(dir.path().join("thumbnails"));
        std::fs::create_dir_all(store.dir()).unwrap();
        std::fs::write(store.dir().join(JOB), [0xFF, 0xD8, 0xFF, 0xE0]).unwrap();
        std::fs::write(store.dir().join("stale"), b"old").unwrap();

        assert!(store.has(JOB));
        assert_eq!(store.read(JOB).await.unwrap().1, "image/jpeg");
        // Anything but a job ID is refused, so no other file can be read.
        assert!(store.read("../workspace.sqlite3").await.is_none());
        assert!(store.read("stale").await.is_none());

        store.prune(&HashSet::from([JOB.to_owned()])).await;
        assert!(store.has(JOB));
        assert!(!store.dir().join("stale").exists());
    }

    #[tokio::test]
    async fn refuses_insecure_links_without_a_request() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbnailStore::new(dir.path().to_path_buf());
        assert!(
            store
                .fetch(JOB, "http://i.example/a.jpg", None)
                .await
                .is_err()
        );
        assert!(
            store
                .fetch("not-a-job", "https://i.example/a.jpg", None)
                .await
                .is_err()
        );
    }
}
