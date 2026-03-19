# Task T01: Label-Based List RPCs for Environments and Agent Instances

**Created**: 2026-03-19
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260319.02.agent-picker-personal-env

**This plan requires your review before execution.**

## Objective

Add `list` RPCs with label-based filtering to `EnvironmentQueryController` and `AgentInstanceQueryController`. This enables personal resource lookup via labels (e.g., `stigmer.ai/personal: "true"`) instead of deterministic slug conventions, which break under multi-user slug uniqueness constraints.

Establish a reusable pattern that other resource types can adopt.

## Why Not Deterministic Slugs?

Slugs are unique per `(org, kind)`. In a multi-user cloud org, two users cannot both have an environment with slug `personal`. Embedding the user's identity account ID in the slug (e.g., `personal-acc123`) is a leaky abstraction that:

- Couples the frontend to the identity system's ID format
- Breaks in OSS (no identity system)
- Makes slugs unreadable for no user-facing benefit
- Leaks internal IDs into resource identifiers

Labels are the correct mechanism: set `stigmer.ai/personal: "true"` at creation, query by label to find it. Labels + FGA visibility scoping guarantees the caller only sees their own resources.

## Why Not SearchService?

SearchService (`SearchRequest`) does not support label filtering, and returns `SearchResult` (summary) not full resources. The personal resource flow needs:

1. **Full resource data** — environment `spec.data` with keys/values, not a search summary
2. **Label filtering** — `stigmer.ai/personal: "true"`, which SearchService doesn't support
3. **FGA-scoped results** — only the caller's own resources (SearchService supports this for indexed kinds)

Adding label filtering to SearchService would mix concerns (text search + structured metadata query). Dedicated list RPCs are cleaner and follow the Session/AgentExecution pattern.

---

## Design Decisions

### 1. Request Shape: `org` + `labels` + `page`

Both list requests follow the same shape:

```protobuf
message ListEnvironmentsRequest {
  string org = 1;
  map<string, string> labels = 2;
  PageInfo page = 3;
}
```

- `org` (required): scopes the query to an organization
- `labels` (optional): AND semantics — resource must contain ALL specified labels. Empty = no label filter.
- `page` (optional): offset-based pagination via `PageInfo { num, size }`, consistent with `GetAgentInstancesByAgentRequest` and `SearchRequest`

### 2. Reuse Existing Response Types

`AgentInstanceList` already exists (`total_count` + `items`). The `list` RPC reuses it.

For Environment, a new `EnvironmentList` follows the same convention: `total_count` + `items`.

### 3. Authorization: Skip Standard, Filter In-Handler

List RPCs use `is_skip_authorization = true` (same as `Session.list`, `AgentExecution.list`, `AgentInstance.getByAgent`). Authorization is handled in-handler:

- **Cloud (Java)**: Call `listAuthorizedResourceIds(kind, can_view)` → get authorized IDs → query repo with `findByIdsAndLabels(authorizedIds, labels, pageable)`
- **OSS (Go)**: No auth. Call `store.FindAllByLabel()` for single-label queries or `store.ListResources()` + in-memory label filter for multi-label

### 4. Secret Redaction on Environment List

Environment list MUST run the same `RedactSecretValues` step as `get` and `getByReference`. Listed environments return keys with `is_secret=true` but values replaced with `***REDACTED***`. This is non-negotiable — a list RPC that leaks secrets is a security bug.

### 5. Reusable Pattern

Any resource type can adopt this pattern by:

1. Adding a `List<Resource>Request` with `org` + `labels` + `page` to its `io.proto`
2. Adding a `<Resource>List` response type (if not existing) to its `io.proto`
3. Adding a `list` RPC to its query controller with `is_skip_authorization = true`
4. Implementing a handler with FGA-filtered label query (Java) or store-based label query (Go)
5. Adding the `List` method to its codegen schema

---

## Permission Matrix (List RPC)

| Caller | Sees |
|--------|------|
| Creator/Owner | Their own resources (via FGA `can_view`) |
| Operator | Resources they have `can_view` on |
| Org Admin | N/A for personal resources (no admin in `owner`) |
| Other users | Nothing (FGA blocks visibility) |

In OSS (single-user, no FGA): all resources of the kind are returned.

---

## Task Breakdown

