# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

React renders inside the Tauri desktop app on Windows, macOS, and Linux.

## Product Purpose

Make yt-dlp available through a conventional desktop download manager. The primary task is to analyze a link, choose video or audio settings and a destination, then download or queue the media.

## Capabilities and Constraints

README.md describes shipped capabilities. docs/ARCHITECTURE.md owns backend and persistence decisions. Bundled yt-dlp, Deno, FFmpeg, and FFprobe make a fresh installation usable without separate tools. GPU drivers are detected, not bundled. Keep all existing download, clip, playlist, conversion, queue, history, and filesystem actions functional.

## Brand Commitments

The user specified T3 Code's restrained dark theme and typography, with a conventional downloader layout like Motrix. This is not a browser or a chat interface. Colored edge rails, decorative status borders, and redundant labels are explicitly unwanted.

## Product Principles

- Make common download actions obvious.
- Keep expert controls secondary.
- Show actual task state, without decorative status chrome.
- Remember the last destination and make completed files easy to locate.

## Evidence on Hand

User screenshots document the rejected vertical status rails. src/visualPreview.ts supplies synthetic data for visual checks; it must never be bundled into the production app.
