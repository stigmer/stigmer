# Project: 20260514.01.e2e-workflow-testing-infrastructure

## Overview
Build a production-grade end-to-end integration testing infrastructure for Stigmer's workflow orchestration platform, targeting the Stigmer Cloud Java service with Postgres, Temporal, and both agent harnesses (LangGraph + Cursor SDK).

**Created**: 2026-05-14
**Status**: Active 🟢

## Project Information

### Primary Goal
Create a layered integration test suite that proves the full workflow execution pipeline works end-to-end: Stigmer Cloud service → Temporal → workflow-runner → agent-runner/cursor-runner → results, with proper isolation, reporting, and CI wiring.

### Timeline
**Target Completion**: 8-12 weeks (4 phases: Foundation → Cross-service canaries → Task family expansion → Hardening)

### Technology Stack
Go (test harness, workflow-runner), Java (Stigmer Cloud service), TypeScript (cursor-runner, Cursor SDK), Python (agent-runner, LangGraph), Postgres (Testcontainers), Temporal, GitHub Actions, JUnit XML, OpenTelemetry

### Project Type
Feature Development

### Affected Components
test/e2e (rewrite), backend/services/cursor-runner, backend/services/agent-runner, backend/services/workflow-runner, stigmer-cloud/backend/services/stigmer-service, CI workflows (.github/workflows), secrets management

## Project Context

### Dependencies
Stigmer Cloud Java service (stigmer-service), Temporal dev server, Postgres (via Testcontainers), Cursor SDK (@cursor/sdk) with API key, Anthropic/OpenAI API keys for provider-backed canaries

### Success Criteria
- Existing 15 legacy E2E tests deleted and replaced
- All tests run against Stigmer Cloud Java service with Postgres
- Full workflow lifecycle tested end-to-end through both harnesses
- HITL approval flow tested automatically
- Tests produce JUnit XML + trace bundles
- CI workflow runs on PRs (offline) and main/nightly (provider-backed)
- Tests work locally AND in CI

### Known Risks & Mitigations
Cursor local runtime may not work on GitHub Actions Linux runners (needs practical testing), Stigmer Cloud Java service may need configuration adjustments for test mode, Cross-repo dependency between stigmer and stigmer-cloud repos, LLM-dependent tests are inherently non-deterministic and expensive, Temporal dev server bootstrap adds complexity to test harness

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
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
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