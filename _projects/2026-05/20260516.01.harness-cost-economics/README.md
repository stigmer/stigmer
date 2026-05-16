# Project: 20260516.01.harness-cost-economics

## Overview
Implement the cost optimization roadmap from the Cursor-vs-Native deep research: Anthropic prompt caching, billing architecture improvements, user-facing harness documentation, Cursor context trimming, and local-vs-cloud benchmarking.

**Created**: 2026-05-16
**Status**: Active 🟢

## Project Information

### Primary Goal
Reduce per-execution cost and latency across both harnesses, give users clear guidance on harness selection, and make billing accurate across multiple usage sources.

### Timeline
**Target Completion**: Ongoing

### Technology Stack
Go, TypeScript, Java, Protobuf

### Project Type
Optimization

### Affected Components
backend/services/agent-runner (native caching), backend/services/cursor-runner (billing emission, context trimming), stigmer-cloud billing handler, test/integration benchmarks, user-facing docs

## Project Context

### Dependencies
Deep research report at _projects/2026-05/research.cursor-vs-native-cost-optimization/04.report.gpt.md

### Success Criteria
- 1. Native harness uses Anthropic prompt caching with explicit breakpoints and auto-caching. 2. Billing records carry estimated_provider_cost and vendor_billed_cost separately. 3. Published documentation explaining harness trade-offs. 4. Cursor context audit with measurable token reduction. 5. Local-vs-cloud Cursor benchmark results.

### Known Risks & Mitigations
Cursor SDK internals are opaque — some optimizations may hit limits. Anthropic caching invalidation from dynamic MCP tools needs careful handling.

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