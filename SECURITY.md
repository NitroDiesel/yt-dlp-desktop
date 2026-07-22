# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private **Report a vulnerability** flow in the repository Security tab. Include the affected version, platform, reproduction steps, and impact. Do not include real cookies, tokens, private URLs, or personal media in the report.

Maintainers will acknowledge a complete report within seven days and coordinate disclosure after a fix is available. Supported versions are the latest published release only until the project reaches 1.0.

## Security model

yt-dlp Desktop executes bundled third-party command-line software against user-provided URLs. Only install packages published by this repository, verify release signatures/checksums where offered, and treat cookie files and proxy credentials as sensitive. The app intentionally refuses proxy URLs with embedded credentials and never requires administrator access for normal use.
