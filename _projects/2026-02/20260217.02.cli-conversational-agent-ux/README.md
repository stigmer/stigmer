# Project: 20260217.02.cli-conversational-agent-ux

## Overview
Research and design a conversational UX for agent executions in the Stigmer CLI. Currently, commands like 'stigmer draft skill' trigger agent executions shown as single-shot operations, but agents are conversational by nature — they may ask questions, need user input, or trigger further executions. This project explores how other CLI tools handle interactive agent conversations and designs Stigmer's approach.

**Created**: 2026-02-17
**Status**: Active 🟢

## Project Information

### Primary Goal
Design and plan a conversational agent execution UX for the Stigmer CLI that supports bidirectional interaction between users and agents during commands like 'stigmer run' and 'stigmer draft', informed by research of how similar tools handle this.

### Timeline
**Target Completion**: Open-ended / research-first

### Technology Stack
Go (Stigmer CLI), TUI/terminal UX patterns, gRPC streaming

### Project Type
Research

### Affected Components
CLI (stigmer run, stigmer draft commands), agent-runner service, execution model, session management

## Project Context

### Dependencies
Understanding of current agent execution flow and CLI architecture

### Success Criteria
- 1) Research document covering how similar tools handle conversational agent UX in CLIs. 2) Clear design document with UX patterns for Stigmer. 3) Phased implementation plan.

### Known Risks & Mitigations
Complexity of real-time bidirectional communication in a terminal. Balancing simplicity with power. Ensuring good UX for both automated and interactive flows.

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