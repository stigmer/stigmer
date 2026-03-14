# Phase 3 Cleanup: Proto Import Migration & Test Updates

**Date**: March 13, 2026

## Summary

Completed the final cleanup of Phase 3's usage metrics extraction by fixing all proto import migration issues and test breakage in the agent-runner test suite. Phase 1 had split the monolithic `api.proto` into 7 focused files, but the Python test imports were never updated. This cleanup resolves all 42 test failures, bringing the full suite to 1193 passed with zero failures.

## Problem Statement

Phase 1 of the usage metrics project reorganized the `agentexecution/v1` proto package, splitting `api.proto` (1,084 lines, 16 messages) into 7 focused files (`api.proto`, `message.proto`, `subagent.proto`, `context.proto`, `approval.proto`, `artifact.proto`, `enum.proto`). While Phase 3 fixed the 3 production code imports to unblock development, 18 inline imports in `test_status_builder.py` still referenced the old `api_pb2` module for symbols that had moved. Additionally, Phase 3's extraction of usage tracking from StatusBuilder to UsageTracker removed internal fields and methods that tests were directly accessing.

### Pain Points

- The entire agent-runner test suite was blocked: 41 failed, 1 error, 8 additional failures in git diff artifact tests
- 18 inline imports referenced `api_pb2` for symbols that moved to `message_pb2`, `approval_pb2`, `context_pb2`, `enum_pb2`
- 7 tests asserted on removed internal fields (`_total_prompt_tokens`, `_total_completion_tokens`, `_llm_call_count`)
- 3 tests called removed private methods (`_build_usage_metrics`, `_build_sub_agent_usage`)
- 22 test mocks created `MagicMock()` for `usage_metadata` without setting `input_token_details = None`, causing MagicMock's auto-attribute creation to defeat the Phase 3 cache token extraction code's `getattr` defense — silently killing `_handle_chat_model_end_event` and causing cascading failures across `is_streaming`, `token_count`, `generation_duration_ms`, and all usage metrics assertions

## Solution

Systematic fix of all import, assertion, and mock issues in a single pass:

1. Consolidated proto imports to top-level, removing the anti-pattern of inline imports inside test functions
2. Replaced internal field assertions with public API checks (`current_status.usage.*`)
3. Deleted obsolete tests that tested removed implementation details (covered by `test_usage_tracker.py`)
4. Fixed mock setups with `MagicMock(input_token_details=None)` to prevent auto-attribute creation
5. Fixed a missed production code inline import in `execute_graphton.py`

## Implementation Details

### Files Changed (2 files, +46 -143)

**`test_status_builder.py`** (net -142 lines):
- Added `AgentExecutionStatus`, `PendingApproval`, `ToolCall`, `ApprovalAction`, `ExecutionPhase`, `SubAgentStatus` to top-level imports
- Removed 18 inline `api_pb2` imports, 5 redundant `enum_pb2` imports, 1 wrong `approval_pb2` import
- Replaced 7 internal field assertions with `current_status.usage.*` checks
- Deleted 3 obsolete tests (`test_build_usage_metrics_helper`, `test_build_sub_agent_usage_helper`, `test_build_sub_agent_usage_defaults_for_unknown`)
- Fixed 22 mock setups: `MagicMock()` → `MagicMock(input_token_details=None)`
- Updated 1 test expectation for `_READ_ONLY_TOOLS` content omission

**`execute_graphton.py`** (1 line):
- Fixed inline import: `from api_pb2 import ExecutionArtifact` → `from artifact_pb2 import ExecutionArtifact`

### Root Cause Discovery

The most impactful finding was that 20+ test failures across 5 categories (`is_streaming`, `token_count`, `generation_duration_ms`, usage metrics, internal field assertions) all traced to a single root cause: `MagicMock` auto-creates attributes on access, so `getattr(mock.usage_metadata, "input_token_details", None)` returns a MagicMock instead of None. This MagicMock then propagates through arithmetic operations (`max(0, int - MagicMock - MagicMock)`), causing a `TypeError` that is silently caught, preventing the rest of `_handle_chat_model_end_event` from executing.

## Benefits

- Full agent-runner test suite is green: 1193 tests, 0 failures
- No remaining test debt from the Phase 1 proto split or Phase 3 StatusBuilder extraction
- Test assertions now use the public API (`current_status.usage.*`) instead of peeking at internal fields — making tests resilient to future refactoring
- Eliminated the inline-import-in-test-functions anti-pattern for all proto symbols used in failing tests

## Impact

- **Agent-runner team**: Unblocked — can now run tests with confidence
- **Phase 3B and beyond**: No cleanup debt carrying forward; clean foundation for tool result truncation, cost cap, and prompt caching work

## Related Work

- Phase 1: Proto API reorganization (`feat(apis): add usage metrics cost tracking and file reorganization`)
- Phase 3: Usage metrics population pipeline (`feat(backend): add usage metrics population pipeline`)
- Phase 3B (next): Tool result truncation and cost cap

---

**Status**: Production Ready
**Timeline**: ~2 hours
