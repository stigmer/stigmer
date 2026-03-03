# Quiet Seedpack Bootstrap Logging

**Date**: March 3, 2026

## Summary

Suppressed verbose subprocess output during seedpack bootstrap on `stigmer server` startup. The ~30 lines of internal implementation noise (temp directory paths, duplicate messages, per-skill artifact details, self-inflicted warnings) are now silently captured and only displayed on failure. Debug mode (`--debug`) preserves the original verbose output for troubleshooting.

## Problem Statement

When running `stigmer server`, the seedpack bootstrap phase flooded the terminal with internal implementation details that had no meaning to the end user.

### Pain Points

- Temp directory paths like `/var/folders/.../stigmer-seedpack-275976597/stigmer.yaml` leaked through multiple layers
- A self-inflicted warning ("Organization is not a project resource") appeared because Phase 2 re-encountered org YAML that Phase 1 already applied
- Duplicate "Pushing skill from..." messages from two code layers (declarative apply + skill push)
- Per-skill verbose output (artifact size, hash, file counts) designed for interactive `stigmer skill push` was shown during automated bootstrap
- "Connecting to backend..." appeared twice (Phase 1 file apply + Phase 2 declarative apply)

## Solution

Instead of piping subprocess stdout/stderr directly to the terminal, both Phase 1 and Phase 2 subprocess calls in `EnsureSeedpackBootstrapped()` now capture output into `bytes.Buffer`. On success, the buffer is discarded. On failure, the captured output is dumped to stderr for debugging before returning the error.

When `--debug` mode is active (zerolog global level is debug), output is piped directly to stderr as before, preserving full observability for developers.

## Implementation Details

Single file changed: `client-apps/cli/internal/cli/daemon/daemon.go`

- Added `bytes` and `zerolog` imports
- Added `verbose` flag derived from `zerolog.GlobalLevel() <= zerolog.DebugLevel`
- Phase 1 (org apply) and Phase 2 (declarative apply) subprocess calls now route stdout/stderr to a buffer in normal mode, or to stderr in debug mode
- On subprocess failure, captured output is written to stderr before returning the error

## Benefits

- Clean 2-line startup output: `Applying system resources (seedpack)...` followed by `System resources applied successfully`
- No temp paths, no duplicate messages, no self-inflicted warnings
- Full debug output preserved via `--debug` flag
- Error output preserved on failure for troubleshooting
- No changes to interactive `stigmer apply` or `stigmer skill push` -- those retain their verbose output

## Impact

- All users running `stigmer server` see a dramatically cleaner startup experience
- Reduces visual noise by ~30 lines on first run or seedpack update
- No behavioral changes to other commands

## Related Work

- `2026-03-03-062120-seedpack-bootstrap-organization-hierarchy-fix.md` - Fixed the two-phase bootstrap that introduced the org warning
- `2026-03-02-002436-fix-server-startup-progress-messages.md` - Earlier server startup UX improvements

---

**Status**: Production Ready
