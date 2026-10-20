# Project Rules

## GitHub Actions Run Status Check

- **Always use `.\check-run.cmd` when checking GitHub Actions run status.**
- Do NOT run parameterized commands like `gh run view <id>` or `gh run view <id> --job <job_id>` directly, as dynamic IDs require individual manual approval each time.
- `.\check-run.cmd` requires no arguments, automatically targets the latest run, and outputs its status, conclusion, start timestamp, and job details.
