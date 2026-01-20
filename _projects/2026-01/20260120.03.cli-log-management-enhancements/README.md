# CLI Log Management Enhancements

**Project**: CLI Log Management Enhancements  
**Location**: `_projects/2026-01/20260120.03.cli-log-management-enhancements/`  
**Created**: 2026-01-20  
**Status**: ⏸️ TODO

## Overview

Enhance `stigmer server logs` command with unified log viewing, automatic log rotation on restart, and improved operational experience.

## Problem Statement

Current log management has several limitations:

1. **Fragmented Viewing**: Must run separate commands to see logs from different components
2. **No Log Rotation**: Logs grow indefinitely, making them hard to navigate and wasting disk space
3. **Manual Cleanup**: Must manually delete or archive old logs

## Goal

Improve operational experience with better log viewing options and automatic log management:

1. Add `--all` flag to view unified logs from all components in one stream
2. Implement automatic log rotation on `stigmer server restart`
3. Archive old logs instead of deleting them
4. Make log management feel like Kubernetes/Docker

## Technology Stack

- Go/Cobra CLI
- File I/O and log streaming
- Timestamp-based log interleaving

## Affected Components

- `client-apps/cli/cmd/stigmer/root/server_logs.go` (log viewing command)
- `client-apps/cli/internal/cli/daemon/daemon.go` (log rotation on restart)
- `docs/cli/server-logs.md` (documentation)

## Success Criteria

- [ ] `stigmer server logs --all` shows interleaved logs from all components
- [ ] On restart, old logs are archived with timestamps (not deleted)
- [ ] Archived logs are kept for N days (configurable, default 7)
- [ ] Log viewing experience matches Kubernetes/Docker patterns
- [ ] Documentation updated with new features

## Key Features

### Feature 1: Unified Log Viewing

```bash
# View all component logs together (interleaved by timestamp)
stigmer server logs --all

# Example output:
[server]          2026/01/20 23:12:00 Starting gRPC server
[workflow-runner] 2026/01/20 23:12:00 Worker started
[agent-runner]    2026/01/20 23:12:01 Connecting to MCP
```

### Feature 2: Log Rotation on Restart

```bash
# On restart, logs are rotated:
daemon.log       → daemon.log.1
agent-runner.log → agent-runner.log.1
workflow-runner.log → workflow-runner.log.1

# With timestamps:
daemon.log.2026-01-20-231200
agent-runner.log.2026-01-20-231200
workflow-runner.log.2026-01-20-231200
```

### Feature 3: Automatic Log Cleanup

- Keep last N rotations (default: 7)
- Delete logs older than N days
- Optional `--clear-logs` flag for complete cleanup

## Design Decisions

### Why Rotation Instead of Deletion?

✅ **Better for debugging**: Can review logs from previous runs  
✅ **Industry standard**: Matches Docker/Kubernetes behavior  
✅ **Compliance friendly**: Keeps audit trail  
✅ **Safe default**: User can always delete manually

### Why Interleaved Logs?

✅ **Better troubleshooting**: See interactions between components  
✅ **Single timeline**: Understand sequence of events  
✅ **Familiar pattern**: Matches `docker-compose logs`

## Implementation Priorities

### Priority 1: Log Rotation (High Impact)
Most important for operational health - prevents log bloat and makes debugging easier.

### Priority 2: Unified Viewing (Medium Impact)  
Nice to have but not critical - users can still view individual components.

### Priority 3: Documentation (Medium Impact)
Important for discoverability and adoption of new features.

## Key Files

- `README.md` - This file (project overview)
- `tasks.md` - Task breakdown and progress tracking
- `notes.md` - Design notes and implementation details
- `next-task.md` - Quick resume file (drag into chat!)

## Related Resources

- Current logs directory: `~/.stigmer/data/logs/`
- Documentation: `docs/cli/server-logs.md`
- Daemon startup code: `client-apps/cli/internal/cli/daemon/daemon.go`

---

**To resume work**: Drag `next-task.md` into chat or reference this project.
