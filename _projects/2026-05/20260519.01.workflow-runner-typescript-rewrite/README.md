# Project: 20260519.01.workflow-runner-typescript-rewrite

## Overview
Rewrite the Go-based workflow-runner (Zigflow/CNCF Serverless Workflow engine) in TypeScript and merge it into the unified TypeScript runner, eliminating Go from the runner execution tier entirely.

**Created**: 2026-05-19
**Status**: Active 🟢

## Project Information

### Primary Goal
Single TypeScript runner service that handles all three execution types: ExecuteDeepAgent, ExecuteCursor, and ExecuteServerlessWorkflow. Go workflow-runner deleted after validated cutover. All 12 golden YAML workflows passing identically in TypeScript.

### Timeline
**Target Completion**: 4-6 months (starts after unified-runner-migration Phase 1-2 completes)

### Technology Stack
TypeScript/Node.js, Temporal TypeScript SDK, @serverlessworkflow/sdk (CNCF), node-jq, @grpc/proto-loader, @grpc/grpc-js, Ajv (JSON Schema), openai/anthropic SDKs, @aws-sdk/client-s3, @opentelemetry/api, Vitest

### Project Type
Migration

### Affected Components
backend/services/workflow-runner (Go, ~19K lines, to be retired), backend/services/runner (TypeScript unified runner, target), pkg/zigflow (CNCF SW engine core), test/golden (12 canonical YAML workflows)

## Project Context

### Dependencies
unified-runner-migration project must complete Phase 1-2 first (runner scaffold exists with shared infrastructure). Assumes @serverlessworkflow/sdk npm package is stable. Requires jq binary available in sandbox Docker image.

### Success Criteria
- 1) All 12 golden YAML workflows produce identical results in TS vs Go. 2) ExecuteServerlessWorkflow activity registered in unified TS runner. 3) Go workflow-runner binary removed from production. 4) No performance regression >20% on workflow execution latency. 5) Temporal determinism validated via replay tests.

### Known Risks & Mitigations
1) jq expression parity — node-jq subprocess overhead and edge cases. 2) Dynamic gRPC invocation — proto-loader handling nested packages, streaming RPCs. 3) Temporal determinism — dynamic workflow graph construction must be replay-safe. 4) CNCF TS SDK maturity — may have gaps for custom extensions (call_llm, call_agent). 5) Performance — TS/Node memory and CPU overhead vs Go for compute-heavy transforms.

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