### T01.1 — Proto: Environment list messages + RPC

**Repo**: stigmer (OSS)
**Files**: `apis/ai/stigmer/agentic/environment/v1/io.proto`, `apis/ai/stigmer/agentic/environment/v1/query.proto`

Add to `io.proto`:

```protobuf
import "ai/stigmer/commons/rpc/pagination.proto";

// ListEnvironmentsRequest specifies parameters for listing environments.
message ListEnvironmentsRequest {
  // Organization to list environments for (required).
  string org = 1 [(buf.validate.field).string.min_len = 1];

  // Filter by metadata labels (optional). AND semantics: resource must match ALL labels.
  // Example: {"stigmer.ai/personal": "true"} returns only personal environments.
  map<string, string> labels = 2;

  // Pagination options (optional).
  ai.stigmer.commons.rpc.PageInfo page = 3;
}

// EnvironmentList contains a list of environments.
message EnvironmentList {
  // Total count of matching environments.
  int32 total_count = 1;

  // Environments in the current page.
  repeated Environment items = 2;
}
```

Add to `query.proto`:

```protobuf
// List environments with optional label filtering.
// Authorization is handled in-handler via FGA-filtered queries.
// Secret values are redacted in the response.
rpc list(ListEnvironmentsRequest) returns (EnvironmentList) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.is_skip_authorization) = true;
}
```

### T01.2 — Proto: Agent instance list messages + RPC

**Repo**: stigmer (OSS)
**Files**: `apis/ai/stigmer/agentic/agentinstance/v1/io.proto`, `apis/ai/stigmer/agentic/agentinstance/v1/query.proto`

Add to `io.proto`:

```protobuf
// ListAgentInstancesRequest specifies parameters for listing agent instances.
message ListAgentInstancesRequest {
  // Organization to list agent instances for (required).
  string org = 1 [(buf.validate.field).string.min_len = 1];

  // Filter by metadata labels (optional). AND semantics: resource must match ALL labels.
  map<string, string> labels = 2;

  // Pagination options (optional).
  ai.stigmer.commons.rpc.PageInfo page = 3;
}
```

`AgentInstanceList` already exists in `io.proto` (`total_count` + `items`). Reuse it.

Add to `query.proto`:

```protobuf
// List agent instances with optional label filtering.
// Authorization is handled in-handler via FGA-filtered queries.
rpc list(ListAgentInstancesRequest) returns (AgentInstanceList) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.is_skip_authorization) = true;
}
```

### T01.3 — Go backend: Environment list handler

**Repo**: stigmer (OSS)
**File**: `backend/services/stigmer-server/pkg/domain/environment/controller/list.go` (new)

Pipeline:

```
ValidateProto → ListEnvironmentsByOrgAndLabels → RedactSecretValues
```

Key implementation details:

- **ListEnvironmentsByOrgAndLabels**: Custom step
  - If labels map has exactly one entry: use `store.FindAllByLabel(kind, labelKey, labelValue, templateMsg)`
  - If labels map has multiple entries: use `store.FindAllByLabel()` for the first label, then filter in-memory for remaining labels
  - If labels map is empty: use `store.ListResources(kind)` and filter by org
  - Filter results by `metadata.org == req.org`
  - Apply pagination (offset-based, in-memory)
  - Set `EnvironmentList` in context

- **RedactSecretValues**: Reuse existing `RedactSecretValues` step from the get/getByReference pipeline. Applied to each environment in the list.

Register in `environment_controller.go`: add `List` method, wire the pipeline.

### T01.4 — Go backend: Agent instance list handler

**Repo**: stigmer (OSS)
**File**: `backend/services/stigmer-server/pkg/domain/agentinstance/controller/list.go` (new)

Pipeline:

```
ValidateProto → ListAgentInstancesByOrgAndLabels
```

Same pattern as T01.3 but without `RedactSecretValues` (agent instances have no secrets).

Register in `agentinstance_controller.go`: add `List` method, wire the pipeline.

### T01.5 — Java backend: Environment list handler

