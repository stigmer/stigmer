# Next Task: Agent Execution Streaming Improvements

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project Summary

**Description**: Comprehensive improvements to AgentExecution proto contract and LangGraph streaming implementation to address data loss, incomplete event handling, streaming UX issues, and future extensibility.

**Goal**: Fix critical gaps in agent execution streaming and establish foundation for HITL, cancellation, and execution limits.

**Tech Stack**: Protocol Buffers, Python (LangGraph/StatusBuilder), Java (gRPC handlers), Go/TypeScript (stubs)

## Three-Phase Plan

### Phase 1: Critical Fixes (Data Loss)
1. Handle `on_chat_model_end` event - token counts, message finalization
2. Time-based streaming updates (500ms) instead of event-count
3. Reliable final status persistence with retry

### Phase 2: Should Fix (Incomplete Design)
4. Add `is_streaming`, `token_count` to AgentMessage
5. Use RUNNING state for ToolCall (not just PENDING → COMPLETED)
6. Capture sub-agent internals (nested tool calls, messages)
7. Add UsageMetrics (prompt_tokens, completion_tokens, model_used)
8. Add ResolvedExecutionContext (env keys, MCP status, skills)

### Phase 3: Future Foundation
9. HITL approval fields in ToolCall
10. Execution limits in ExecutionConfig
11. Cancellation RPC
12. Delta updates (optional)

## Essential Files to Review

### 1. Task Plan (PENDING REVIEW)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/tasks/T01_0_plan.md
```

### 2. Latest Checkpoint (if exists)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/checkpoints/
```

### 3. Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/README.md
```

## Key Source Files

### Proto Definitions
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/api.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/spec.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/enum.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1/command.proto
```

### Python StatusBuilder (event handling)
```
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/graphton/status_builder.py
```

### Python Execute Activity (streaming loop)
```
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py
```

### Java Update Handler (persistence)
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionUpdateStatusHandler.java
```

### Architecture Documentation
```
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/docs/architecture/agent-execution-workflow.md
/Users/suresh/scm/github.com/stigmer/stigmer/backend/services/agent-runner/docs/CURRENT_IMPLEMENTATION.md
```

## Knowledge Folders

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/design-decisions/
```
Review architectural choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/coding-guidelines/
```
Check project-specific patterns and conventions.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/wrong-assumptions/
```
Review misconceptions to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260130.02.agent-execution-streaming-improvements/dont-dos/
```
Check anti-patterns to avoid.

## Current Status

**Created**: 2026-01-30
**Last Session**: 2026-01-30 (Phase 1.1 Implementation)
**Current Task**: Phase 1.1 Complete - Ready for Phase 1.2
**Status**: IN PROGRESS

## Session Progress (2026-01-30)

### ✅ Completed: Phase 1.1 - Handle on_chat_model_end Event

**What was accomplished:**
- Implemented `_handle_chat_model_end_event()` handler in StatusBuilder
- Added event routing for `on_chat_model_end` in `process_event()`
- Added message timing tracking (`_message_start_times` dict)
- Added cumulative token tracking (`_total_prompt_tokens`, `_total_completion_tokens`)
- Updated `_handle_chat_model_stream_event()` to record message start times
- Created comprehensive unit test suite (14 tests, all passing)
- Structured logging with `[USAGE]` prefix for token counts and duration

**Files modified:**
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+116 lines)
- `backend/services/agent-runner/tests/test_status_builder.py` (new file, 347 lines)

**Key implementation details:**
- Supports both LangChain object format and dict format for usage metadata
- Handles OpenAI-style `prompt_tokens`/`completion_tokens` naming
- Calculates generation duration in milliseconds
- Accumulates tokens across multiple LLM calls per execution
- Graceful error handling for missing messages or empty output

**Test coverage:**
- Stream event handling (create message, append tokens, record start time)
- End event handling (extract usage, calculate duration, accumulate tokens)
- Multiple usage metadata formats (object, dict, OpenAI-style)
- Error cases (missing messages, empty output, None output)
- Event routing verification

## Next Steps

1. **Phase 1.2: Time-Based Streaming Updates**
   - Replace event-count based updates (current: every 10 events)
   - Implement time-based updates (500ms minimum interval)
   - Add configurable thresholds via environment variables
   - Update `execute_graphton.py` streaming loop (lines 519-575)
   - Test with both slow and fast operations

2. **Phase 1.3: Reliable Final Status Persistence**
   - Add retry logic for final status update (exponential backoff)
   - Consider workflow-level backup persistence
   - Handle gRPC failures gracefully

3. **Phase 2.1: Proto Changes for Streaming State**
   - Add `is_streaming`, `token_count`, `generation_duration_ms` to AgentMessage
   - Update StatusBuilder to populate new fields
   - Regenerate all stubs

## Context for Resume

**Current implementation state:**
- `on_chat_model_end` handler is production-ready
- Token tracking works but data only in logs (proto fields come in Phase 2.1)
- Message timing is tracked internally, ready for proto fields
- Test coverage is comprehensive (14 tests)

**Important discoveries:**
- LangChain usage metadata format varies by provider (Anthropic, OpenAI, Ollama)
- Handler needs to support both object attributes and dict keys
- Message indices are stable during streaming (safe to use as tracking keys)

**Technical decisions:**
- Chose to accumulate tokens at execution level (not just per-message)
- Log format: `[USAGE] execution=<id> prompt_tokens=X completion_tokens=Y ...`
- Duration calculation uses message index, not run_id (messages don't have run_id)

## Resume Checklist

When starting a new session:

1. [x] Read the task plan: `tasks/T01_0_plan.md`
2. [x] Check for latest checkpoint in `checkpoints/`
3. [ ] Review Phase 1.2 requirements (time-based streaming)
4. [ ] Read `execute_graphton.py` streaming loop implementation
5. [ ] Continue with Phase 1.2 or move to Phase 2 (proto changes)

## Quick Commands

After loading context:
- "Continue with Phase 1" - Start critical fixes
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review the plan" - Look at T01_0_plan.md

## Architectural Context Summary

The project addresses issues found in architectural review:

**Proto Contract Issues**:
- AgentMessage has no streaming state indicator
- ToolCallStatus.RUNNING never used
- SubAgentExecution is a black box (no internals)
- No token/cost tracking (UsageMetrics missing)
- No HITL foundation fields

**StatusBuilder Issues**:
- Only handles 3 event types (missing `on_chat_model_end`)
- AI message streaming never finalizes
- Sub-agent namespace routing not implemented

**Streaming Strategy Issues**:
- Event-count based (bad UX for slow/fast operations)
- Full state transmission (wasteful)
- Final update has no retry (data loss risk)

---

*This file provides direct paths to all project resources for quick context loading.*
