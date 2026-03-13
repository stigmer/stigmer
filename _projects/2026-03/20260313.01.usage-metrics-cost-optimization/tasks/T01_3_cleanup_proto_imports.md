# Task T01 Phase 3 Cleanup: Proto Import Migration

**Created**: 2026-03-13
**Status**: PENDING
**Type**: Technical Debt Cleanup
**Priority**: High — blocks agent-runner test suite

---

## Context

Phase 1 of T01 reorganized the `agentexecution/v1` proto package, splitting `api.proto` (1,084 lines, 16 messages) into 7 focused files:

| Proto file | Messages |
|-----------|----------|
| `api.proto` | `AgentExecution`, `AgentExecutionStatus`, `TodoItem` |
| `message.proto` | `AgentMessage`, `ComponentMetadata`, `ToolCall` |
| `subagent.proto` | `SubAgentExecution` |
| `context.proto` | `ContextInfo`, `McpServerResolutionStatus`, `ResolvedExecutionContext`, `SummarizationEvent` |
| `approval.proto` | `PendingApproval`, `ChildApprovalNotification` |
| `artifact.proto` | `ExecutionArtifact` |
| `enum.proto` | `ApprovalAction` (moved from api.proto) |

The Python stub regeneration (`make protos`) correctly produced separate `_pb2.py` modules. However, the Python source files in the agent-runner were **never updated** to import from the new module paths. They still import everything from `api_pb2`, which no longer re-exports these symbols.

## Impact

**11 test modules** fail to collect due to `ImportError: cannot import name 'AgentMessage' from 'api_pb2'`. The entire agent-runner test suite is blocked.

## What Phase 3 Fixed (Partial)

During Phase 3 implementation, we fixed the imports in 3 production files to unblock our own work:

| File | Status |
|------|--------|
| `status_builder.py` | ✅ Fixed — imports split across correct `_pb2` modules |
| `execute_graphton.py` | ✅ Fixed — `AgentMessage` from `message_pb2`, `PendingApproval` from `approval_pb2`, `ApprovalAction` from `enum_pb2` |
| `publish_artifact.py` | ✅ Fixed — `ExecutionArtifact` from `artifact_pb2` |
| `test_status_builder.py` | ⚠️ Partially fixed — top-level import fixed, but **18 inline imports** inside test functions still reference `api_pb2` |
| `test_git_diff_artifact.py` | ❌ Not fixed — still imports `ExecutionArtifact` from `api_pb2` |

## Remaining Work

### 1. Fix inline imports in `test_status_builder.py`

18 occurrences of inline `from api_pb2 import ...` scattered throughout test functions:

| Symbol | Correct module | Occurrences |
|--------|---------------|-------------|
| `ToolCall` | `message_pb2` | 8 |
| `AgentMessage` | `message_pb2` | 4 |
| `ContextInfo` | `context_pb2` | 3 |
| `ApprovalAction` | `enum_pb2` | 1 |
| Multi-import blocks (mixed) | Various | 3 |

### 2. Fix `test_git_diff_artifact.py`

Single import: `from api_pb2 import ExecutionArtifact` → `from artifact_pb2 import ExecutionArtifact`

### 3. Update old StatusBuilder usage tests

12 tests in `TestUsageMetrics` class reference old StatusBuilder methods/fields that were removed in Phase 3 Step 4 (extraction of `UsageTracker`):

- `_build_usage_metrics()` — removed, replaced by `usage_tracker.build_usage_metrics()`
- `_build_sub_agent_usage()` — removed
- `_sub_agent_prompt_tokens` — removed

These tests need to be rewritten to exercise the new `UsageTracker`-delegated API. The `StatusBuilder` no longer owns usage accumulation directly — it delegates to `self._usage_tracker`, and the tests should validate that delegation works correctly through the public interface.

### 4. Fix `is_streaming` finalization tests

2-3 tests in `TestSubAgentInternals` and `TestLLMStreamIsolation` assert that `is_streaming` is `False` after finalization, but the current `StatusBuilder` does not clear it. This may be a pre-existing behavioral gap or test expectation mismatch — investigate before fixing.

## Verification

After all fixes, run:

```bash
cd backend/services/agent-runner
.venv/bin/python -m pytest tests/ -v
```

All 1196 tests should collect and pass (currently: 1146 pass, 49 fail, 1 error).

## Estimated Effort

2-3 hours. Mechanical import rewriting + test updates for the new UsageTracker API.
