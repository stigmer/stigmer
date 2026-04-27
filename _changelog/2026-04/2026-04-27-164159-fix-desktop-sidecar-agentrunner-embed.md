# Fix Desktop Sidecar Agent-Runner Python Embedding

**Date**: April 27, 2026

## Summary

Fixed the desktop app's "Start Runner" flow which failed with "agent-runner Python source is not available" on deployed builds. The root cause was the Go CLI sidecar being built without the `embed_agentrunner` build tag, so the Python runtime was never bundled into the binary. Also improved the error UX to show structured, actionable error messages instead of raw CLI stderr dumps.

## Problem Statement

Clicking "Start Runner" in the deployed desktop app produced a red error banner showing the full CLI stderr concatenation: `"Connecting to backend at api.stigmer.ai:443 ... Registering runner ... Bootstrapping Python runtime ... Error: agent-runner Python source is not available (not embedded and not found in repo tree)"`.

### Pain Points

- Design decision DD-T07-05 incorrectly assumed the desktop sidecar doesn't need embedded agent-runner source, reasoning it "manages runners via CLI commands"
- `stigmer up runner` bootstraps a Python venv from the embedded source — the embed is required regardless of which UI drives the CLI
- The error message was technical and offered no recovery path for end users
- The error banner showed a wall of text mixing progress messages with the actual error

## Solution

Three-layer fix: CI pipeline embedding, actionable error messages, and structured error UX.

## Implementation Details

### CI Pipeline (`release.desktop.yaml`)

Added `sync.sh` step before the Go sidecar build to copy Python source into the embed directory, and added `-tags embed_agentrunner` to all three `go build` invocations (macOS arm64, macOS amd64, Linux/Windows). Added a verification step that fails the build if `main.py` is missing from the synced source directory. Mirrors the exact pattern used in `release.cli.yaml`.

`embed_webconsole` intentionally not added — the desktop app has its own UI and does not serve the web console.

### CLI Error Messages (`bootstrap.go`, `runner_native.go`, `daemon.go`)

Replaced the technical "not embedded and not found in repo tree" message with an actionable one that directs desktop users to update and developers to use the correct build flags.

### Desktop Error UX (`RunnersPage.tsx`)

Extracted `ErrorBanner` component with progressive disclosure: `extractErrorParts()` splits stderr output at the last `"Error: "` marker to show the actionable error as the primary message, with the full CLI output in an expandable `<details>` section. This follows Nielsen's heuristic #9 and the progressive disclosure principle (Hick's Law).

## Benefits

- Desktop app runner start works on deployed builds
- Build-time guard prevents this class of regression from shipping again
- Error messages guide users toward resolution instead of displaying internal diagnostics
- Power users can still expand details to see full CLI output for debugging

## Impact

- **Desktop app users**: Runner start flow unblocked
- **CI pipeline**: Sidecar binary size increases by ~500KB-1MB (Python source) — negligible vs. the `.app` bundle
- **Documentation**: DD-T07-05 corrected across project notes and changelogs

## Files Changed

- `.github/workflows/release.desktop.yaml` — sync.sh + embed tag + verification guard
- `client-apps/cli/internal/cli/runner/bootstrap.go` — actionable error message
- `client-apps/cli/internal/cli/daemon/runner_native.go` — actionable error message
- `client-apps/cli/internal/cli/daemon/daemon.go` — actionable error message
- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — ErrorBanner component with progressive disclosure
- `_projects/2026-04/20260423.03.stigmer-desktop-app/next-task.md` — corrected DD-T07-05
- `_projects/2026-04/20260423.03.stigmer-desktop-app/checkpoints/2026-04-23-session-6.md` — corrected references
- `_changelog/2026-04/2026-04-23-183714-desktop-auto-updater-distribution-pipeline.md` — corrected embed description

---

**Status**: ✅ Production Ready
