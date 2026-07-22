use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("Required dependency is missing: {0}")]
    DependencyMissing(String),
    #[error("The download engine could not be started: {0}")]
    Process(String),
    #[error("The download engine returned data this app could not read: {0}")]
    Parse(String),
    #[error("Local data could not be accessed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("That download could not be found")]
    NotFound,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
