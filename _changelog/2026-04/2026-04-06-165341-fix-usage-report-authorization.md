# Fix Usage Report Authorization — Replace Broken FGA Enumeration with Declarative Proto Auth

**Date**: April 6, 2026

## Summary

Usage reports (org and session) were returning zero data despite the caller having valid permissions and executions existing in the database. The root cause was that the in-handler `listObjects` FGA call could not resolve indirect `agent_execution#can_view` permissions through the session parent chain. The fix replaces this broken enumeration pattern with declarative proto-level authorization that checks the caller's permission on the natural scope resource (organization or session) before the handler executes.

## Problem Statement

The `getOrgUsageReport`, `getAgentUsageReport`, and `getSessionUsageReport` RPCs all used `is_skip_authorization = true` at the proto level and implemented manual authorization inside their Java handlers via a `QueryAuthorizedIds` pipeline step. This step called `listAuthorizedResourceIds` (OpenFGA `listObjects`) to enumerate every `agent_execution` the caller could `can_view`, then intersected the results with the repository query.

### Pain Points

- **Empty results from `listObjects`**: The `agent_execution#can_view` permission is inherited indirectly through `session.viewer/owner`. OpenFGA's `listObjects` API is inefficient at resolving these multi-hop parent-chain relationships, often returning empty sets even when the caller demonstrably has access (e.g., they can see the sessions and their executions on other pages).
- **Wrong authorization granularity**: Enumerating individual execution IDs is the wrong abstraction for aggregate reports. An org usage report should check "can this caller view the org?", not "list every execution this caller can see."
- **Agent usage report had no consumer**: `getAgentUsageReport` was not used by any UI, React hook, or SDK consumer, yet carried the same broken authorization pattern.

## Solution

Move authorization from handler-internal FGA enumeration to declarative proto-level `rpc.config` options for the two active RPCs (session and org). Leave the unused agent usage RPC with `is_skip_authorization` and document it as internal/TBD.

## Implementation Details

### Proto changes (`query.proto`)

- **`getSessionUsageReport`**: Added `rpc.config` with `resource_kind = session`, `permission = can_view`, `field_path = "session_id"`. The gRPC interceptor now performs a direct FGA `check` on the session before the handler runs.
- **`getOrgUsageReport`**: Added `rpc.config` with `resource_kind = organization`, `permission = can_view`, `field_path = "org_id"`.
- **`getAgentUsageReport`**: Kept `is_skip_authorization = true`. Added `@internal` documentation noting that no UI consumes this RPC and the authorization model is TBD — when a product need arises, it should likely be org-scoped (usage of agent X within org Y).

### Backend handler changes (stigmer-cloud)

- **`AgentExecutionGetOrgUsageReportHandler`**: Removed `QueryAuthorizedIds` inner class, `AUTHORIZED_IDS_KEY` context key, and the intersection logic in `LoadAndAggregate`. The pipeline now runs: `validateFieldConstraints → loadAndAggregate → sendResponse`.
- **`AgentExecutionGetSessionUsageReportHandler`**: Same removals. Additionally changed data retrieval from `repo.findByIdsAndSessionId(authorizedIds, sessionId)` to `repo.findAllBySessionId(sessionId)`, since session-level authorization is now handled by the interceptor.
- **`AgentExecutionGetAgentUsageReportHandler`**: Restored to its original state (no changes shipped) since the RPC has no consumer.

## Benefits

- **Usage data actually appears**: Org and session usage reports will now return data for authorized callers instead of silently returning empty results.
- **Correct authorization granularity**: Authorization checks match the natural scope of each report — org membership for org reports, session viewer for session reports.
- **Simpler handlers**: Each handler lost ~50 lines of authorization plumbing, making the pipeline easier to read and maintain.
- **No unused code shipped**: The agent usage RPC is explicitly documented as internal and left in its original state until a real product need defines its authorization model.

## Impact

- **Users**: Organization members will see their usage data on the Usage settings page. Session usage widgets will display execution breakdowns.
- **Backend**: Two handler files simplified; one handler left untouched. Net reduction in code and FGA calls per usage report request.
- **Architecture**: Establishes the declarative `rpc.config` pattern as the preferred authorization mechanism for aggregate/report RPCs, avoiding the `listObjects` anti-pattern for indirect permissions.

## Related Work

- [Org Usage Dashboard](2026-04-06-161919-org-usage-dashboard.md) — the frontend that consumes `getOrgUsageReport`
- [Org Viewer Role FGA Model](2026-04-06-164445-org-viewer-role-fga-model.md) — added `viewer` to organization FGA model

---

**Status**: ✅ Production Ready
