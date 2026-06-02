# Delete Phase 1 recordCursorUsage — BiDi Proxy Is the Billing Source

**Date**: May 31, 2026

## Summary

Deleted the Phase 1 `recordCursorUsage` workflow activity that created billing records
from runner-reported `streaming_usage`. The BiDi proxy (Phase 2) is now the sole
intended billing source for cursor harness executions. Billing is intentionally
non-functional for cursor executions until the traffic routing fix (Task 5B) lands.

## Problem Statement

The Phase 1 billing path (`recordCursorUsage`) read runner-reported token counts from
`AgentExecutionStatus.streaming_usage` and created billing records in a workflow activity.
This was always intended as a bridge until the BiDi proxy could observe billing-grade
usage directly from the wire.

### Pain Points

- Runner-reported data is inherently untrusted (display-only source promoted to billing)
- Duplicate billing path creates confusion about which is authoritative
- Keeping dead code around creates maintenance burden and false confidence

## Solution

Aggressive deletion of the entire Phase 1 code path:
- `BillingActivities.recordCursorUsage()` interface method
- `BillingActivitiesImpl.recordCursorUsage()` implementation (+ removed 3 unused deps)
- Call site in `InvokeAgentExecutionWorkflowImpl.executeCursorFlow`
- Updated `usage-accumulator.ts` comment to explicitly mark as "display-only"

## Implementation Details

### Deleted from stigmer-cloud

- `BillingActivities.java`: Removed `recordCursorUsage` method declaration
- `BillingActivitiesImpl.java`: Removed 60+ line implementation including
  `AgentExecutionRepo`, `BillingUsageGrpcRepo`, and `CursorModelResolver` dependencies
- `InvokeAgentExecutionWorkflowImpl.java`: Removed the post-execution billing call
  and its try/catch wrapper

### Updated in stigmer (runner)

- `usage-accumulator.ts`: Updated JSDoc to clarify data is display-only; billing
  authority lives in the BiDi proxy's `ProxyUsageReporter`

## Key Discovery

Integration testing revealed that the BiDi proxy is NOT yet receiving Cursor SDK
traffic. The fetch interceptor rewrites ALL Cursor-bound URLs to
`/v1/proxy/cursor/{host}/{path}`, which bypasses the PathRoutingProxy's `/aiserver.v1*`
routing rule. This means `recordCursorUsage` was the only billing source. Deleting it
intentionally breaks billing for cursor executions until Task 5B (traffic routing fix).

## Benefits

- Clean separation: no ambiguity about billing authority
- Forces the routing fix (Task 5B) as a clear next step
- Removes untrusted billing path that could create incorrect records
- Simpler `BillingActivitiesImpl` with fewer dependencies

## Impact

- **Cursor harness billing**: Intentionally broken until Task 5B
- **No user impact**: No production users on cursor harness yet
- **Reversible**: Simple revert if needed before routing fix lands

## Related Work

- [BiDi Proxy Phase 2 Handler](2026-05-31-161735-netty-bidi-proxy-phase2-handler.md)
- [Cursor Proxy Authoritative Billing](2026-05-30-135920-cursor-proxy-authoritative-billing.md)
- Next: Task 5B — Fix traffic routing so Cursor SDK streams reach BiDi proxy

---

**Status**: ✅ Production Ready (intentional billing gap for cursor harness)
**Timeline**: Session 4 of BiDi Proxy Phase 2 project
