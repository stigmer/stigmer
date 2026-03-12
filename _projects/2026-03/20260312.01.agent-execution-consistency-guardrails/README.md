# Project: 20260312.01.agent-execution-consistency-guardrails

## Overview
Fix five critical architectural gaps in Stigmer's agent execution pipeline that produce inconsistent behavior: (1) LoopDetectionMiddleware is completely dead code because aafter_step is not a valid AgentMiddleware hook, (2) ContextSummarizationMiddleware only checks tokens at graph-start so context can overflow mid-execution, (3) recursion_limit is overridden from 100 to 1000 (10x the intended value), (4) sub-agent completion UX is invisible due to renderTransientContent priority cascade, and (5) execution is marked COMPLETED while sub-agents are still IN_PROGRESS. These gaps collectively explain why agent executions loop, crash with AnthropicContextOverflowError, show confusing sub-agent states, and terminate prematurely — all observed in production.

**Created**: 2026-03-12
**Status**: Active 🟢

## Project Information

### Primary Goal
Implement working loop detection (via aafter_model hook), mid-execution token checking and summarization, correct recursion limits, persistent sub-agent completion indicators in CLI, and graceful execution finalization that waits for in-flight sub-agents — delivering Cursor/Claude-Code-level execution consistency and predictability.

### Timeline
**Target Completion**: 1-2 weeks (5 distinct fixes across Python middleware, Python activity, and Go CLI layers, each requiring careful testing)

### Technology Stack
Python (LangGraph AgentMiddleware hooks, graphton library, agent-runner Temporal activities), Go (CLI Bubbletea TUI renderer, gRPC stream consumer), Protobuf (AgentExecution status model)

### Project Type
Bug Fix

### Affected Components
backend/libs/python/graphton/src/graphton/core/loop_detection.py (middleware), backend/libs/python/graphton/src/graphton/core/summarization_middleware.py (middleware), backend/services/agent-runner/worker/activities/execute_graphton.py (execution orchestration + recursion_limit), client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go (sub-agent UX rendering), client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go (sub-agent completion), client-apps/cli/cmd/stigmer/root/run_stream_subagent.go (sub-agent event emission)

## Project Context

### Dependencies
LangChain AgentMiddleware protocol (valid hooks: abefore_agent/abefore_model/aafter_model/aafter_agent/awrap_model_call/awrap_tool_call — NO aafter_step), deepagents library (create_deep_agent and SummarizationMiddleware), LangGraph runtime (recursion_limit merge_configs behavior), Temporal Python SDK (activity heartbeat integration), Prior project 20260309.01.sub-agent-execution-streamline (completed — proto model and CLI rendering foundations)

### Success Criteria
- LoopDetectionMiddleware.aafter_model fires on every model response and detects consecutive/total repetitions
- ContextSummarizationMiddleware checks tokens after every model call and summarizes before overflow
- recursion_limit=100 is the effective runtime value (not 1000)
- Sub-agent completion is visually indicated in CLI before removal from active display
- Execution is not marked COMPLETED while sub-agents are IN_PROGRESS
- No AnthropicContextOverflowError in production runs
- Agent self-improvement loops are bounded and predictable

### Known Risks & Mitigations
Moving loop detection logic to aafter_model changes when tool history is tracked (before tool execution vs after) which may affect detection accuracy, Reducing recursion_limit from 1000 to 100 may truncate legitimate long-running agent tasks that need many tool calls, Mid-execution summarization in aafter_model adds latency to every model-tool cycle even when not needed, Sub-agent completion UX changes require careful Bubbletea state management to avoid introducing new render bugs, The execution finalization change (waiting for sub-agents) may cause the Temporal activity to exceed its StartToCloseTimeout if sub-agents are stuck

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