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
**Last Session**: 2026-01-30 (Phase 2.5 Implementation)
**Current Task**: Phase 2.5 Complete - Ready for Phase 3 or Commit
**Status**: READY FOR COMMIT

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

### ✅ Completed: Phase 2.3 - Capture Sub-Agent Internals

**What was accomplished:**
- Added `tool_calls` and `messages` fields to SubAgentExecution proto
- Implemented namespace-based event routing infrastructure
- Added "task" tool detection to create SubAgentExecution entries
- Implemented namespace discovery via `_register_sub_agent_namespace()`
- Routed all event handlers (tool_start, tool_end, chat_model_stream, chat_model_end) based on namespace
- Implemented sub-agent lifecycle completion (`_handle_sub_agent_end`)
- Created comprehensive unit test suite (14 new tests, all passing)
- Structured logging with `[SUBAGENT]` prefix for observability

**Files modified:**
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` (+13 lines - tool_calls, messages fields)
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+200 lines)
- `backend/services/agent-runner/tests/test_status_builder.py` (+350 lines, 14 new tests)
- Auto-generated stubs updated (Go, Python)

**Key implementation details:**
- Sub-agent tracking via `_active_sub_agents` dict (keyed by run_id)
- Namespace mapping via `_namespace_to_sub_agent_id` dict
- Separate timing tracking for sub-agent messages (`_sub_agent_message_start_times`)
- Graceful fallback to main agent for unknown namespaces
- Cleanup of tracking dictionaries on sub-agent completion

**Test coverage (14 new tests in TestSubAgentInternals class):**
- `test_task_tool_creates_sub_agent_execution` - Verifies SubAgentExecution created
- `test_task_tool_does_not_create_regular_tool_call` - Verifies no ToolCall for task tool
- `test_sub_agent_completion_sets_output` - Verifies lifecycle completion
- `test_sub_agent_failure_captures_error` - Verifies error handling
- `test_namespace_routing_tool_calls_to_sub_agent` - Verifies tool routing
- `test_namespace_routing_messages_to_sub_agent` - Verifies message routing
- `test_sub_agent_tool_end_updates_correct_context` - Verifies tool end routing
- `test_multiple_sub_agents_isolated` - Verifies isolation
- `test_main_agent_events_unaffected` - Verifies main agent still works
- `test_sub_agent_message_finalization` - Verifies AI message finalization
- `test_namespace_cleanup_on_sub_agent_end` - Verifies cleanup
- `test_sub_agent_extracts_alternative_arg_names` - Verifies arg extraction
- `test_get_execution_context_returns_main_for_empty_namespace`
- `test_get_execution_context_returns_main_for_unknown_namespace`

**What this enables:**
- UI visibility into sub-agent internal execution (what tools did it call?)
- Debugging failed sub-agents (where did it fail? on which tool?)
- Performance monitoring (how many tokens did the sub-agent use?)
- Complete execution audit trail (every tool call and message captured)

### ✅ Completed: Phase 2.4 - Add UsageMetrics for Token/Cost Tracking

**What was accomplished:**
- Created `UsageMetrics` proto message with comprehensive documentation
- Added 5 fields: `prompt_tokens`, `completion_tokens`, `total_tokens`, `llm_call_count`, `primary_model`
- Wired `UsageMetrics` to `AgentExecutionStatus.usage` (field 11) for main agent
- Wired `UsageMetrics` to `SubAgentExecution.usage` (field 12) for per-sub-agent tracking
- Updated StatusBuilder to track LLM call counts and primary model
- Implemented progressive UsageMetrics updates during streaming
- Created helper methods: `_build_usage_metrics()`, `_build_sub_agent_usage()`
- Created comprehensive unit test suite (13 new tests, all passing)
- Regenerated all protobuf stubs (Go, Python)
- All 315 tests passing (no regressions)

**Files modified:**
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` (+75 lines - UsageMetrics message and wiring)
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+80 lines - tracking, helpers, updated handler)
- `backend/services/agent-runner/tests/test_status_builder.py` (+200 lines - TestUsageMetrics class, fixture update)
- Auto-generated stubs updated (Go, Python)

**New proto message:**
```protobuf
message UsageMetrics {
  int32 prompt_tokens = 1;          // Input tokens consumed
  int32 completion_tokens = 2;      // Output tokens generated
  int32 total_tokens = 3;           // Convenience sum
  int32 llm_call_count = 4;         // Number of LLM API calls
  string primary_model = 5;         // Primary model used
}
```

