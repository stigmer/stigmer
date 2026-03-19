# Go OSS List Handlers for Environments and Agent Instances

**Date**: March 19, 2026

## Summary

Added Go backend list handlers for environments and agent instances in the Stigmer OSS server, completing the backend implementation across both Go (OSS) and Java (Cloud) for label-based list RPCs. This enables personal resource lookup via labels in local/OSS deployments.

## Problem Statement

The proto definitions and Java Cloud handlers for label-based list RPCs were already implemented (sessions 1-2), but the Go OSS backend lacked corresponding handlers. Without these, the `list` RPCs on `EnvironmentQueryController` and `AgentInstanceQueryController` would fall through to the `Unimplemented` stubs and return gRPC `Unimplemented` errors in OSS deployments.

### Pain Points

- OSS users could not list environments or agent instances by label
- The `useEnvironmentList` and `useAgentInstanceList` React hooks (already built) had no OSS backend to call
- Personal resource lookup (`stigmer.ai/personal: "true"` label filtering) was blocked for OSS

## Solution

Created two new Go handler files following the established `ListResources + in-memory filter` pattern used by all existing OSS list handlers (`Session.list`, `AgentExecution.list`, `AgentInstance.getByAgent`).

## Implementation Details

### New Files

- `backend/services/stigmer-server/pkg/domain/environment/controller/list.go` — Environment list handler
- `backend/services/stigmer-server/pkg/domain/agentinstance/controller/list.go` — Agent instance list handler

### Pipeline Structure

Both handlers use identical two-step pipelines:

```
ValidateProto -> ListByOrgAndLabels (custom step)
```

### Custom Step: `listByOrgAndLabelsStep`

Each handler defines a private `listByOrgAndLabelsStep` struct that:

1. Calls `store.ListResources(ctx, kind)` to load all resources of the kind
2. Filters by `metadata.org == req.org`
3. Filters by label AND semantics — resource must contain ALL requested labels
4. Sorts by `status.audit.specAudit.createdAt` DESC (newest first)
5. Builds the response list with `TotalCount` and `Items`

### Shared Utility

Both files include a `matchesAllLabels(resourceLabels, filterLabels)` helper that checks whether a resource's labels contain every entry in the filter map. Empty filter matches all resources.

### Design Decisions

- **No secret redaction** — Consistent with existing Go OSS `Get`/`GetByReference` which also return plaintext secrets. OSS is single-user local; redaction is a Cloud concern handled by the Java `EnvironmentListHandler`.
- **No pagination** — Consistent with all existing Go OSS list handlers. Returns all matching results.
- **No `FindAllByLabel` optimization** — Uses `ListResources` + in-memory filter (the established pattern). `FindAllByLabel` only supports a single label key-value pair, and the additional complexity is unnecessary for local datasets.

### Prerequisite: Go Stub Regeneration

Ran `make go-stubs` to regenerate Go protobuf/gRPC stubs from the proto definitions committed in `965277a0`. This produced the Go types (`ListEnvironmentsRequest`, `EnvironmentList`, `ListAgentInstancesRequest`) and updated gRPC server interfaces with the `List` method.

## Benefits

- Completes the full backend stack for label-based list RPCs (Go OSS + Java Cloud)
- Unblocks personal resource lookup in OSS deployments
- Enables the React hooks (`useEnvironmentList`, `useAgentInstanceList`, `usePersonalEnvironment`, `usePersonalAgentInstance`) to function end-to-end in OSS
- Establishes a reusable org+label list pattern for future Go OSS handlers

## Impact

- **OSS users**: Can now list environments and agent instances filtered by org and labels
- **SDK consumers**: React list hooks now have working backend support in both OSS and Cloud
- **Future development**: The `listByOrgAndLabelsStep` pattern is directly reusable for adding list handlers to other resource types

## Related Work

- Proto definitions + React hooks: `965277a0` (session 1)
- Java Cloud list handlers: session 2 (uncommitted on stigmer-cloud `feat/add-customize-ui`)
- Parent project: `20260319.02.agent-picker-personal-env`
- Sub-project: `20260319.04.sp.env-instance-list-rpcs`

---

**Status**: ✅ Production Ready
**Commit**: `a6b40e9e` on `feat/add-customize-ui`
