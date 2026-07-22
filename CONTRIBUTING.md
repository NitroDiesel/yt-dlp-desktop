# Contributing

Thank you for improving yt-dlp Desktop. Open an issue before a large product or architecture change so the approach can be agreed first.

Contributions must keep the UI approachable for people who do not use a terminal, preserve the direct argv-based process boundary, and include tests for meaningful backend or state changes. Run every command listed in the README's **Useful checks** section before opening a pull request.

Do not commit downloaded sidecar executables, credentials, cookies, databases, build output, or private media URLs. Changes to `packaging/components.json` must use immutable official assets, independently verified SHA-256 hashes, updated third-party notices, and a package smoke test on every supported platform.

By contributing, you agree that your contribution is licensed under GPL-3.0-or-later.
