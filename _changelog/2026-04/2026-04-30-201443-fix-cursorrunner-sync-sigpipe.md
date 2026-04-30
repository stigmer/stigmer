# Fix SIGPIPE in Cursor-Runner Embed Sync Script

**Date**: April 30, 2026

## Summary

Fixed a SIGPIPE crash in `client-apps/cli/embedded/cursorrunner/sync.sh` that aborted the desktop sidecar build with exit code 141. The issue was masked until the preceding TS2835 fix allowed the script to reach its final `find | head` line.

## Problem Statement

After fixing the TypeScript import extension issue (TS2835), `make desktop-dev` still failed with `Error 141` — the script exited before starting the Tauri dev server.

### Pain Points

- `make desktop-dev` was broken despite TypeScript compilation now succeeding
- Exit code 141 (128 + SIGPIPE) gave no obvious error message, making it hard to diagnose

## Solution

Appended `|| true` to the `find "$SOURCE_DIR" -type f | head -20` pipeline at the end of `sync.sh`. The file listing is purely informational and should never abort the build.

## Implementation Details

The script uses `set -euo pipefail`. When `find` produces more than 20 lines of output, `head -20` closes the read end of the pipe after consuming 20 lines. `find` then receives SIGPIPE when it tries to write the 21st line, exiting with code 141 (128 + 13). With `pipefail`, this becomes the pipeline's exit code, and `set -e` aborts the script.

Previously hidden because the script failed earlier at the TypeScript compilation step (TS2835 errors). Once the proto import extension fix resolved those errors, the script progressed to line 97 and hit this latent bug.

## Benefits

- `make desktop-dev` runs to completion and launches the Tauri dev server
- No functional change — the file listing is cosmetic output for developer visibility

## Impact

- **Desktop development**: Fully unblocked (combined with the preceding proto import fix)

---

**Status**: ✅ Production Ready