**Test coverage (13 new tests in TestUsageMetrics class):**
- `test_usage_metrics_updated_on_chat_model_end` - Verifies UsageMetrics proto populated
- `test_llm_call_count_incremented` - Verifies call count increases
- `test_primary_model_captured_from_first_call` - Verifies first model becomes primary
- `test_primary_model_not_overwritten` - Verifies subsequent models don't change primary
- `test_usage_accumulates_across_calls` - Verifies token accumulation
- `test_total_tokens_equals_sum` - Verifies total = prompt + completion
- `test_sub_agent_usage_tracked_separately` - Verifies sub-agent has own UsageMetrics
- `test_sub_agent_usage_isolated_from_main` - Verifies main doesn't include sub-agent
- `test_usage_zero_when_no_llm_calls` - Verifies defaults to zeros
- `test_usage_handles_missing_model_name` - Verifies graceful handling
- `test_build_usage_metrics_helper` - Tests main agent helper
- `test_build_sub_agent_usage_helper` - Tests sub-agent helper
- `test_build_sub_agent_usage_defaults_for_unknown` - Tests unknown sub-agent

**Key design decisions:**
- Main agent and sub-agent usage tracked separately (no double counting)
- Progressive updates during streaming (not just at end)
- Primary model captured from first LLM response (not overwritten)
- Sub-agent tokens isolated for accurate cost attribution
- Total execution cost = status.usage + sum(sub_agent.usage)

**What this enables:**
- Execution-level cost tracking and billing
- Per-sub-agent cost attribution
- LLM call frequency analysis (avg tokens/call)
- Real-time cost visibility during streaming
- Performance analytics (tokens consumed, models used)

### ✅ Completed: Phase 2.5 - Add ResolvedExecutionContext

**What was accomplished:**
- Created `ResolvedExecutionContext` proto message with comprehensive documentation
- Created `McpServerResolutionStatus` proto message for rich MCP server diagnostics
- Added field 12 to `AgentExecutionStatus.resolved_context`
- Implemented `StatusBuilder.set_resolved_context()` method with structured `[CONTEXT]` logging
- Integrated context population in `execute_graphton.py` Step 5.5 (after resource resolution)
- Environment keys sorted alphabetically (NO values for security)
- MCP server status includes resolution success/failure, error messages, and tool counts
- Skill names sorted alphabetically
- Created comprehensive unit test suite (13 new tests, all passing)
- Regenerated all protobuf stubs (Go, Python)
- All 328 tests passing (no regressions)

**Files modified:**
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` (+102 lines - ResolvedExecutionContext and McpServerResolutionStatus messages)
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+82 lines - set_resolved_context method with logging)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (+36 lines - Step 5.5 integration)
- `backend/services/agent-runner/tests/test_status_builder.py` (+265 lines - TestResolvedExecutionContext class)
- Auto-generated stubs updated (Go, Python)

**New proto messages:**
```protobuf
message ResolvedExecutionContext {
  repeated string environment_keys = 1;  // Keys only, sorted alphabetically
  map<string, McpServerResolutionStatus> mcp_servers = 2;
  repeated string skill_names = 3;       // Sorted alphabetically
}