**Repo**: stigmer-cloud
**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/handler/EnvironmentListHandler.java` (new)

Pipeline:

```
validateFieldConstraints → queryAuthorizedIds → loadByIdsAndLabels → redactSecretValues → transformResponse → sendResponse
```

Key implementation details:

- **QueryAuthorizedIds**: Inner class step. Calls `iamPolicyGrpcRepo.listAuthorizedResourceIds(principal, "environment", "can_view")`. Stores `List<String>` in context.
- **LoadByIdsAndLabels**: Inner class step. Calls `environmentRepo.findByIdsAndLabels(authorizedIds, labels, pageable)`. New repo method.
- **RedactSecretValues**: Reuse existing redaction logic from `EnvironmentGetHandler`.
- Pagination: `PageRequest.of(pageNumber, pageSize, Sort.by(DESC, "status.audit.specAudit.createdAt"))`

Repository addition — `EnvironmentRepo`:

```java
public Page<Environment> findByIdsAndLabels(
    List<String> ids, Map<String, String> labels, Pageable pageable) {
  Criteria criteria = Criteria.where("metadata.id").in(ids);
  for (Map.Entry<String, String> label : labels.entrySet()) {
    criteria = criteria.and("metadata.labels." + escapeKey(label.getKey()))
                       .is(label.getValue());
  }
  Query query = Query.query(criteria).with(pageable);
  // ... execute and return Page
}
```

Register in `EnvironmentGrpcAutoController`: wire `list` RPC to `EnvironmentListHandler`.

### T01.6 — Java backend: Agent instance list handler

**Repo**: stigmer-cloud
**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentinstance/request/handler/AgentInstanceListHandler.java` (new)

Same FGA pattern as T01.5 but without secret redaction.

Repository addition — `AgentInstanceRepo`:

```java
public Page<AgentInstance> findByIdsAndLabels(
    List<String> ids, Map<String, String> labels, Pageable pageable) { ... }
```

Register in `AgentInstanceGrpcAutoController`: wire `list` RPC to `AgentInstanceListHandler`.

### T01.7 — SDK codegen: Add List methods to schemas

**Repo**: stigmer (OSS)
**Files**: `tools/codegen/schemas/services/environment.json`, `tools/codegen/schemas/services/agentinstance.json`

Add to `environment.json` query methods:

```json
{
  "name": "List",
  "inputType": "ListEnvironmentsRequest",
  "inputFullType": "ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest",
  "outputType": "EnvironmentList",
  "outputFullType": "ai.stigmer.agentic.environment.v1.EnvironmentList",
  "description": "List environments with optional label filtering."
}
```

Add to `agentinstance.json` query methods:

```json
{
  "name": "List",
  "inputType": "ListAgentInstancesRequest",
  "inputFullType": "ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest",
  "outputType": "AgentInstanceList",
  "outputFullType": "ai.stigmer.agentic.agentinstance.v1.AgentInstanceList",
  "description": "List agent instances with optional label filtering."
}
```

After codegen regeneration, this produces:

```typescript
// On EnvironmentClient:
async list(input: ListEnvironmentsRequest): Promise<EnvironmentList> { ... }

// On AgentInstanceClient:
async list(input: ListAgentInstancesRequest): Promise<AgentInstanceList> { ... }
```

### T01.8 — React: Environment and Agent Instance list hooks

**Repo**: stigmer (OSS)
**Files**: `sdk/react/src/environment/useEnvironmentList.ts` (new), `sdk/react/src/agent-instance/useAgentInstanceList.ts` (new)

These are building-block hooks (Layer 1, Profile A) that provide label-filtered list access:

```typescript
// useEnvironmentList.ts
export function useEnvironmentList(
  org: string,
  labels?: Record<string, string>,
): UseEnvironmentListReturn {
  // Calls stigmer.environment.list({ org, labels })
  // Returns { environments, isLoading, error, refetch }
}
```

```typescript
// useAgentInstanceList.ts
export function useAgentInstanceList(
  org: string,
  labels?: Record<string, string>,
): UseAgentInstanceListReturn {
  // Calls stigmer.agentInstance.list({ org, labels })
  // Returns { agentInstances, isLoading, error, refetch }
}
```

Export from barrel files (`sdk/react/src/environment/index.ts`, `sdk/react/src/agent-instance/index.ts`, `sdk/react/src/index.ts`).

These hooks are the foundation that Phase 2's `usePersonalEnvironment` and `usePersonalAgentInstance` orchestration hooks will compose.

---

## Execution Order

