# Fix Usage Report Zero Data — Resilient Date Filtering and Authorization Enforcement

**Date**: April 7, 2026

## Summary

Organization and session usage reports were returning zero data despite executions existing in the database. The root cause was twofold: (1) the MongoDB date range query filtered on `status.startedAt`, a field that may be absent from documents when the agent-runner omits it, and (2) the previous authorization fix declared proto-level `rpc.config` but never wired the `authorize` pipeline step into the handlers.

## Problem Statement

After the initial usage report authorization fix (2026-04-06), which replaced the broken `listObjects` FGA enumeration with declarative proto auth, the Usage settings page still showed `$0.00 / 0 Executions / 0 Tokens / 0 Agents` for organizations with active sessions and executions.

### Pain Points

- **Missing `status.startedAt` field**: `JsonFormat.printer()` (used by `AbstractMongoApiResourceRepository.save()`) omits proto3 default values. When the Python agent-runner does not populate `started_at`, the field is absent from the MongoDB document entirely. MongoDB's `gte`/`lte` comparisons return `false` for missing fields, silently excluding all such executions from the query.
- **Off-by-one on `toDate` boundary**: The frontend sends bare dates (`"2026-04-07"`), but `status.startedAt` stores full ISO 8601 timestamps (`"2026-04-07T12:34:56Z"`). The string comparison `"2026-04-07T..." <= "2026-04-07"` is `false` because the full timestamp lexicographically sorts after the bare date, excluding all executions on the last day of the range.
- **Authorization declared but not enforced**: The previous fix added `rpc.config` options to `query.proto` for org and session usage RPCs, but the handler pipelines did not include `commonSteps.authorize`, so the declarative auth was never checked at runtime.

## Solution

Fix the date range query to be resilient to missing `startedAt` fields, correct the day-boundary comparison, and wire the authorize step into both handler pipelines.

## Implementation Details

### Repository: `AgentExecutionRepo.applyDateRange` (stigmer-cloud)

- **Inclusive upper bound**: Changed `lte(toDate)` to `lt(nextDay)` using `LocalDate.parse(toDate).plusDays(1)`. This ensures all timestamps on the last day of the range are included.
- **Fallback for missing `startedAt`**: Added an `$or` condition that matches:
  1. Documents where `status.startedAt` falls within the date range (primary), OR
  2. Documents where `status.startedAt` is missing/empty AND `status.audit.statusAudit.updatedAt` (always set by `UpdateExecutionStatusActivityImpl`) falls within the range (fallback).
- **Helper method `buildFieldDateRange`**: Extracted the field+range criteria construction for reuse across the primary and fallback paths.

### Handlers: `AgentExecutionGetOrgUsageReportHandler` and `AgentExecutionGetSessionUsageReportHandler`

- Added `commonSteps.authorize` to both handler pipelines, between `validateFieldConstraints` and `loadAndAggregate`.
- This enforces the `rpc.config` declared in `query.proto` (`can_view` on organization / session) that was previously only documented but not executed.

## Benefits

- **Usage data now appears**: Executions missing `status.startedAt` are captured via the audit timestamp fallback. Executions on the last day of the range are no longer silently dropped.
- **Defense in depth**: The date range filter works regardless of whether the agent-runner populates `started_at` — a resilience improvement for data that may be written by external Python workers.
- **Authorization enforced**: Org and session usage reports now perform the FGA `can_view` check declared in proto, closing the gap between declared and actual authorization.

## Impact

- **Users**: Organization members will see their usage data on the Usage settings page. The "No usage data yet" empty state will no longer appear when executions exist.
- **Backend**: `AgentExecutionRepo.applyDateRange` is shared by `findByOrgAndDateRange` and `findByAgentIdAndDateRange`, so both benefit from the fix.
- **Security**: The authorize step enforces the `can_view` permission check, preventing unauthorized callers from accessing usage reports.

## Related Work

- [Fix Usage Report Authorization](2026-04-06-165341-fix-usage-report-authorization.md) — initial fix that removed `listObjects` enumeration and added declarative proto auth

---

**Status**: ✅ Production Ready
