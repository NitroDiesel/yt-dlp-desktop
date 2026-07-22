use std::{ffi::OsString, path::PathBuf, time::Duration};

use tokio_util::sync::CancellationToken;
use yt_dlp_desktop_lib::integration::yt_dlp::{RunnerEvent, run_download};

fn fake_engine() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-ytdlp"))
}

#[tokio::test]
async fn streams_progress_and_final_output_from_controlled_engine() {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let outcome = run_download(
        &fake_engine(),
        vec![OsString::from("https://example.test/success")],
        CancellationToken::new(),
        sender,
    )
    .await
    .unwrap();
    let mut saw_progress = false;
    let mut saw_post_process = false;
    while let Ok(event) = receiver.try_recv() {
        match event {
            RunnerEvent::Progress(progress) => saw_progress = progress.percent == Some(25.0),
            RunnerEvent::PostProcess(stage) => saw_post_process = stage == "Merger",
            _ => {}
        }
    }
    assert!(saw_progress);
    assert!(saw_post_process);
    assert_eq!(outcome.output_path.as_deref(), Some("fixture.webm"));
    assert_eq!(outcome.title.as_deref(), Some("Fixture media"));
    assert!(outcome.error.is_none());
}

#[tokio::test]
async fn cancellation_stops_a_controlled_engine() {
    let token = CancellationToken::new();
    let cancel = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        cancel.cancel();
    });
    let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
    let outcome = tokio::time::timeout(
        Duration::from_secs(6),
        run_download(
            &fake_engine(),
            vec![OsString::from("https://example.test/cancel")],
            token,
            sender,
        ),
    )
    .await
    .expect("cancellation timed out")
    .unwrap();
    assert!(outcome.cancelled);
}

#[tokio::test]
async fn classifies_and_redacts_controlled_failures() {
    let (sender, _receiver) = tokio::sync::mpsc::unbounded_channel();
    let outcome = run_download(
        &fake_engine(),
        vec![OsString::from("https://example.test/failure")],
        CancellationToken::new(),
        sender,
    )
    .await
    .unwrap();
    assert_eq!(outcome.error.as_deref(), Some("rate_limited"));
    assert!(
        outcome
            .diagnostics
            .iter()
            .all(|line| !line.contains("private-value"))
    );
}
