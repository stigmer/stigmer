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

- [ ] Local mode can execute shell commands via subprocess in filesystem backend
- [ ] Agent Runner detects `ENV=local` and uses filesystem backend
- [ ] Agent Runner connects to Stigmer Daemon gRPC instead of cloud services
- [ ] Stigmer CLI/Daemon prompts for and injects API keys securely
- [ ] End-to-end local workflow execution works without cloud dependencies

## Reference Documents

- ADR Document: `_cursor/adr-doc` (ADR 016: Local Agent Runner Runtime Strategy)
- Related ADR: `docs/adr/20260119-011111-workflow-runner-config.md`

## Quick Navigation

- **Resume**: Drag `next-task.md` into chat
- **Tasks**: See `tasks.md`
- **Notes**: See `notes.md`