message McpServerResolutionStatus {
  bool resolved = 1;                     // Success/failure
  string message = 2;                    // Diagnostic message
  int32 enabled_tool_count = 3;          // Number of tools enabled
}
```

**Test coverage (13 new tests in TestResolvedExecutionContext class):**
- `test_set_resolved_context_populates_proto` - Verifies proto structure
- `test_environment_keys_sorted_alphabetically` - Verifies alphabetical sorting
- `test_skill_names_sorted_alphabetically` - Verifies skill sorting
- `test_mcp_server_resolved_status` - Verifies successful resolution
- `test_mcp_server_failed_status` - Verifies failure with error message
- `test_empty_context_all_fields_empty` - Verifies empty state handling
- `test_context_overwrites_on_second_call` - Verifies overwrite behavior
- `test_env_keys_only_no_values_accepted` - Verifies security (keys only)
- `test_large_env_count_handled` - Verifies 150+ keys handled
- `test_mcp_tool_count_accurate` - Verifies tool count tracking
- `test_multiple_mcp_servers_mixed_status` - Verifies mixed success/failure
- `test_special_characters_in_keys_preserved` - Verifies special character handling
- `test_unicode_skill_names_handled` - Verifies unicode support

**Key design decisions:**
- **Security**: Environment keys only (NO values) to prevent secret exposure
- **Rich MCP status**: Used `McpServerResolutionStatus` instead of simple boolean for better debugging
- **Consistent ordering**: Alphabetical sorting for deterministic comparison and diffs
- **One-time population**: Set once after resource resolution, immutable during streaming
- **Structured logging**: `[CONTEXT]` prefix with debug details for troubleshooting

**What this enables:**
- **Debugging**: Understanding what resources were available when investigating failures
- **Auditing**: Tracking what resources each execution consumed
- **Security review**: Verifying which secrets (by key name only) were exposed
- **UX transparency**: Showing users what their agent can access

## Next Steps

### Option A: Commit Phase 2 Work (Recommended)
Phase 2 is complete and production-ready. All critical and should-fix items are implemented:
1. Review the implementation
2. Commit Phase 2 work with changelog entry
3. Consider Phase 3 as separate PR

### Option B: Continue to Phase 3 (Future Foundation)
If you want to add future-proofing fields in same PR:
1. **Phase 3.1: HITL approval fields in ToolCall**
   - Add `requires_approval`, `approval_status`, `approved_by` fields
   - Prepare for human-in-the-loop tool approval workflow
   
2. **Phase 3.2: Execution limits in ExecutionConfig**
   - Add `max_tool_calls`, `max_llm_calls`, `max_tokens` fields
   - Enable budget-based execution constraints
   
3. **Phase 3.3: Cancellation RPC**
   - Add `CancelExecution` RPC for stopping in-progress executions
   
4. **Phase 3.4: Delta updates (optional)**
   - Implement incremental status updates instead of full state

## Context for Resume

**Current implementation state:**
- ✅ Phase 1 (Critical Fixes) - COMPLETE and production-ready
  - on_chat_model_end event handling
  - Time-based streaming updates (500ms intervals)
  - Reliable final status persistence with retry
  
- ✅ Phase 2 (Should Fix) - COMPLETE and production-ready
  - Phase 2.1: AgentMessage streaming state fields (`is_streaming`, `token_count`, `generation_duration_ms`)
  - Phase 2.2: ToolCall RUNNING status (not misleading PENDING)
  - Phase 2.3: Sub-agent internals capture (tool_calls, messages via namespace routing)
  - Phase 2.4: UsageMetrics for token/cost tracking (main agent + per-sub-agent)
  - Phase 2.5: ResolvedExecutionContext for resource visibility (env keys, MCP status, skills)

- 🎯 All acceptance criteria met for Phase 1 and Phase 2
- ✅ 328 tests passing (66 StatusBuilder + 98 other + 44 streaming + 62 retry + 58 other)
- ✅ No regressions introduced
- ✅ Structured logging throughout (`[USAGE]`, `[TOOL]`, `[SUBAGENT]`, `[STREAM]`, `[RETRY]`, `[CONTEXT]`)
- ✅ Proto stubs regenerated (Python, Go)

**Ready to commit or continue to Phase 3**

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
8. [x] Implement Phase 2.3 (Sub-agent internals capture) - COMPLETED
9. [x] Implement Phase 2.4 (UsageMetrics) - COMPLETED
10. [x] Implement Phase 2.5 (ResolvedExecutionContext) - COMPLETED
11. [ ] Decide: Commit Phase 2 work OR continue to Phase 3

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
- ~~SubAgentExecution is a black box (no internals)~~ ✅ FIXED in Phase 2.3 (`tool_calls`, `messages` fields)
- ~~No token/cost tracking (UsageMetrics missing)~~ ✅ FIXED in Phase 2.4 (status.usage, sub_agent.usage)
- No ResolvedExecutionContext (env keys, MCP status, skills) - pending Phase 2.5
- No HITL foundation fields - pending Phase 3.1

**StatusBuilder Issues**:
- ~~Only handles 3 event types (missing `on_chat_model_end`)~~ ✅ FIXED in Phase 1.1
- ~~AI message streaming never finalizes~~ ✅ FIXED in Phase 1.1
- ~~Sub-agent namespace routing not implemented~~ ✅ FIXED in Phase 2.3 (namespace-based event routing)

**Streaming Strategy Issues**:
- ~~Event-count based (bad UX for slow/fast operations)~~ ✅ FIXED in Phase 1.2
- Full state transmission (wasteful)
- ~~Final update has no retry (data loss risk)~~ ✅ FIXED in Phase 1.3

---

*This file provides direct paths to all project resources for quick context loading.*
