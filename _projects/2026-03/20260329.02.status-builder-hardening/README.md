# Project: 20260329.02.status-builder-hardening

## Overview
Simplify the StatusBuilder from a 3,648-line god object with 30+ ad-hoc tracking dictionaries into a clean reducer/event-sourcing pattern with an explicit state model and ~10 well-defined indexes. Eliminate compensating complexity (fingerprint dedup, namespace heuristics, reconciliation queues) by using LangGraph's identity mechanisms directly.

**Created**: 2026-03-29
**Status**: Active 🟢

## Project Information

### Primary Goal
Replace the ad-hoc dictionary accumulation in StatusBuilder with a properly designed state model using the reducer/event-sourcing pattern. The core job is simple: LangGraph emits events, we transform them into our protobuf structure using identity-based lookups. The current 30+ dictionaries exist because wrong modeling choices created compensating complexity. This project eliminates that complexity at the root.

### Design Principle
StatusBuilder is an event-sourcing projector. It receives a stream of LangGraph events and builds a protobuf projection (AgentExecutionStatus). The state model should be:
- **Explicit**: An `ExecutionState` dataclass with named indexes, not ad-hoc `self._*` dictionaries
- **Identity-keyed**: All lookups use framework-provided IDs (tool_call_id, run_id, namespace root)
- **Minimal**: Only indexes needed for O(1) lookup into the proto, plus streaming buffers
- **Recoverable**: On pod restart, indexes are rebuilt from the last-persisted proto in one pass

### Timeline
**Target Completion**: No rush, get it right

### Technology Stack
Python, LangGraph, Protobuf, gRPC, Temporal

### Project Type
Simplification

### Affected Components
agent-runner StatusBuilder, streaming.py, hitl.py, post_stream.py, execute_graphton.py, graphton core (namespace/sub-agent identity)

## Project Context

### Dependencies
hitl-tool-call-separation project (20260329.01) should land first for G3 full-replace race fix

### Success Criteria
- StatusBuilder internal state reduced from 30+ dictionaries to ~10-12 well-defined indexes/buffers
- All lookups are identity-based (tool_call_id, run_id, namespace root) — zero heuristic matching
- Fingerprint dedup system fully deleted (fingerprints, FIFO queues, alias maps, reconciled resume deque)
- Namespace routing heuristic cascade fully deleted — single deterministic lookup
- Event handlers are small focused functions (5-20 lines each), not 50-100 line methods with reconciliation
- All existing tests pass unchanged
- No data inconsistencies observed in production for 2 weeks after deploy

### Known Risks & Mitigations
Large refactoring surface in a critical runtime path. Mitigated by phasing: eliminate compensating complexity first (deletes code, independently deployable), then restructure what remains. Each phase is a separate PR. Research steps (tool_call_id availability on events, namespace injection feasibility) happen before code changes.

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