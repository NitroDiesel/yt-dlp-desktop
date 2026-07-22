use std::{thread, time::Duration};

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let scenario = args.last().map(String::as_str).unwrap_or_default();
    if scenario.contains("cancel") {
        loop {
            thread::sleep(Duration::from_millis(100));
        }
    }
    if scenario.contains("failure") {
        eprintln!("ERROR: HTTP Error 429: Too Many Requests token=private-value");
        std::process::exit(1);
    }
    println!(
        r#"__YTDLP_GUI__{{"v":1,"kind":"download","status":"downloading","downloadedBytes":25,"totalBytes":100,"totalBytesEstimate":null,"speed":50,"eta":2,"filename":"fixture.part","playlistIndex":null,"playlistCount":null}}"#
    );
    println!(
        r#"__YTDLP_GUI__{{"v":1,"kind":"postprocess","status":"started","postprocessor":"Merger","filename":"fixture.webm"}}"#
    );
    println!(
        r#"__YTDLP_GUI__{{"v":1,"kind":"after_move","filepath":"fixture.webm","title":"Fixture media"}}"#
    );
}
