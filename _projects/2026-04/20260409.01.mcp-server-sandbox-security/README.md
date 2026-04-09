# Project: 20260409.01.mcp-server-sandbox-security

## Overview
Move stdio MCP server execution from the agent-runner pod into the Daytona sandbox for security isolation, and automate snapshot management with pre-installed MCP server packages. Addresses the risk of running untrusted marketplace MCP servers inside the control plane container.

**Created**: 2026-04-09
**Status**: Active 🟢

## Project Information

### Primary Goal
Isolate stdio MCP server execution in Daytona sandboxes (same sandbox used for workspace), automate snapshot lifecycle with popular MCP servers pre-installed, and clean up the agent-runner Dockerfile to no longer bundle MCP runtimes.

### Timeline
**Target Completion**: 2 weeks (4 substantial tasks)

### Technology Stack
Python (agent-runner, Graphton), Daytona SDK (Image, SnapshotService, Process API), Temporal workflows, MongoDB

### Project Type
Feature Development

### Affected Components
agent-runner (worker/mcp/, worker/activities/, sandbox Dockerfiles, config.py, sandbox_manager.py), Graphton middleware (core/middleware.py, core/mcp_manager.py), agent-runner Dockerfile

## Project Context

### Dependencies
MCP marketplace catalog (20260408.01) and MCP connect flow (20260408.02) projects nearing completion

### Success Criteria
1. Stdio MCP servers run inside the Daytona sandbox in cloud mode, never as local subprocesses in the agent-runner pod
2. Daytona snapshots with popular MCP servers are auto-created via Temporal scheduled workflow
3. Sandbox creation uses DB-driven snapshot name with env var fallback
4. Agent-runner Dockerfile no longer bundles Node.js, Go, or uvx
5. Local/OSS mode continues to work with local subprocesses

### Known Risks & Mitigations
1. **Daytona session API latency/framing**: JSON-RPC over WebSocket may add 5-50ms per MCP tool call. Acceptable for most MCP tools (which themselves make 100ms-5s API calls). Needs real-world validation.
2. **Sandbox auto-stop during HITL waits**: Sandbox auto-stops after 5 min idle. MCP server processes die. Mitigated by existing sandbox recovery logic (`_try_revive_daytona_sandbox`); MCP servers need restart after recovery.
3. **Go runtime missing from sandbox**: Basic sandbox has Node.js + Python but not Go. Fixed in T01 (Dockerfile update).

### Task Overview

| Task | Name | Scope | Status |
|------|------|-------|--------|
| [T01](tasks/T01_0_plan.md) | Sandbox Image + Snapshot Pipeline | Dockerfiles, Temporal workflow, DB config | PENDING REVIEW |
| [T02](tasks/T02_0_plan.md) | Daytona stdio Relay | Core security: MCP process relay via sandbox | PENDING |
| [T03](tasks/T03_0_plan.md) | Pipeline Integration | Wire sandbox MCP into agent execution | PENDING |
| [T04](tasks/T04_0_plan.md) | Connect/Discover + Cleanup | Discovery sandboxing, Dockerfile cleanup | PENDING |

### Design Decisions

- [001: Use existing Daytona sandbox for MCP isolation](design-decisions/001-use-existing-daytona-sandbox-for-mcp.md) -- why same sandbox, not a new service
- [002: Automated snapshot lifecycle](design-decisions/002-automated-snapshot-lifecycle.md) -- Temporal-driven snapshot creation and rotation

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Architecture brainstormed and design decisions captured
- [ ] T01: Sandbox image + snapshot pipeline
- [ ] T02: Daytona stdio relay
- [ ] T03: Pipeline integration
- [ ] T04: Connect/Discover + Dockerfile cleanup
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Brainstorming Context

This project originated from a security brainstorming session ([MCP Server Security](chat-link)). Key findings:

- **Threat model**: Stdio MCP servers in the agent-runner pod can access Temporal, Redis, MongoDB, K8s API, and `/proc/*/environ` of the agent-runner process
- **Solution**: Use the existing Daytona sandbox (already created per agent execution) to run MCP servers in isolation
- **Daytona SDK v0.151.0** has all primitives needed: `run_async` sessions, `send_session_command_input` for stdin, `get_session_command_logs_async` for stdout streaming, and programmatic snapshot management via `Image` + `SnapshotService`
- **Snapshot deletion is safe** for running sandboxes (independent after creation, keep last 3 for race safety)
- **Local/OSS mode unchanged**: only cloud mode uses sandbox isolation

## Notes

_Add any additional notes, links, or context here as the project evolves._