# Agent Runner Local Mode

**Status**: 🚧 In Progress  
**Started**: January 19, 2026  
**Type**: Quick Project (1-2 sessions)

## Overview

Implement a lightweight local execution mode (`ENV=local`) for the Agent Runner that removes cloud infrastructure dependencies and enables host-level filesystem execution.

## Goal

Implement local execution mode for Agent Runner that replaces Daytona with host-level filesystem execution and removes cloud infrastructure dependencies. The CLI will support both:
- **Local Mode** (new): Direct host execution with filesystem backend
- **Cloud Mode** (existing): Daytona-based sandboxed execution

## Technology Stack

- **Python/Graphton** (deepagents library)
- **Go** (Stigmer CLI and Daemon)
- **gRPC** (Stigmer Daemon communication)

## Affected Components

1. **Graphton Library**:
   - `graphton/core/backends/filesystem.py` - Add subprocess execution support

2. **Stigmer Components**:
   - Agent runner config - Add local mode detection
   - Agent runner main - Connect to Stigmer Daemon gRPC
   - Stigmer CLI/Daemon - Implement secret injection for API keys

## Success Criteria

- [x] Local mode can execute shell commands via subprocess in filesystem backend (T1 ✅)
- [x] Agent Runner detects `MODE=local` and uses filesystem backend (T2 ✅)
- [x] Agent Runner connects to Stigmer Daemon gRPC instead of cloud services (T3 ✅)
- [ ] Stigmer CLI/Daemon prompts for and injects API keys securely (T4 - Next)
- [ ] End-to-end local workflow execution works without cloud dependencies (T5 - Final)

## Progress Summary

### Completed Tasks

**T1: Implement execute() in FilesystemBackend** ✅
- Enhanced FilesystemBackend with subprocess execution support
- Created comprehensive test suite (10 tests, all passing)
- Updated sandbox_factory to use local backend
- Checkpoint: `checkpoints/2026-01-19-t1-filesystem-backend-execute-complete.md`

**T2: Update Agent Runner Config for Local Mode** ✅
- Added mode detection (`MODE=local` vs `MODE=cloud`)
- Implemented `get_sandbox_config()` method
- Made Redis configuration optional
- Updated `execute_graphton.py` for mode-aware execution
- Checkpoint: `checkpoints/2026-01-19-t2-config-local-mode-complete.md`

**T2.1: Enable Skills in Local Mode** ✅
- Enhanced SkillWriter to support both Daytona and filesystem backends
- Removed local mode restriction for skills
- Skills now fully functional in both modes
- Documentation: `SKILLS_LOCAL_MODE_IMPLEMENTATION.md`

**T3: Update Agent Runner Main for Daemon Connection** ✅
- Added mode-aware Redis initialization (cloud only)
- Enhanced error handling and logging
- Implemented graceful shutdown with connection cleanup
- Updated main.py with startup banner and better error handling
- Checkpoint: `checkpoints/2026-01-19-t3-worker-daemon-connection-complete.md`
- Changelog: `_changelog/2026-01/2026-01-19-030000-agent-runner-local-cloud-mode-switching.md`

### Current Task

**T4: Implement Secret Injection in Stigmer CLI/Daemon** (Next)
- Create `stigmer local start` command
- Interactive API key prompting (masked input)
- Spawn Agent Runner subprocess with injected secrets
- Supervisor lifecycle management

### Remaining Tasks

**T5: End-to-End Testing and Validation** (Final)
- Complete local workflow execution test
- Verify all components working together
- Documentation and cleanup

## Reference Documents

- ADR Document: `_cursor/adr-doc` (ADR 016: Local Agent Runner Runtime Strategy)
- Related ADR: `docs/adr/20260119-011111-workflow-runner-config.md`
- Skills Implementation: `SKILLS_LOCAL_MODE_IMPLEMENTATION.md`

## Quick Navigation

- **Resume**: Drag `next-task.md` into chat
- **Tasks**: See `tasks.md`
- **Notes**: See `notes.md`
- **Checkpoints**: See `checkpoints/` directory
