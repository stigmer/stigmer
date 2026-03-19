# Task T01: Environment Authorization & Secret Redaction

**Created**: 2026-03-19
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260319.02.agent-picker-personal-env

**This plan requires your review before execution.**

## Objective

Make environments and agent instances truly personal resources (remove admin access), enable regular org members to create them, and add a creator-only RPC for retrieving a single unredacted secret value by key.

## Pre-Implementation Analysis (Key Findings)

### Already Implemented (No Work Needed)

1. **Secret redaction in queries** — Both `EnvironmentGetHandler` and `EnvironmentGetByReferenceHandler` already run `RedactSecretValues` in their pipeline. Values with `is_secret=true` are replaced with `***REDACTED***`. No change needed.

2. **Agent instance creation authorization** — Uses `can_create_instance` on the parent Agent resource (not org-level). Any agent viewer/org member can create instances. No change needed.

3. **Secret encryption at rest** — `EncryptSecretValues` in create/update handlers. AES-256-GCM via `EnvironmentSecretService`. No change needed.

---

## Design Decisions

### 1. Personal Resources: No Admin Access

Environments and agent instances are personal resources. Org admins have no business accessing them.

**Rationale**:
- Environments hold personal secrets (GitHub tokens, AWS keys). Admin visibility is a security leak.
- Agent instances hold personal preferences (model choice, tuning). Admin access is pointless.
- Cleanup when a user leaves is handled by the operator (platform team), not the org admin.

**Change**: Remove `admin from organization` from `owner` on both `environment` and `agent_instance`.

```fga
# Before:
define owner: [identity_account] or admin from organization or operator

# After:
define owner: [identity_account] or operator
```

### 2. `creator` Relation Instead of Ad-Hoc `secret_reader`

Instead of inventing an environment-specific `secret_reader` relation, introduce a `creator` relation that models a real domain fact: "who created this resource."

**Rationale**:
- `creator` is a universal domain concept, not a permission hack
- The FGA model becomes self-documenting: `can_read_secrets: creator` reads like a policy
- Extensible: if other resources need creator-specific permissions in the future, the pattern exists
- The tuple is trivial to write — same user, same moment as `owner`

### 3. `can_read_secrets: creator` — No Operators, No Admins

Only the person who stored the secrets can read them back. Period.

**Rationale**:
- Operators manage resources (CRUD) but reading someone's personal GitHub token is not a management action
- The execution engine reads secrets through `ExecutionContext.getByExecutionId` (internal server path with `DecryptSecretValues`), not through `getSecretValue`. No operational need for operator access.
- Admins are already excluded by the owner change above

### 5. Single-Key Secret Retrieval (Not Bulk)

The `getSecretValue` RPC returns one decrypted value at a time, not the entire environment.

**Rationale**:
- **Blast radius**: if intercepted, one secret leaks, not all
- **Audit trail**: logs show exactly which key was read
- **UX pattern**: matches industry standard (AWS, GitHub) — "reveal" button per field, not "show all"
- **No over-fetching**: only decrypt what's needed

### 4. Shared Environments — Deferred

The current model supports sharing when needed (the `viewer` relation accepts explicit grants). Designing sharing semantics (who can grant `can_read_secrets` to others) is deferred until the use case materializes. The model is extensible without breaking changes.

---

## Permission Matrix (After Changes)

### Environment

| Action | Creator | Operator | Org Admin | Explicit Viewer | Execution Engine |
|--------|---------|----------|-----------|-----------------|------------------|
| See resource exists | Yes | Yes | No | Yes | N/A |
| View keys + redacted values | Yes | Yes | No | Yes | N/A |
| Read one raw secret value (by key) | **Yes** | **No** | **No** | **No** | via ExecutionContext |
| Edit keys/values | Yes | Yes | No | No | N/A |
| Delete | Yes | Yes | No | No | N/A |
| Grant access | Yes | Yes | No | No | N/A |

### Agent Instance

| Action | Creator | Operator | Org Admin | Explicit Viewer |
|--------|---------|----------|-----------|-----------------|
| View | Yes | Yes | No | Yes |
| Execute (create sessions) | Yes | Yes | No | Yes |
| Edit | Yes | Yes | No | No |
| Delete | Yes | Yes | No | No |

---

## Task Breakdown

### T01.1 — FGA: `can_create_environment: member`

**Repo**: stigmer-cloud
**File**: `backend/services/stigmer-service/src/main/resources/fga/model/tenancy/organization.fga`

```fga
# Before:
define can_create_environment: admin

# After:
define can_create_environment: member
```

Any org member can create environments. The created environment is RESTRICTED — only the creator + operator can see it. Creation permission is orthogonal to visibility.

### T01.2 — FGA: Remove admin from environment owner + add `creator` and `can_read_secrets`

**Repo**: stigmer-cloud
**File**: `backend/services/stigmer-service/src/main/resources/fga/model/agentic/environment.fga`

Updated model:
```fga
type environment
  relations
    define organization: [organization]
    define operator: operator from organization

    # Creator: the identity_account that originally created this resource.
    # Immutable attribution. Written once at creation, never changed.
    define creator: [identity_account]

    # Owner: creator + operators. Admins explicitly excluded (personal resource).
    define owner: [identity_account] or operator

    define viewer: [identity_account] or owner

    define can_view: viewer
    define can_edit: owner
    define can_delete: owner

    # Only the creator can read unredacted secret values.
    # Not operators, not admins, not explicit viewers.
    define can_read_secrets: creator

    define can_grant_access: owner
    define can_view_access: viewer
```

### T01.3 — FGA: Remove admin from agent instance owner

