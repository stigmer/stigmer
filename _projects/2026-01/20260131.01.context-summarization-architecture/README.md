# Project: 20260131.01.context-summarization-architecture

## Overview
Implement intelligent context window management with automatic summarization for long-running agent conversations. This is a foundational capability that enables agents to handle unbounded conversations without hitting context limits, degraded performance, or losing critical context.

**Created**: 2026-01-31
**Status**: Active 🟢

## Project Information

### Primary Goal
Design and implement a world-class context management system that automatically summarizes conversation history when approaching token limits, while preserving critical context, decisions, and facts. The system should be model-aware, configurable per-agent, and transparent to users.

### Timeline
**Target Completion**: 3-4 weeks for full implementation across all phases

### Technology Stack
Python/LangGraph/LangChain, Protobuf/gRPC, MongoDB

### Project Type
Feature Development

### Affected Components
agent-runner, graphton library, checkpointer infrastructure, status-builder, proto definitions, UI indicators

## Project Context

### Dependencies
LangGraph checkpointer API, LangChain token counting utilities, model-specific tokenizers

### Success Criteria
- 1) Agents can handle 100+ turn conversations without hitting context limits 2) Summarization preserves critical context (tool decisions
- key facts) 3) UI shows summarization indicators 4) Configurable per-agent/per-model 5) Zero data loss - full history still persisted for audit

### Known Risks & Mitigations
1) Summarization quality affecting agent coherence 2) Model-specific tokenizer complexity 3) Performance overhead of summarization LLM calls 4) State migration for existing conversations

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