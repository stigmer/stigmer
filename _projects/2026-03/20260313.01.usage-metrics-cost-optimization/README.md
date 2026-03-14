# Project: 20260313.01.usage-metrics-cost-optimization

## Overview
Address gaps in agent execution usage metrics tracking (cost/pricing data, cache token differentiation) and implement usage optimization techniques (prompt caching, tool result truncation, model routing) to enable accurate cost reporting and minimize LLM costs.

**Created**: 2026-03-13
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable per-execution cost reporting with accurate pricing, implement prompt caching for cost optimization, and provide CLI-level usage/cost visibility with historical reporting RPCs.

### Timeline
**Target Completion**: 3-4 weeks across multiple sprints

### Technology Stack
Protobuf/gRPC (API schema), Go (stigmer-server, CLI), Python (agent-runner/LangGraph), Java (Temporal workflows)

### Project Type
Feature Development

### Affected Components
Proto APIs (agentexecution/v1, session/v1), agent-runner (Python/LangGraph), stigmer-server (Go), CLI (Go)

## Project Context

### Dependencies
LangChain usage_metadata fields, Anthropic prompt caching API (cache_control breakpoints), OpenAI cached_tokens support, Provider pricing data sources

### Success Criteria
- Per-execution cost reports visible in CLI
- Cache token differentiation captured in UsageMetrics
- Prompt caching enabled in agent-runner with measurable savings
- Historical usage/cost RPCs available
- Session-level and org-level cost aggregation

### Known Risks & Mitigations
Provider API differences in token type reporting, Pricing volatility (rates change over time), LangChain abstraction may not expose all provider-specific cache fields, Backward compatibility with existing UsageMetrics consumers

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