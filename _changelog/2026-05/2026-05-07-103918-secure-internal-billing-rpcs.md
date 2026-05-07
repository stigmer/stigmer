# Secure Internal Billing RPCs with Platform Operator Authorization

**Date**: May 7, 2026

## Summary

Replaced `is_skip_authorization = true` on the 3 internal billing RPCs (`authorizeExecution`, `recordLlmCallUsage`, `finalizeExecution`) with proper platform-level FGA authorization gated to the machine account operator role. This closes a security gap where any authenticated user could call these RPCs externally.

## Problem Statement

The internal billing RPCs were registered on the external gRPC port with no access control beyond JWT authentication. While the legitimate callers (Temporal local activities, proxy in-process channel) are trusted, the RPCs were technically callable by any authenticated user.

### Pain Points

- Any user with a valid JWT could call `recordLlmCallUsage` with forged token counts
- An attacker knowing an `execution_id` could debit credits from another org's reservation
- Security relied on UUID unguessability rather than proper access control

## Solution

Leveraged the existing platform operator pattern (`platform:stigmer#operator@identity_account:<machine_account_id>`) to gate internal billing RPCs behind a proper FGA permission check.

## Implementation Details

### Proto Changes (OSS)

- Added `can_execute_billing_ops = 29` to `IamPermission` enum
- Replaced `is_skip_authorization = true` with:
  ```proto
  option (ai.stigmer.commons.rpc.config).resource_kind = platform;
  option (ai.stigmer.commons.rpc.config).permission = can_execute_billing_ops;
  option (ai.stigmer.commons.rpc.config).resource_id = "stigmer";
  ```

### FGA Model (stigmer-cloud)

- Added `define can_execute_billing_ops: operator` to `platform.fga`
- Model applied to production: `01KR0D42A9YHRYYZWPW2M8YP58`

### Handler Pipelines (stigmer-cloud)

- Added `commonSteps.authorize` to all 3 handler pipelines
- Switched `BillingUsageGrpcRepoImpl` from `inProcessChannel` to `inProcessChannelAsSystem`

### Caller Security Model

| Caller | Channel | Identity | FGA Check |
|--------|---------|----------|-----------|
| Temporal (authorize/finalize) | Direct Java call | N/A (no handler) | Not invoked |
| Proxy (recordLlmCallUsage) | `inProcessChannelAsSystem` | Machine account | Passes |
| External user | External gRPC | User JWT | Rejected |

## Benefits

- Proper defense-in-depth: FGA authorization + JWT authentication
- Follows established `can_update_usage: operator` pattern
- Zero behavioral change for legitimate internal callers
- External attackers get PERMISSION_DENIED regardless of valid JWT

## Impact

- All billing RPCs are now consistently secured (org-scoped or platform-scoped)
- No more `is_skip_authorization` on any billing RPC
- Proto-FGA schema consistency test passes (validates alignment)

## Related Work

- Phase 0: `can_view_billing` / `can_manage_billing` (org-scoped permissions)
- `can_update_usage: operator` (same pattern for execution usage metering)
- Phase 4.3: Proxy-side billing metering (the caller that uses `inProcessChannelAsSystem`)

---

**Status**: Production Ready
**Timeline**: Single session
