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
**Last Session**: 2026-01-30 (Phase 2.2 Implementation)
**Current Task**: Phase 2.2 Complete - Ready for Phase 2.3
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

### ✅ Completed: Phase 1.2 - Time-Based Streaming Updates

**What was accomplished:**
- Created new `worker/streaming/` module with hybrid time + event scheduler
- Implemented `StreamingConfig` dataclass with environment variable support
- Implemented `StreamingUpdateScheduler` class with hybrid scheduling algorithm
- Replaced naive event-count based updates with intelligent time-based system
- Added structured logging with `[STREAM]` prefix for observability
- Created comprehensive unit test suite (44 tests, all passing)

**Files created/modified:**
- `backend/services/agent-runner/worker/streaming/__init__.py` (new module)
- `backend/services/agent-runner/worker/streaming/update_scheduler.py` (new, ~350 lines)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (refactored streaming loop)
- `backend/services/agent-runner/tests/test_streaming_update_scheduler.py` (new, 44 tests)

**Key implementation details:**
- Hybrid scheduling algorithm with three trigger conditions:
  1. Time threshold: 500ms minimum between updates (rate limiting)
  2. Burst protection: 50 events forces immediate update (memory safety)
  3. Keepalive: 5 second maximum for long operations (UX)
- Uses `time.monotonic()` for reliable duration tracking (immune to clock changes)
- Configurable via environment variables:
  - `STREAMING_MIN_INTERVAL_MS` (default: 500)
  - `STREAMING_MAX_INTERVAL_MS` (default: 5000)
  - `STREAMING_BURST_THRESHOLD` (default: 50)
- Heartbeat now time-based (every 2 seconds) instead of event-count
- Structured logging shows reason for each update (time_threshold, burst_protection, keepalive, first_update)

**Test coverage (44 tests):**
- StreamingConfig: defaults, validation, env loading, edge cases
- StreamingUpdateScheduler: time-based triggers, burst protection, keepalive
- First update handling, state management, reset functionality
- Edge cases: rapid events, zero events, high event counts

**Architecture decision:**
- Created dedicated `StreamingUpdateScheduler` class instead of inline logic
- Benefits: testable, reusable, clean separation of concerns
- Follows existing codebase patterns (dataclass + load_from_env)

### ✅ Completed: Phase 1.3 - Reliable Final Status Persistence

**What was accomplished:**
- Created new `worker/resilience/` module with gRPC retry logic
- Implemented `RetryConfig` dataclass with environment variable support
- Implemented `GrpcRetryExecutor` class with exponential backoff
- Implemented gRPC status code classification (retryable vs non-retryable)
- Custom exceptions: `GrpcRetryExhaustedError`, `GrpcNonRetryableError`
- Integrated retry into both success and error paths for final status updates
- Created comprehensive unit test suite (62 tests, all passing)
- Structured logging with `[RETRY]` prefix for observability

**Files created/modified:**
- `backend/services/agent-runner/worker/resilience/__init__.py` (new module)
- `backend/services/agent-runner/worker/resilience/grpc_retry.py` (new, ~450 lines)
- `backend/services/agent-runner/tests/test_grpc_retry.py` (new, 62 tests)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (integrated retry)

**Key implementation details:**
- Exponential backoff: 1s → 2s → 4s (configurable)
- Max 3 attempts by default
- Retryable status codes: UNAVAILABLE, DEADLINE_EXCEEDED, ABORTED, RESOURCE_EXHAUSTED, INTERNAL
- Non-retryable status codes: NOT_FOUND, INVALID_ARGUMENT, PERMISSION_DENIED, UNAUTHENTICATED, etc.
- Uses `time.monotonic()` for reliable duration tracking
- Configurable via environment variables:
  - `GRPC_RETRY_MAX_ATTEMPTS` (default: 3)
  - `GRPC_RETRY_INITIAL_DELAY_MS` (default: 1000)
  - `GRPC_RETRY_BACKOFF_MULTIPLIER` (default: 2.0)
  - `GRPC_RETRY_MAX_DELAY_MS` (default: 10000)

