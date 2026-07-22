use std::{path::Path, str::FromStr};

use chrono::Utc;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use crate::{
    domain::{AppSettings, DownloadJob, JobStatus},
    error::{AppError, AppResult},
};

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn connect(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let options =
            SqliteConnectOptions::from_str(&format!("sqlite://{}", path.to_string_lossy()))?
                .create_if_missing(true)
                .foreign_keys(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| AppError::Database(e.into()))?;
        Ok(Self { pool })
    }

    pub async fn settings(&self) -> AppResult<AppSettings> {
        let value =
            sqlx::query_scalar::<_, String>("SELECT value_json FROM settings WHERE singleton = 1")
                .fetch_optional(&self.pool)
                .await?;
        match value {
            Some(value) => Ok(serde_json::from_str(&value)?),
            None => Ok(AppSettings::default()),
        }
    }

    pub async fn save_settings(&self, settings: &AppSettings) -> AppResult<()> {
        let value = serde_json::to_string(settings)?;
        sqlx::query("INSERT INTO settings(singleton,value_json,schema_version,updated_at) VALUES(1,?,1,?) ON CONFLICT(singleton) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
            .bind(value).bind(Utc::now().to_rfc3339()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn recover_interrupted(&self) -> AppResult<()> {
        sqlx::query("UPDATE jobs SET status='interrupted', error_category='interrupted', error_message='The app closed before this job finished', finished_at=?, revision=revision+1 WHERE status IN ('analyzing','downloading','post_processing')")
            .bind(Utc::now().to_rfc3339()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn next_position(&self) -> AppResult<i64> {
        Ok(sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(queue_position), -1) + 1 FROM jobs WHERE in_queue=1",
        )
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn insert_job(&self, job: &DownloadJob, position: i64) -> AppResult<()> {
        sqlx::query("INSERT INTO jobs(id,request_json,title,status,progress_json,created_at,started_at,finished_at,output_path,error_category,error_message,diagnostics_json,queue_position,in_queue) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)")
            .bind(&job.id).bind(serde_json::to_string(&job.request)?).bind(&job.title).bind(job.status.as_str())
            .bind(serde_json::to_string(&job.progress)?).bind(&job.created_at).bind(&job.started_at).bind(&job.finished_at)
            .bind(&job.output_path).bind(&job.error_category).bind(&job.error_message).bind(serde_json::to_string(&job.diagnostics)?).bind(position)
            .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn update_job(&self, job: &DownloadJob) -> AppResult<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("UPDATE jobs SET title=?,status=?,progress_json=?,started_at=?,finished_at=?,output_path=?,error_category=?,error_message=?,diagnostics_json=?,revision=revision+1 WHERE id=?")
            .bind(&job.title).bind(job.status.as_str()).bind(serde_json::to_string(&job.progress)?).bind(&job.started_at).bind(&job.finished_at)
            .bind(&job.output_path).bind(&job.error_category).bind(&job.error_message).bind(serde_json::to_string(&job.diagnostics)?).bind(&job.id)
            .execute(&mut *transaction).await?;
        if matches!(
            job.status,
            JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
        ) {
            sqlx::query("INSERT INTO history(job_id,finished_at) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET finished_at=excluded.finished_at")
                .bind(&job.id).bind(job.finished_at.as_deref().unwrap_or(&job.created_at)).execute(&mut *transaction).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn queue(&self) -> AppResult<Vec<DownloadJob>> {
        self.load_jobs("SELECT * FROM jobs WHERE in_queue=1 ORDER BY queue_position, created_at")
            .await
    }

    pub async fn history(&self) -> AppResult<Vec<DownloadJob>> {
        self.load_jobs("SELECT jobs.* FROM jobs JOIN history ON history.job_id=jobs.id ORDER BY history.finished_at DESC").await
    }

    async fn load_jobs(&self, sql: &'static str) -> AppResult<Vec<DownloadJob>> {
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;
        rows.iter().map(job_from_row).collect()
    }

    pub async fn job(&self, id: &str) -> AppResult<DownloadJob> {
        let row = sqlx::query("SELECT * FROM jobs WHERE id=?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)?;
        job_from_row(&row)
    }

    pub async fn hide_job(&self, id: &str) -> AppResult<()> {
        sqlx::query("UPDATE jobs SET in_queue=0 WHERE id=? AND status NOT IN ('analyzing','downloading','post_processing')").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn clear_completed(&self) -> AppResult<()> {
        sqlx::query("UPDATE jobs SET in_queue=0 WHERE status='completed'")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn remove_history(&self, id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM history WHERE job_id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn reorder(&self, id: &str, direction: &str) -> AppResult<()> {
        let current = sqlx::query(
            "SELECT queue_position FROM jobs WHERE id=? AND status='queued' AND in_queue=1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(current) = current else {
            return Ok(());
        };
        let current_pos: i64 = current.get("queue_position");
        let neighbor = if direction == "up" {
            sqlx::query("SELECT id,queue_position FROM jobs WHERE status='queued' AND in_queue=1 AND queue_position < ? ORDER BY queue_position DESC LIMIT 1").bind(current_pos).fetch_optional(&self.pool).await?
        } else {
            sqlx::query("SELECT id,queue_position FROM jobs WHERE status='queued' AND in_queue=1 AND queue_position > ? ORDER BY queue_position ASC LIMIT 1").bind(current_pos).fetch_optional(&self.pool).await?
        };
        if let Some(neighbor) = neighbor {
            let neighbor_id: String = neighbor.get("id");
            let neighbor_pos: i64 = neighbor.get("queue_position");
            let mut transaction = self.pool.begin().await?;
            sqlx::query("UPDATE jobs SET queue_position=? WHERE id=?")
                .bind(neighbor_pos)
                .bind(id)
                .execute(&mut *transaction)
                .await?;
            sqlx::query("UPDATE jobs SET queue_position=? WHERE id=?")
                .bind(current_pos)
                .bind(neighbor_id)
                .execute(&mut *transaction)
                .await?;
            transaction.commit().await?;
        }
        Ok(())
    }
}

fn job_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<DownloadJob> {
    let status = match row.get::<String, _>("status").as_str() {
        "queued" => JobStatus::Queued,
        "analyzing" => JobStatus::Analyzing,
        "downloading" => JobStatus::Downloading,
        "post_processing" => JobStatus::PostProcessing,
        "completed" => JobStatus::Completed,
        "failed" => JobStatus::Failed,
        "cancelled" => JobStatus::Cancelled,
        "interrupted" => JobStatus::Interrupted,
        other => {
            return Err(AppError::Parse(format!(
                "Unknown stored job state: {other}"
            )));
        }
    };
    Ok(DownloadJob {
        id: row.get("id"),
        request: serde_json::from_str(&row.get::<String, _>("request_json"))?,
        title: row.get("title"),
        status,
        progress: serde_json::from_str(&row.get::<String, _>("progress_json"))?,
        created_at: row.get("created_at"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        output_path: row.get("output_path"),
        error_category: row.get("error_category"),
        error_message: row.get("error_message"),
        diagnostics: serde_json::from_str(&row.get::<String, _>("diagnostics_json"))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{DownloadOptions, DownloadProgress, DownloadRequest, MediaMode};

    fn job(status: JobStatus) -> DownloadJob {
        DownloadJob {
            id: "job-1".into(),
            request: DownloadRequest {
                url: "https://example.com/video".into(),
                destination: if cfg!(windows) {
                    r"C:\Downloads".into()
                } else {
                    "/tmp".into()
                },
                filename_template: "%(title)s.%(ext)s".into(),
                options: DownloadOptions {
                    mode: MediaMode::Video,
                    quality: "best".into(),
                    audio_format: "best".into(),
                    subtitle_languages: vec![],
                    write_subtitles: false,
                    write_automatic_subtitles: false,
                    embed_subtitles: false,
                    embed_metadata: true,
                    embed_thumbnail: false,
                    playlist_items: None,
                    custom_format: None,
                    custom_arguments: vec![],
                },
            },
            title: Some("Test".into()),
            status,
            progress: DownloadProgress::default(),
            created_at: Utc::now().to_rfc3339(),
            started_at: None,
            finished_at: None,
            output_path: None,
            error_category: None,
            error_message: None,
            diagnostics: vec![],
        }
    }

    #[tokio::test]
    async fn migrations_and_restart_recovery_preserve_jobs() {
        let directory = tempfile::tempdir().unwrap();
        let db = Database::connect(&directory.path().join("test.sqlite3"))
            .await
            .unwrap();
        db.insert_job(&job(JobStatus::Downloading), 0)
            .await
            .unwrap();
        db.recover_interrupted().await.unwrap();
        let restored = db.job("job-1").await.unwrap();
        assert_eq!(restored.status, JobStatus::Interrupted);
    }

    #[tokio::test]
    async fn clearing_queue_does_not_delete_history() {
        let directory = tempfile::tempdir().unwrap();
        let db = Database::connect(&directory.path().join("test.sqlite3"))
            .await
            .unwrap();
        let mut completed = job(JobStatus::Completed);
        completed.finished_at = Some(Utc::now().to_rfc3339());
        db.insert_job(&completed, 0).await.unwrap();
        db.update_job(&completed).await.unwrap();
        db.clear_completed().await.unwrap();
        assert!(db.queue().await.unwrap().is_empty());
        assert_eq!(db.history().await.unwrap().len(), 1);
    }
}