**Repo**: stigmer-cloud
**File**: `backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent_instance.fga`

```fga
# Before:
define owner: [identity_account] or admin from organization or operator

# After:
define owner: [identity_account] or operator
```

Same rationale: agent instances are personal resources. No `creator` or `can_read_secrets` needed here (no secrets in agent instance spec).

### T01.4 — Backend: Write `creator` FGA tuple on environment creation

**Repo**: stigmer-cloud

Add `creator` tuple to the environment creation flow. On creation, the system already writes:
```
environment:<id>#organization@organization:<org_id>
environment:<id>#owner@identity_account:<creator_id>
```

Add:
```
environment:<id>#creator@identity_account:<creator_id>
```

**Implementation**: Add a custom pipeline step in `EnvironmentCreateHandler` (after `createAuthorizationTuples`) that writes the `creator` tuple. Same user, same moment. Also update `EnvironmentApplyHandler` to include this when it delegates to creation.

### T01.5 — Proto: Add `getSecretValue` RPC + input message

**Repo**: stigmer (OSS)
**File**: `apis/ai/stigmer/agentic/environment/v1/query.proto` and `apis/ai/stigmer/agentic/environment/v1/io.proto`

Add input message to `io.proto`:
```protobuf
// Input for retrieving a single unredacted secret value from an environment.
message EnvironmentSecretValueInput {
  // The environment resource ID.
  string environment_id = 1 [(buf.validate.field).string.min_len = 1];
  // The specific key to retrieve the unredacted value for.
  string key = 2 [(buf.validate.field).string.min_len = 1];
}
```

Add RPC to `query.proto`:
```protobuf
// Get the unredacted value of a single secret key in an environment.
// Creator-only: requires can_read_secrets permission.
// Returns the EnvironmentValue with the decrypted value.
// Use cases: "reveal" button in UI, verifying stored credentials.
rpc getSecretValue(EnvironmentSecretValueInput) returns (EnvironmentValue) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = environment;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_read_secrets;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "environment_id";
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to read secret values (creator-only)";
}
```

Returns a single `EnvironmentValue` (value + is_secret + description), not the entire Environment. Minimal exposure.

### T01.6 — Backend: Implement `getSecretValue` handler

**Repo**: stigmer-cloud
**File**: New `EnvironmentGetSecretValueHandler.java`

Pipeline:
```
validate → extractEnvironmentId → authorize(can_read_secrets) → loadTarget → extractAndDecryptSingleKey → transformResponse → sendResponse
```

Key steps:
- `extractEnvironmentId`: extract the environment ID from `EnvironmentSecretValueInput`
- `authorize`: FGA check for `can_read_secrets` on the environment
- `loadTarget`: load the environment from repo
- `extractAndDecryptSingleKey`: find the requested key in `spec.data`, decrypt it via `EnvironmentSecretService`, return the single `EnvironmentValue`
- If key doesn't exist: return NOT_FOUND
- If key exists but `is_secret` is false: return the value as-is (no decryption needed)

### T01.7 — SDK: Verify `getSecretValue` in TypeScript SDK

**Repo**: stigmer (OSS)

After proto generation, verify `stigmer.environment.getSecretValue({ environmentId, key })` is available in the TypeScript SDK client. If auto-generated, no manual work needed.

---

## Execution Order

```
T01.1 (FGA: member creation)     — independent, ship first
T01.2 (FGA: environment model)   — independent of T01.1
T01.3 (FGA: agent instance model) — independent, can parallel with T01.2
T01.4 (Backend: creator tuple)   — depends on T01.2 (needs creator relation in model)
T01.5 (Proto: getSecretValue)    — independent of FGA changes
T01.6 (Backend: handler)         — depends on T01.2, T01.4, T01.5
T01.7 (SDK: verify)              — depends on T01.5
```

Recommended: **T01.1 + T01.2 + T01.3 → T01.4 + T01.5 → T01.6 → T01.7**

T01.1, T01.2, T01.3 can all be done in parallel (independent FGA model changes).
T01.4 and T01.5 can be done in parallel (different repos).

---

## Files Summary

### stigmer (OSS)

| File | Task | Change |
|------|------|--------|
| `apis/ai/stigmer/agentic/environment/v1/query.proto` | T01.5 | Add `getSecretValue` RPC |
| `apis/ai/stigmer/agentic/environment/v1/io.proto` | T01.5 | Add `EnvironmentSecretValueInput` message |

### stigmer-cloud

| File | Task | Change |
|------|------|--------|
| `.../fga/model/tenancy/organization.fga` | T01.1 | `can_create_environment: member` |
| `.../fga/model/agentic/environment.fga` | T01.2 | Remove admin from owner, add `creator`, `can_read_secrets` |
| `.../fga/model/agentic/agent_instance.fga` | T01.3 | Remove admin from owner |
| `.../environment/request/handler/EnvironmentCreateHandler.java` | T01.4 | Write `creator` FGA tuple |
| `.../environment/request/handler/EnvironmentApplyHandler.java` | T01.4 | Write `creator` FGA tuple (on create path) |
| `.../environment/request/handler/EnvironmentGetSecretValueHandler.java` | T01.6 | New handler (single key decrypt) |

---

## Review Process

**What happens next**:
1. **You review this plan** — particularly the permission matrix and FGA model changes
2. **Provide feedback** — any concerns or adjustments
3. **I'll create T01_1_review.md** with your feedback, then T01_2_revised_plan.md if needed
4. **You approve** — explicit go-ahead to implement
5. **Execution begins** — tracked in T01_3_execution.md
