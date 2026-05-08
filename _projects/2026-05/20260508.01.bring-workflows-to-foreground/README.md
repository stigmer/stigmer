# Project: 20260508.01.bring-workflows-to-foreground

## Overview
Bring the workflow orchestration domain to the foreground — surface workflows in the UI/UX, fix task modeling gaps (structured agent outputs, new P0 task types), add typed workflow IR and task schema registry, build the execution viewer, add workflow-level HITL, and prepare for the visual builder. Completes the missing AI orchestration layer on top of the existing Temporal + CNCF Serverless Workflow foundation.

**Created**: 2026-05-08
**Status**: Active 🟢

## Project Information

### Primary Goal
Make workflows a first-class, visible, user-facing product surface in Stigmer — from invisible backend plumbing to durable, observable, deployable agent applications with structured AI outputs, typed task schemas, execution traces, human approval gates, budget controls, and a hybrid editor experience.

### Timeline
**Target Completion**: Multi-phase (no fixed end date, phased delivery): Phase 0 — harden workflow core (IR, schema registry, structured outputs, artifact store, event stream); Phase 1 — foreground MVP (list/detail pages, YAML editor, execution viewer, run from UI, CLI parity, P0 task additions); Phase 2 — visual builder; Phase 3 — AI-assisted creation; Phase 4 — advanced agentic orchestration.

### Technology Stack
Protobuf (APIs/schemas), Go (workflow-runner/Temporal workers), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal (durability), CNCF Serverless Workflow (DSL influence)

### Project Type
Feature Development

### Affected Components
Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner (Go/Temporal), stigmer-service (Java), Web UI (React — builder, execution viewer, dashboard), CLI (Go — workflow commands), agent-runner (Python — structured output support), model registry, artifact store

## Project Context

### Dependencies
Existing workflow/workflowexecution/workflowinstance proto definitions and Temporal integration; agent execution domain (agent_call task depends on structured agent outputs); LangGraph agent runtime; model registry; MCP server infrastructure; existing CLI framework

### Success Criteria
- 1. Workflows visible in UI (list
- detail
- run
- execution viewer with graph+timeline+logs); 2. Structured agent output model (dual-channel: text + typed JSON); 3. P0 task types added (llm_call
- extract
- validate
- human_input
- transform
- notification); 4. Task schema registry operational; 5. Workflow-level HITL/approval gates working; 6. CLI parity (stigmer workflow validate/apply/run/watch/logs/trace); 7. Execution viewer is the hero feature (graph
- timeline
- task IO
- agent stream
- cost
- artifacts
- approvals)

### Known Risks & Mitigations
1. CRITICAL: Routing on unstructured agent output — must add structured output contracts before UI; 2. HIGH: Struct-only modeling weakens SDK/UI quality — need typed layer; 3. HIGH: Temporal history/payload bloat — need artifact store and state discipline; 4. HIGH: Agent call is a black box — need nested subtraces; 5. HIGH: HITL only inside agents — need workflow-level approval gates; 6. HIGH: Cost explosions from forks/retries/agent loops — need budget primitives; 7. MEDIUM: Serverless Workflow spec is CNCF Sandbox — treat as influence not constraint; 8. MEDIUM: Visual builder before execution viewer would be building on sand

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