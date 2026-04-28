# Checkpoint: T02 Complete — Fix Broken Windows Desktop CI

**Completed**: 2026-04-28 12:38

## What Was Done

Added `defaults.run.shell: bash` at the job level for the `build` job in `.github/workflows/release.desktop.yaml`.

## Root Cause

The "Sync agent-runner source for embedding" step (line 134) lacked `shell: bash`. On Windows runners, GitHub Actions defaults to PowerShell, where `chmod` and `./sync.sh` fail. The agent-runner source never gets synced, causing the verification step to error with:

```
ERROR: agent-runner source not synced -- sidecar will fail at runtime
```

## Fix Applied

Rather than a spot fix on one step, applied a job-level `defaults.run.shell: bash` to the `build` job. This:

1. Fixes the immediate bug (sync step now runs in bash on Windows)
2. Prevents the same class of bug for any future step added to the job
3. Does not change behavior on macOS or Ubuntu (bash was already the default)
4. Leaves existing per-step `shell: bash` declarations in place (harmless, keeps diff focused)

## Files Changed

- `.github/workflows/release.desktop.yaml` — added `defaults.run.shell: bash` to `build` job

## Verification

Audited all 9 `run:` steps in the `build` job. All are bash-compatible. No regressions.
