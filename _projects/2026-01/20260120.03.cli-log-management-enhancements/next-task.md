# Next Task: CLI Log Management Enhancements

**Project Status**: ✅ COMPLETE  
**Latest Update**: 2026-01-25  
**Latest Checkpoint**: `checkpoints/2026-01-25-fix-auto-follow-restarts.md`

## Recent Completion

✅ **Fixed Auto-Follow Server Restarts** (2026-01-25)

The `stigmer server logs --all` command now automatically detects and follows logs from restarted server instances:
- File-based logs (stigmer-server, workflow-runner) track inode and reopen on replacement
- Docker-based logs (agent-runner) automatically reconnect to new containers
- No manual intervention needed (Ctrl+C + re-run no longer required)
- Matches Kubernetes `kubectl logs -f` behavior

**Implementation**: `client-apps/cli/internal/cli/logs/streamer.go`

## Project Completion Summary

All core features are now complete:

1. ✅ **Log Rotation** - Automatic archiving on restart with 7-day retention
2. ✅ **Unified Log Viewing** - `--all` flag shows interleaved logs from all components
3. ✅ **Documentation** - Comprehensive `docs/cli/server-logs.md`
4. ✅ **Auto-Follow Restarts** - Logs automatically follow server restarts

## Optional Future Enhancements

If users request these features, they can be added:

1. **Visual Restart Indication**
   - Show "ℹ️ Detected server restart, reconnecting..." message
   - Helps users understand what's happening during restart
   - Low priority (silent reconnection works well)

2. **Configurable Retry Interval**
   - Add `--retry-interval` flag (default 500ms)
   - For slower/faster systems
   - Low priority (500ms works for typical cases)

3. **Exponential Backoff**
   - If restart takes longer than expected
   - Increase retry interval gradually (500ms → 1s → 2s → 5s)
   - Low priority (typical restarts are quick)

4. **Max Retry Limit**
   - Add `--max-retries` flag
   - Exit after N failed attempts
   - Prevent infinite waiting if server crashed
   - Low priority (users can Ctrl+C if needed)

5. **Clear Logs Flag** (from original plan)
   - `stigmer server restart --clear-logs` to delete instead of rotate
   - Low priority (log rotation handles cleanup automatically)

## Current State

The log management system is production-ready:
- ✅ Prevents log bloat with automatic rotation
- ✅ Keeps audit trail with archived logs
- ✅ Unified viewing for all components
- ✅ Auto-follows server restarts
- ✅ Professional operational experience
- ✅ Matches industry patterns (Kubernetes/Docker)

---

**To Resume Work**: If any optional enhancements are needed, drag this file into chat.

**Related**:
- Project README: `_projects/2026-01/20260120.03.cli-log-management-enhancements/README.md`
- Changelog: `_changelog/2026-01/2026-01-25-090701-fix-server-logs-auto-follow-restarts.md`
- Documentation: `docs/cli/server-logs.md`
