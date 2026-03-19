# Label-Based List RPCs and Personal Resource Hooks

**Date**: March 19, 2026

## Summary

Added generic `list` RPCs with label-based filtering to `EnvironmentQueryController` and `AgentInstanceQueryController`, plus a two-layer React hook architecture: generic list hooks for platform builders and convenience personal-resource hooks for the Stigmer Console's personal environment flow.

## Problem Statement

Environments and agent instances lacked any list or query capability. The only way to retrieve these resources was by ID (`get`) or by reference (`getByReference`). The personal environment flow (Phase 2 of agent-picker-personal-env) needs to find a user's personal environment by a label convention (`stigmer.ai/personal: "true"`), but no mechanism existed to query resources by labels.

### Pain Points

- No way to discover environments or agent instances without knowing their exact ID or slug
- Slug-based lookups break for personal resources in multi-user cloud orgs (slug uniqueness is per org+kind)
- SearchService doesn't support label filtering and returns summaries, not full resources
- No reusable pattern for adding label-based queries to other resource types

## Solution

A two-layer approach: generic label-filtered list RPCs at the proto layer, with convenience hooks at the React SDK layer that hardcode the "personal" label convention.

### Proto Layer (Generic)

- `ListEnvironmentsRequest` and `ListAgentInstancesRequest` with `org` + `labels` (map) + `page_info` (PageInfo)
- `EnvironmentList` response type (total_count + items), reusing existing `AgentInstanceList`
- `list` RPCs on both query controllers with `is_skip_authorization` (auth handled in-handler via FGA)

### React SDK Layer (Two Tiers)

- **Layer 1 (Building Blocks)**: `useEnvironmentList(org, labels?)` and `useAgentInstanceList(org, labels?)` — generic data hooks for any label query
- **Layer 2 (Convenience)**: `usePersonalEnvironment(org)` and `usePersonalAgentInstance(org, agentId?)` — wrap the generic hooks with the `stigmer.ai/personal` label, return a single resource instead of a list

## Implementation Details

### Proto Changes (stigmer OSS)

| File | Change |
|------|--------|
| `apis/.../environment/v1/io.proto` | Added `ListEnvironmentsRequest`, `EnvironmentList`, imports for `api.proto` and `pagination.proto` |
| `apis/.../environment/v1/query.proto` | Added `list` RPC with `is_skip_authorization = true` |
| `apis/.../agentinstance/v1/io.proto` | Added `ListAgentInstancesRequest` (reuses existing `AgentInstanceList`) |
| `apis/.../agentinstance/v1/query.proto` | Added `list` RPC with `is_skip_authorization = true` |

### React SDK Hooks

| File | Hook | Purpose |
|------|------|---------|
| `sdk/react/src/environment/useEnvironmentList.ts` | `useEnvironmentList` | Generic list with label filtering |
| `sdk/react/src/environment/usePersonalEnvironment.ts` | `usePersonalEnvironment` | Convenience wrapper for personal env lookup |
| `sdk/react/src/agent-instance/useAgentInstanceList.ts` | `useAgentInstanceList` | Generic list with label filtering |
| `sdk/react/src/agent-instance/usePersonalAgentInstance.ts` | `usePersonalAgentInstance` | Convenience wrapper with optional agent ID filter |

### Design Decisions

1. **Pagination**: Chose offset-based `PageInfo { num, size }` (Convention A) over cursor-based `page_size + page_token` (Convention B) — consistent with existing `GetAgentInstancesByAgentRequest` and natural for FGA-filtered queries.

2. **Field naming**: Used `page_info` (not `page`) to match existing `GetAgentInstancesByAgentRequest` within the same resource type.

3. **"Personal" concept**: Lives as a label convention at the SDK layer, not baked into proto definitions. This keeps the proto API generic and stable — the same list RPC supports any label-based query.

4. **`usePersonalAgentInstance` accepts `agentId?: string`** (not `ResourceRef`) because `spec.agentId` is a string ID and passing a ResourceRef would require an unnecessary resolution step.

## Benefits

- Environments and agent instances can now be queried by any combination of labels
- Personal resource lookup works without fragile slug conventions
- Reusable pattern: any resource type can adopt the same `org + labels + page_info` request shape
- Platform builders get generic hooks; Console gets intent-revealing convenience hooks
- Secret values are redacted server-side in environment list responses (same as get/getByReference)

## Impact

- **Proto API**: Two new list RPCs added to the public API surface
- **React SDK**: Four new hooks exported from `@stigmer/react`
- **Phase 2 unblocked**: `usePersonalEnvironment` and `usePersonalAgentInstance` are the foundation for the personal environment orchestration flow
- **Backend work remaining**: Go handlers (T01.3, T01.4) and Java/FGA handlers (T01.5, T01.6) still needed to make the RPCs functional

## Related Work

- Parent project: `20260319.02.agent-picker-personal-env`
- Sub-project: `20260319.04.sp.env-instance-list-rpcs`
- Prior: `20260319.03.sp.env-auth-and-secret-redaction` (FGA auth model for personal environments)
- Next: Go and Java backend handlers for the list RPCs

---

**Status**: In Progress (proto + SDK complete, backend handlers pending)
**Timeline**: ~1 hour