```
T01.1 (Proto: environment list)           ─┐
T01.2 (Proto: agent instance list)         ─┤── Independent, can parallel
                                            │
T01.3 (Go: environment list handler)       ─┤── Depends on T01.1
T01.4 (Go: agent instance list handler)    ─┤── Depends on T01.2
                                            │
T01.5 (Java: environment list handler)     ─┤── Depends on T01.1
T01.6 (Java: agent instance list handler)  ─┤── Depends on T01.2
                                            │
T01.7 (SDK codegen schemas)                ─┤── Depends on T01.1, T01.2
                                            │
T01.8 (React hooks)                        ─┘── Depends on T01.7
```

Recommended: **T01.1 + T01.2 → T01.3 + T01.4 + T01.5 + T01.6 + T01.7 → T01.8**

Proto first (both in parallel), then all backend + codegen in parallel, then React hooks.

---

## Files Summary

### stigmer (OSS)

| File | Task | Change |
|------|------|--------|
| `apis/.../environment/v1/io.proto` | T01.1 | Add `ListEnvironmentsRequest`, `EnvironmentList` |
| `apis/.../environment/v1/query.proto` | T01.1 | Add `list` RPC |
| `apis/.../agentinstance/v1/io.proto` | T01.2 | Add `ListAgentInstancesRequest` |
| `apis/.../agentinstance/v1/query.proto` | T01.2 | Add `list` RPC |
| `backend/.../environment/controller/list.go` | T01.3 | New handler |
| `backend/.../environment/controller/environment_controller.go` | T01.3 | Register `List` method |
| `backend/.../agentinstance/controller/list.go` | T01.4 | New handler |
| `backend/.../agentinstance/controller/agentinstance_controller.go` | T01.4 | Register `List` method |
| `backend/.../server/server.go` | T01.3, T01.4 | No change expected (auto-registered) |
| `tools/codegen/schemas/services/environment.json` | T01.7 | Add `List` method |
| `tools/codegen/schemas/services/agentinstance.json` | T01.7 | Add `List` method |
| `sdk/react/src/environment/useEnvironmentList.ts` | T01.8 | New hook |
| `sdk/react/src/agent-instance/useAgentInstanceList.ts` | T01.8 | New hook |
| `sdk/react/src/environment/index.ts` | T01.8 | Export new hook |
| `sdk/react/src/agent-instance/index.ts` | T01.8 | Export new hook |
| `sdk/react/src/index.ts` | T01.8 | Export new hook |

### stigmer-cloud

| File | Task | Change |
|------|------|--------|
| `.../environment/request/handler/EnvironmentListHandler.java` | T01.5 | New handler |
| `.../environment/request/controller/EnvironmentGrpcAutoController.java` | T01.5 | Wire `list` |
| `.../environment/repo/EnvironmentRepo.java` | T01.5 | Add `findByIdsAndLabels` |
| `.../agentinstance/request/handler/AgentInstanceListHandler.java` | T01.6 | New handler |
| `.../agentinstance/request/controller/AgentInstanceGrpcAutoController.java` | T01.6 | Wire `list` |
| `.../agentinstance/repo/AgentInstanceRepo.java` | T01.6 | Add `findByIdsAndLabels` |

---

## Broader Scope: Other Resource Types

The user wants this pattern to be reusable. Resource types that could adopt it in the future:

| Resource | Current List Capability | Candidate for Label-Based List? |
|----------|------------------------|--------------------------------|
| Agent | SearchService | Maybe — for label filtering beyond text search |
| Skill | SearchService | Maybe — for version/label-based queries |
| MCP Server | SearchService | Maybe — for label filtering |
| Session | Dedicated `list` + `listByAgent` | Could add labels to `ListSessionsRequest` |
| Project | None | Yes — project listing by labels |
| Workflow | SearchService | Maybe |

The pattern established here (request shape, FGA filtering, repo methods) is directly applicable to any of these.

---

## Review Process

**What happens next**:
1. **You review this plan** — particularly the request/response shapes and authorization model
2. **Provide feedback** — any concerns or adjustments
3. **I'll create T01_1_review.md** with your feedback, then T01_2_revised_plan.md if needed
4. **You approve** — explicit go-ahead to implement
5. **Execution begins** — tracked in T01_3_execution.md
