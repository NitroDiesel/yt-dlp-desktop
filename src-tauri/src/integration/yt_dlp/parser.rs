use serde::Deserialize;

use crate::{
    domain::DownloadProgress,
    error::{AppError, AppResult},
};

const SENTINEL: &str = "__YTDLP_GUI__";

#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolEvent {
    Download(DownloadProgress),
    PostProcess {
        stage: String,
        filename: Option<String>,
    },
    AfterMove {
        filepath: String,
        title: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    v: u8,
    kind: String,
    status: Option<String>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    total_bytes_estimate: Option<u64>,
    speed: Option<f64>,
    eta: Option<f64>,
    filename: Option<String>,
    playlist_index: Option<u32>,
    playlist_count: Option<u32>,
    postprocessor: Option<String>,
    filepath: Option<String>,
    title: Option<String>,
}

pub fn parse_protocol_line(line: &str) -> AppResult<Option<ProtocolEvent>> {
    let Some(index) = line.find(SENTINEL) else {
        return Ok(None);
    };
    let record: Record = serde_json::from_str(&line[index + SENTINEL.len()..])?;
    if record.v != 1 {
        return Err(AppError::Parse(format!(
            "Unsupported progress protocol version {}",
            record.v
        )));
    }
    match record.kind.as_str() {
        "download" => {
            let total = record.total_bytes.or(record.total_bytes_estimate);
            let percent = record
                .downloaded_bytes
                .zip(total)
                .and_then(|(done, total)| {
                    if total > 0 {
                        Some((done as f64 / total as f64) * 100.0)
                    } else {
                        None
                    }
                });
            Ok(Some(ProtocolEvent::Download(DownloadProgress {
                percent,
                downloaded_bytes: record.downloaded_bytes,
                total_bytes: total,
                speed_bytes_per_second: record.speed,
                eta_seconds: record.eta,
                playlist_index: record.playlist_index,
                playlist_count: record.playlist_count,
                filename: record.filename,
                stage: record.status,
            })))
        }
        "postprocess" => Ok(Some(ProtocolEvent::PostProcess {
            stage: record
                .postprocessor
                .or(record.status)
                .unwrap_or_else(|| "Post-processing".into()),
            filename: record.filename,
        })),
        "after_move" => record
            .filepath
            .map(|filepath| ProtocolEvent::AfterMove {
                filepath,
                title: record.title,
            })
            .map(Some)
            .ok_or_else(|| AppError::Parse("Completion record did not contain a filepath".into())),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_tolerant_download_record() {
        let line = r#"noise __YTDLP_GUI__{"v":1,"kind":"download","status":"downloading","downloadedBytes":50,"totalBytes":100,"totalBytesEstimate":null,"speed":25.5,"eta":2,"filename":"café.mp4","playlistIndex":null,"playlistCount":null}"#;
        let Some(ProtocolEvent::Download(progress)) = parse_protocol_line(line).unwrap() else {
            panic!()
        };
        assert_eq!(progress.percent, Some(50.0));
        assert_eq!(progress.filename.as_deref(), Some("café.mp4"));
    }
    #[test]
    fn ignores_human_output() {
        assert_eq!(parse_protocol_line("[download] 20%").unwrap(), None);
    }
    #[test]
    fn rejects_invalid_protocol_json() {
        assert!(parse_protocol_line("__YTDLP_GUI__{bad}").is_err());
    }
}