**Test coverage (62 tests):**
- RetryConfig: defaults, validation, env loading, backoff calculation
- Status code classification: all retryable and non-retryable codes
- GrpcRetryExecutor: success cases, failure cases, mixed errors
- Exception details: message format, attributes
- Timing behavior: backoff delays, zero delay config
- Edge cases: single attempt, context handling

**Architecture decision:**
- Created dedicated `worker/resilience/` module parallel to `worker/streaming/`
- No external dependencies (uses asyncio.sleep instead of tenacity)
- Reusable for any gRPC operation requiring retry
- Clear separation: status code classification, config, executor

### ✅ Completed: Phase 2.1 - AgentMessage Streaming State Fields

**What was accomplished:**
- Added 3 new fields to AgentMessage proto: `is_streaming`, `token_count`, `generation_duration_ms`
- Updated StatusBuilder to set `is_streaming=True` when creating new AI messages
- Updated StatusBuilder to finalize all 3 fields in `_handle_chat_model_end_event`
- Created 5 new unit tests for field population verification
- Regenerated all protobuf stubs (Python, Go)
- All 281 tests passing

**Files modified:**
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` (+22 lines)
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+16 lines)
- `backend/services/agent-runner/tests/test_status_builder.py` (+160 lines)
- Auto-generated stubs updated (Go, Python)

**New proto fields:**
```protobuf
// True while the AI is actively generating this message, false when complete.
bool is_streaming = 6;

// Total tokens consumed to generate this message (prompt + completion tokens).
int32 token_count = 7;

