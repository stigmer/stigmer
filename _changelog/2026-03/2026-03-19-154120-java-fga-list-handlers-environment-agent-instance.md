# Java FGA List Handlers for Environments and Agent Instances

**Date**: March 19, 2026

## Summary

Added Java backend list handlers with FGA authorization for environments and agent instances in stigmer-cloud. These handlers enable label-based resource querying (e.g., `stigmer.ai/personal: "true"`) while ensuring callers only see resources they have `can_view` permission on via OpenFGA. Environment responses automatically redact secret values.

## Problem Statement

The label-based list RPCs were added to the proto definitions and SDK hooks in a prior session (commit `965277a0`), but the stigmer-cloud Java backend had no handlers to serve them. Without these handlers, the cloud deployment cannot process `EnvironmentQueryController.list` or `AgentInstanceQueryController.list` requests.

### Pain Points

- Personal resource lookup requires label filtering (`stigmer.ai/personal: "true"`), which SearchService does not support
- List operations must be scoped by FGA visibility — users should only see their own personal resources
- Environment list responses must redact secrets to prevent exposure through bulk queries

## Solution

Implemented two new handler classes following the established `SessionListHandler` pattern:

1. **`EnvironmentListHandler`** — 6-step pipeline with FGA authorization and secret redaction
2. **`AgentInstanceListHandler`** — 5-step pipeline with FGA authorization (no secrets)

Both handlers use `IamPolicyGrpcRepo.listAuthorizedResourceIds()` to get FGA-authorized resource IDs, then query MongoDB with combined criteria (authorized IDs + org + labels + pagination).

## Implementation Details

### Handler Pipeline Architecture

**EnvironmentListHandler**: validateFieldConstraints -> QueryAuthorizedIds -> LoadFromRepo -> RedactSecrets -> transformResponse -> sendResponse

**AgentInstanceListHandler**: validateFieldConstraints -> QueryAuthorizedIds -> LoadFromRepo -> transformResponse -> sendResponse

Each handler uses inner static `@Component` classes for custom steps (`QueryAuthorizedIds`, `LoadFromRepo`, `RedactSecrets`), passing FGA-authorized IDs between steps via `Context.Key<List<String>>`.

### Repository Methods

Added `findByIdsAndOrgAndLabels(List<String> ids, String org, Map<String, String> labels, Pageable pageable)` to both `EnvironmentRepo` and `AgentInstanceRepo`. These methods:

- Build MongoDB `Criteria` combining `metadata.id IN ids`, `metadata.org = org`, and label filters
- Escape dots in label keys (`key.replace(".", "\\.")`) to prevent MongoDB path interpretation — following the pattern in `AgentRepo.findDefault()`
- Return `Page<T>` with total count for pagination

### Secret Redaction for Lists

The existing `RedactSecretValues` step operates on `ContextBase<?, Environment>` (single-resource context) and cannot be reused directly for `EnvironmentList`. Created a `RedactSecrets` inner class that iterates the list and applies the same logic, referencing `RedactSecretValues.REDACTED_MARKER` to avoid duplicating the constant.

### Pagination

Uses `PageInfo` (num, size) with defaults of page size 20 and max 100. Sorted by `status.audit.specAudit.createdAt` DESC (newest first). Response uses `total_count` (from `Page.getTotalElements()`).

## Benefits

- Personal resource lookup via labels now works end-to-end in cloud deployment
- FGA ensures users only see their own resources (critical for multi-tenant environments)
- Secret values are never exposed through list operations
- Established a reusable pattern for adding label-based list handlers to other resource types

## Impact

- **Cloud backend**: Two new handlers serve `list` RPCs for environments and agent instances
- **SDK consumers**: `useEnvironmentList`, `useAgentInstanceList`, `usePersonalEnvironment`, and `usePersonalAgentInstance` hooks now have a functioning cloud backend
- **Security**: List operations maintain the same secret redaction guarantees as individual get operations

## Related Work

- Prior session: Proto definitions + SDK hooks (commit `965277a0`)
- Parent project: 20260319.02.agent-picker-personal-env (Agent Picker with personal environments)
- FGA models: `environment.fga` and `agent_instance.fga` (personal resource authorization)
- Remaining: Go OSS handlers (T01.3, T01.4) for non-cloud deployment

---

**Status**: In Progress (Go OSS handlers still pending)
**Timeline**: ~30 minutes implementation
