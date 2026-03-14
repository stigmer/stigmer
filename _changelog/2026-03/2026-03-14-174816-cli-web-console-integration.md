# CLI Web Console Integration & Polish

**Date**: March 14, 2026

## Summary

Surfaced the embedded web console in the CLI user experience — `stigmer server` and `stigmer server status` now display the web console URL, added `--no-web` for headless environments, `--open` for browser launch, and ensured the health system correctly tracks the web console component. This is T06 of the Web Console OSS Migration project.

## Problem Statement

After T05 embedded the web console in the daemon binary, it was invisible to users. The CLI showed only the Temporal UI URL, the status command omitted the web console from its component list, there were no flags to control it, and the fallback health state didn't know about it.

### Pain Points

- Users had to know the magic port number (8234) to access the web console
- `stigmer server status` didn't reflect web console health
- No way to disable the web console for CI/headless environments
- No convenient way to open the web console from the terminal

## Solution

Threaded the web console through six integration points: CLI output, status display, health state, `--no-web` flag (with env var pass-through to daemon subprocess), `--open` flag (with shared browser utility), and fallback health probing.

## Implementation Details

**Shared browser utility** (`internal/cli/browser/open.go`): Extracted `openBrowser()` from the auth package into a shared location. The function dispatches to `open` (macOS), `xdg-open` (Linux), or `rundll32` (Windows). Auth's `login.go` updated to use the shared package.

**Server start output** (`server.go`): Both human and structured (JSON/quiet) formats now include the web console URL under "Web UI", conditional on the health state showing `web-console` as `running`.

**Status display** (`server_status.go`): Added `web-console` / `Web Console` to component order and labels. Unlike infrastructure components that always show "Not Running" when absent, web-console only appears when it has a health state entry — this avoids confusing output for dev builds without the embed tag.

**`--no-web` flag**: Signal flows from CLI flag to `StartOptions.NoWeb` to `STIGMER_NO_WEB=1` env var to daemon subprocess. When set, the daemon records `web-console: stopped` (not absent) so status can show it was intentionally disabled.

**`--open` flag**: After server readiness is confirmed, opens the web console URL in the default browser if the web console is running. Follows the existing auth pattern: graceful failure with a warning message.

**Fallback health probe** (`server_health.go`): TCP probe to port 8234 in `createBasicHealthState()`. Only records the component when reachable — the web console is optional.

## Benefits

- Users see the web console URL immediately after `stigmer server` starts
- `stigmer server status` provides a complete view of all running components
- CI/headless environments can disable the web console with `--no-web`
- `stigmer server --open` provides a one-command path from terminal to browser
- Health system handles web console in both normal and fallback (crash recovery) paths

## Impact

- **CLI users**: Discoverable web console URL in familiar output
- **CI/automation**: `--no-web` prevents unnecessary static file server in headless environments
- **Developer experience**: `--open` removes friction between starting the server and accessing the console

## Related Work

- T05: Embed Web Console in Daemon with gRPC-Web Backend (predecessor)
- T07: Build Pipeline & Dev Workflow (next — Dockerfile rewrite, CI integration)

---

**Status**: Production Ready
**Timeline**: Session 6 of the Web Console OSS Migration project