// Wall-clock time in milliseconds from first token to completion.
int32 generation_duration_ms = 8;
```

**Test coverage (5 new tests):**
- `test_sets_is_streaming_true_on_new_message`
- `test_sets_is_streaming_false_on_end`
- `test_sets_token_count_on_end`
- `test_sets_generation_duration_ms_on_end`
- `test_token_count_zero_when_no_usage_metadata`

**What this enables:**
- UI typing indicator: Frontend can show "typing..." while `is_streaming=True`
- Per-message cost tracking: `token_count` enables cost attribution to individual messages
- Performance monitoring: `generation_duration_ms` helps identify slow responses

### ✅ Completed: Phase 2.2 - Use RUNNING Status for ToolCall

**What was accomplished:**
- Changed tool initial status from `TOOL_CALL_PENDING` to `TOOL_CALL_RUNNING` in StatusBuilder
- Added `_tool_start_times` dictionary to track tool execution timing
- Implemented duration calculation on tool completion
- Added structured logging with `[TOOL]` prefix for tool lifecycle observability
- Created comprehensive unit test suite (7 new tests, all passing)
- All 288 tests passing (no regressions)

**Files modified:**
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+47 lines)
- `backend/services/agent-runner/tests/test_status_builder.py` (+232 lines, 7 new tests)

**Key implementation details:**
- Tools now start in `RUNNING` status (semantically correct - on_tool_start fires when execution begins)
- Tool execution duration tracked using `_tool_start_times` dict (keyed by run_id)
- Duration calculation follows same pattern as message duration (Phase 1.1)
- Structured logging: `[TOOL]` prefix with execution_id, tool_name, run_id, status, duration_ms
- Duration tracked for observability (not added to proto - would require stub regeneration)

**Test coverage (7 new tests in TestToolCallStatus class):**
- `test_tool_start_sets_running_status` - Verifies RUNNING on tool start
- `test_tool_start_sets_started_at_timestamp` - Verifies started_at timestamp
- `test_tool_end_sets_completed_status` - Verifies RUNNING → COMPLETED transition
- `test_tool_end_sets_completed_at_timestamp` - Verifies completed_at timestamp
- `test_tool_status_in_messages_list` - Verifies status in messages[].tool_calls
- `test_tool_status_in_tool_calls_list` - Verifies status in status.tool_calls
- `test_tool_duration_tracking` - Verifies duration tracking and cleanup

**UX impact:**
- CLI now shows `⚙️ Running` during tool execution (instead of misleading `⏳ Queued`)
- Frontend can display real-time "running" indicators for long-running tools
- Better visibility into tool lifecycle through structured logs

**Why this matters:**
- `PENDING` implies "waiting to execute" (queued, not started)
- `RUNNING` correctly reflects "currently executing" (tool is doing work)
- In LangGraph, `on_tool_start` fires when execution begins, not when queued
- Previous `PENDING` status misled users into thinking tools hadn't started yet

## Next Steps

1. **Phase 2.3: Capture Sub-Agent Internals**
   - Implement namespace routing for sub-agent events
   - Track nested tool calls and messages within SubAgentExecution
   - Update proto if needed for internals structure

3. **Phase 2.4: Add UsageMetrics**
   - Create UsageMetrics message (prompt_tokens, completion_tokens, model_used)
   - Add to AgentExecutionStatus for execution-level aggregation
   - Wire cumulative token tracking to proto

## Context for Resume

**Current implementation state:**
- Phase 1 (Critical Fixes) is complete and production-ready
- Phase 2.1 (AgentMessage streaming fields) is complete
- Phase 2.2 (ToolCall RUNNING status) is complete
- Token tracking now persisted in AgentMessage (not just logs)
- Tool execution now shows correct RUNNING status (not misleading PENDING)
- `is_streaming` enables UI typing indicators
- Streaming updates are time-based with configurable thresholds
- Final status updates have retry with exponential backoff
- Test coverage is comprehensive (14 + 44 + 62 + 5 + 7 = 132 tests, 288 total tests passing)

**Important discoveries:**
- Monotonic time is essential for reliable duration tracking
- Hybrid approach (time + events) handles both slow and fast operations well
- Separating heartbeat from status update timing is important (different purposes)
- gRPC status code classification is crucial for intelligent retry
- Proto field defaults (0 for int32, false for bool) work well as "unset" indicators

**Technical decisions:**
- Used frozen dataclass for immutable configuration
- UpdateReason enum provides clear logging and debugging
- Mark update as sent even on failure to prevent retry storms
- No external retry library (asyncio.sleep is sufficient)
- Retry only final status updates (progressive updates don't need retry)
- Used `int32` (not `int64`) for token counts and durations - fits in 32 bits
- Proto3 default values (0, false) used as "unset" indicators - no optional needed

## Resume Checklist

When starting a new session:

1. [x] Read the task plan: `tasks/T01_0_plan.md`
2. [x] Check for latest checkpoint in `checkpoints/`
3. [x] Implement Phase 1.1 (on_chat_model_end) - COMPLETED
4. [x] Implement Phase 1.2 (time-based streaming) - COMPLETED
5. [x] Implement Phase 1.3 (retry logic) - COMPLETED
6. [x] Implement Phase 2.1 (AgentMessage streaming fields) - COMPLETED
7. [x] Implement Phase 2.2 (RUNNING status for ToolCall) - COMPLETED
8. [ ] Continue with Phase 2.3 (Sub-agent internals capture)

## Quick Commands

After loading context:
- "Continue with Phase 1" - Start critical fixes
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review the plan" - Look at T01_0_plan.md

## Architectural Context Summary

The project addresses issues found in architectural review:

**Proto Contract Issues**:
- ~~AgentMessage has no streaming state indicator~~ ✅ FIXED in Phase 2.1 (`is_streaming`, `token_count`, `generation_duration_ms`)
- ~~ToolCallStatus.RUNNING never used~~ ✅ FIXED in Phase 2.2 (tools now start in RUNNING status)
- SubAgentExecution is a black box (no internals)
- No token/cost tracking (UsageMetrics missing) - partial fix in Phase 2.1 (per-message), execution-level pending
- No HITL foundation fields

**StatusBuilder Issues**:
- ~~Only handles 3 event types (missing `on_chat_model_end`)~~ ✅ FIXED in Phase 1.1
- ~~AI message streaming never finalizes~~ ✅ FIXED in Phase 1.1
- Sub-agent namespace routing not implemented

**Streaming Strategy Issues**:
- ~~Event-count based (bad UX for slow/fast operations)~~ ✅ FIXED in Phase 1.2
- Full state transmission (wasteful)
- ~~Final update has no retry (data loss risk)~~ ✅ FIXED in Phase 1.3

---

*This file provides direct paths to all project resources for quick context loading.*
