# Checkpoint: macOS Docker Networking Fixed

**Date**: 2026-01-22 02:52  
**Project**: Docker Migration (T01)  
**Status**: ✅ Critical Bug Fixed

## What Was Fixed

**Problem**: Agent-runner Docker container couldn't connect to Temporal on macOS, causing all agent executions to fail.

**Root Cause**: Docker Desktop on macOS runs in a VM - containers cannot reach host via `localhost`.

**Solution**: OS-aware address resolution that uses `host.docker.internal` on macOS/Windows, `localhost` on Linux.

## Changes Made

### 1. Fixed Docker Networking (`daemon.go`)
- Added `resolveDockerHostAddress()` function
- Detects OS and converts addresses appropriately
- Applied to Temporal and backend addresses

### 2. Enhanced Logs Command (`logs/*.go`, `server_logs.go`)
- Extended `ComponentConfig` to support Docker containers
- Added `tailDockerLogs()` and `readDockerLogs()` functions
- Updated command to detect Docker and stream logs

## Testing Results

**Agent-runner**: ✅ Connected to Temporal via `host.docker.internal:7233`  
**Logs command**: ✅ Shows Docker container logs in `stigmer server logs all`  
**Platform**: ✅ Works on macOS (tested), should work on Windows/Linux

## Impact

- ✅ Agent-runner works on macOS
- ✅ All agent executions work
- ✅ Better observability (logs command supports Docker)

## Related Documentation

- **Changelog**: `_changelog/2026-01/2026-01-22-022000-fix-agent-runner-docker-networking-macos.md`
- **Project**: `_projects/2026-01/20260122.01.migrate-agent-runner-to-docker/`

## Next Steps

- Project T01 (Docker migration) can be considered complete
- Monitor for any platform-specific issues
- Consider updating documentation with Docker troubleshooting tips
