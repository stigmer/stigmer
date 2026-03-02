# Project: 20260301.02.native-agent-runner

## Overview
Migrate agent-runner from Docker container to native OS process using a hermetic CPython runtime bundle (python-build-standalone + wheelhouse/venv) managed by the Go CLI. Eliminates Docker Desktop as a prerequisite, removes the alarming home-directory mount warning, and brings agent-runner to parity with stigmer-server and workflow-runner as a simple daemon process.

**Created**: 2026-03-01
**Status**: Active 🟢

## Project Information

### Primary Goal
Eliminate Docker dependency for agent-runner so all three daemon components (stigmer-server, workflow-runner, agent-runner) run as native OS processes started and managed by the Go CLI, with no Docker Desktop required for the core product.

### Timeline
**Target Completion**: 3-4 weeks (3 phases: dual-path execution, decouple MCP runtimes, remove Docker from core path)

### Technology Stack
Go (CLI/daemon management), Python 3.11 (agent-runner), python-build-standalone (hermetic CPython), wheel packaging, CI/CD (per-platform wheelhouse builds)

### Project Type
Migration

### Affected Components
client-apps/cli/internal/cli/daemon/ (daemon lifecycle), client-apps/cli/embedded/ (binary extraction), backend/services/agent-runner/ (Python service), backend/services/stigmer-server/pkg/supervisor/ (health monitoring), build pipeline (wheelhouse + runtime artifacts)

## Project Context

### Dependencies
python-build-standalone (Astral stewardship), per-platform wheel availability for temporalio/grpcio/deepagents, deepagents-cli namespace collision workaround

### Success Criteria
- stigmer server start runs all 3 components as native processes without Docker
- No Docker Desktop prerequisite for users
- Home directory mount warning eliminated
- Agent-runner starts in <1s (vs 3s Docker cold start)
- Distributable size <200MB (vs 2GB Docker image)
- macOS arm64 + amd64 and Linux amd64 + arm64 supported
- Docker retained only as optional MCP sandbox backend

### Known Risks & Mitigations
Platform-native wheel gaps for Linux arm64 or edge-case macOS variants requiring source builds. deepagents-cli namespace collision remains a maintenance hazard across any packaging approach. macOS code-signing and quarantine attributes on downloaded runtime binaries. Supply-chain security of downloaded CPython distributions (requires signature verification). First-run bootstrap time if wheelhouse is not pre-bundled.

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
- [x] T01.0 — Phase 1 plan reviewed and approved
- [x] T01.1 — Runtime filesystem layout designed (DD-01)
- [ ] T01.2 — Go CLI Python runtime manager
- [ ] T01.3 — Per-platform wheelhouse build pipeline
- [ ] T01.4 — Rewrite startAgentRunner() for native mode
- [ ] T01.5 — Log integration for native mode
- [ ] T01.6 — End-to-end validation
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

## Notes

_Add any additional notes, links, or context here as the project evolves._