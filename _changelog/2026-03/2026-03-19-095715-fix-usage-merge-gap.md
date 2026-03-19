# Fix Server-Side Usage Merge Gap (Go + Java)

**Date**: March 19, 2026

## Summary

Fixed a server-side bug where the Go and Java backend servers silently dropped `usage`, `context_info`, and `resolved_context` fields during progressive status updates from the Python agent-runner. These three fields are now merged using replace-if-present semantics in both the gRPC handler and Temporal activity paths across both servers.

## Problem Statement

The `UsageMetrics` proto was fully modeled with rich fields (token counts, LLM call metrics, model breakdown, estimated cost), and the Python agent-runner was already sending cumulative `status.usage` snapshots after every LLM call. However, the data never reached the frontend during streaming.

### Pain Points

- `status.usage` was always empty during active execution streaming
- Cost data only became available at terminal state (after `finalize_usage()`)
- The proto's own doc comment promised "Updated progressively during streaming for real-time cost visibility" but the server contradicted this
- Same gap existed for `context_info` and `resolved_context` fields

## Solution

Added merge logic for all three skipped fields in all four server-side merge functions (2 Go, 2 Java) using replace-if-present semantics — identical to how `messages`, `tool_calls`, and other fields are already merged. The Python worker sends cumulative snapshots, so simple replacement is correct.

## Implementation Details

### Files Changed

| File | Repo | Path |
|------|------|------|
| Go gRPC handler | stigmer | `backend/services/stigmer-server/.../controller/update_status.go` |
| Go Temporal activity | stigmer | `backend/services/stigmer-server/.../temporal/activities/update_status_impl.go` |
| Java gRPC handler | stigmer-cloud | `backend/services/stigmer-service/.../AgentExecutionUpdateStatusHandler.java` |
| Java Temporal activity | stigmer-cloud | `backend/services/stigmer-service/.../UpdateExecutionStatusActivityImpl.java` |

### Merge Pattern

```go
if requestStatus.Usage != nil {
    updated.Status.Usage = requestStatus.Usage
}
```

Same pattern for `ContextInfo` and `ResolvedContext`. In Java, uses `hasUsage()` / `setUsage()` protobuf builder methods.

### Log Updates

All four functions now include `has_usage`, `has_context_info`, and `has_resolved_context` in their structured debug/info logs for operational verification.

## Benefits

- Usage data now streams progressively during execution — `estimated_cost_usd`, `total_tokens`, and `llm_call_count` increment in real-time
- Unblocks the `ExecutionCostSummary` React component (Task 2-3 of the project)
- Context info and resolved context also stream progressively (previously only available at terminal state)
- Both OSS and Cloud servers are fixed in lockstep

## Impact

- **Backend**: 4 files, 82 lines added across 2 repos
- **Frontend**: No changes — this is a prerequisite fix. The `useExecutionStream` hook already exposes `execution.status.usage`, it just never had data during streaming
- **Python agent-runner**: No changes needed — it was already sending usage correctly
- **Breaking changes**: None — additive merge, backward-compatible (nil incoming usage preserves existing)

## Related Work

- Part of project `20260319.01.execution-cost-widget`
- Enables Tasks 2-4: `useExecutionUsage` hook, `ExecutionCostSummary` component, Console integration
- Design decision documented: `001-usage-merge-gap-root-cause.md`

---

**Status**: Production Ready
