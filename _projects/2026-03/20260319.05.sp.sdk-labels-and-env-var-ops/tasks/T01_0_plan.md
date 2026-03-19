# Task T01: SDK Labels Codegen + Environment Variable Management RPCs

**Created**: 2026-03-19
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260319.02.agent-picker-personal-env

**This plan requires your review before execution.**

## Objective

Two tracks of work, both prerequisites for Phase 2 personal environment orchestration:

1. **Track A — SDK Labels Codegen**: Add `labels` support to ALL 17 SDK resource input types via a codegen fix, so any resource can be created/updated with metadata labels.
2. **Track B — Environment Variable Management RPCs**: Add `updateVariables` and `removeVariables` RPCs to safely manage environment variables server-side (avoids the read-modify-write secret destruction problem).
3. **Track C — Backend Sentinel Defense**: Small safety net in update handlers to preserve secrets when the redaction marker is sent back (defense-in-depth, not primary API).

---

## Background: Why This Work Is Needed

### Problem 1: Labels cannot be set via SDK

`EnvironmentInput`, `AgentInstanceInput`, and all other resource input types lack a `labels` field. The codegen template (`tools/codegen/generator/sdk_client_ts.go`) emits:

```ts
metadata: Object.assign(create(ApiResourceMetadataSchema), {
  name: input.name,
  org: input.org,
  // labels is NEVER set
})
```

This blocks `usePersonalEnvironment.getOrCreate()` from setting `stigmer.ai/personal: "true"` on creation.

### Problem 2: Read-modify-write destroys secrets

The Phase 2 `addVariables()` operation needs to merge new env vars into an existing personal environment. The natural approach — read, merge, update — fails because:
- Read returns redacted secrets (`***REDACTED***`)
- Update encrypts and stores the literal `***REDACTED***` string
- Original secret values are permanently lost

Neither Java Cloud (`EncryptSecretValues`) nor Go OSS (`BuildUpdateStateStep`) check for the redaction marker. The fix: dedicated RPCs that perform the merge server-side, where unredacted values are accessible.

---

## Track A: SDK Labels Codegen Fix

### Scope

All 17 resource types in `sdk/typescript/src/gen/` are code-generated from:
- **Generator**: `tools/codegen/generator/sdk_client_ts.go` (function `generateTSBuildProto`, ~lines 682-694)
- **Schemas**: `tools/codegen/schemas/services/*.json`
- **Invocation**: `make -C sdk/typescript codegen` or `go run ./tools/codegen/generator/ --comprehensive ...`

The fix is in the **generator**, not in 17 individual files.

### T01.1 — Update codegen generator to emit `labels` field

**File**: `tools/codegen/generator/sdk_client_ts.go`

1. In the `generateTSInputInterface` function: add `labels?: Record<string, string>` to every resource input type
2. In the `generateTSBuildProto` function: wire `labels` into the metadata block:
   ```ts
   metadata: Object.assign(create(ApiResourceMetadataSchema), {
     name: input.name,
     org: input.org,
     ...(input.labels && { labels: input.labels }),
   })
   ```
3. Verify the conditional spread pattern works with protobuf-es `Object.assign` + `create()` semantics

### T01.2 — Regenerate all SDK TypeScript clients

Run `make -C sdk/typescript codegen` (or equivalent) to regenerate all 17 files in `sdk/typescript/src/gen/`.

Verify:
- All `*Input` interfaces now include `labels?: Record<string, string>`
- All `build*Proto` functions wire labels into metadata
- TypeScript compiles cleanly (`tsc --noEmit`)

### T01.3 — Update Layer 1 React hooks to accept labels

The existing mutation hooks (`useCreateEnvironment`, `useUpdateEnvironment`, `useCreateAgentInstance`) pass `EnvironmentInput` / `AgentInstanceInput` through to the SDK. Since those types now include `labels`, **no React hook changes are needed** — the types flow through automatically.

Verify:
- `@stigmer/react` compiles cleanly
- Existing tests pass (if any)

**Track A is self-contained and can be done independently of Track B.**

---

## Track B: Environment Variable Management RPCs

### Design

Two new RPCs on `EnvironmentCommandController`:

| RPC | Purpose | Authorization |
|-----|---------|---------------|
| `updateVariables` | Merge/upsert specific variables into an environment | `can_edit` on environment |
| `removeVariables` | Remove specific variables by key | `can_edit` on environment |

Both perform **server-side merge** — the client sends only the delta, never the full data map. The server loads the existing environment, applies the change, and persists. Redacted secrets are never involved.

### T01.4 — Proto: Add request/response messages

**File**: `apis/ai/stigmer/agentic/environment/v1/io.proto`

Add two new messages:

```protobuf
// Request to add or update specific variables in an environment.
// Server-side merge: existing variables not included in this request are preserved.
// For secret variables, the new value replaces the old one (re-encrypted server-side).
message UpdateEnvironmentVariablesRequest {
  // The environment resource ID.
  string environment_id = 1 [(buf.validate.field).string.min_len = 1];

  // Variables to add or update. Keys that already exist are overwritten.
  // Keys not present in this map are left unchanged.
  map<string, EnvironmentValue> variables = 2;
}

// Request to remove specific variables from an environment by key.
message RemoveEnvironmentVariablesRequest {
  // The environment resource ID.
  string environment_id = 1 [(buf.validate.field).string.min_len = 1];

  // Keys to remove from EnvironmentSpec.data. Keys that don't exist are silently ignored.
  repeated string keys = 2 [(buf.validate.field).repeated.min_items = 1];
}
```

Import `EnvironmentValue` from `spec.proto` (already in the same package).

Both RPCs return `Environment` (the full resource after mutation), consistent with all other command RPCs.

### T01.5 — Proto: Add RPCs to EnvironmentCommandController

**File**: `apis/ai/stigmer/agentic/environment/v1/command.proto`

```protobuf
// Add or update specific variables in an environment (server-side merge).
// Existing variables not included in the request are preserved unchanged.
rpc updateVariables(UpdateEnvironmentVariablesRequest) returns (Environment) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = environment;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_edit;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "environment_id";
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to update environment variables";
}

// Remove specific variables from an environment by key.
rpc removeVariables(RemoveEnvironmentVariablesRequest) returns (Environment) {
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = environment;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_edit;
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "environment_id";
  option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to remove environment variables";
}
```

**Note**: `field_path` is `"environment_id"` (not `"metadata.id"`) because the request message is `UpdateEnvironmentVariablesRequest`, not `Environment`. Verify this works with the authorization interceptor — it may need `resource_id` instead of `field_path`. Check how `getSecretValue` in `query.proto` handles this (it uses `EnvironmentSecretValueInput.environment_id`).

### T01.6 — Regenerate proto stubs

Run the standard proto generation for all languages:
- Go: `make go-stubs`
- Java: (auto-generated via build)
- Python: (auto-generated)
- TypeScript: (auto-generated via `make ts-stubs` or equivalent)
- Dart: (auto-generated)

### T01.7 — Go OSS: Implement updateVariables handler

**Repo**: stigmer (OSS)
**Location**: `backend/services/stigmer-server/pkg/domain/environment/controller/`

New file: `update_variables.go`

Pipeline:
1. `ValidateProto` — validate request fields
2. `LoadExisting` — load environment by ID from store
3. `MergeVariables` (custom step) — merge `request.variables` into `existing.spec.data`
4. `Persist` — save updated environment

The `MergeVariables` step:
- Iterates over `request.variables`
- For each key: overwrites existing entry (or adds if new)
- Does NOT encrypt (OSS has no encryption — consistent with existing handlers)

### T01.8 — Go OSS: Implement removeVariables handler

**Repo**: stigmer (OSS)
**Location**: `backend/services/stigmer-server/pkg/domain/environment/controller/`

New file: `remove_variables.go`

Pipeline:
1. `ValidateProto`
2. `LoadExisting` — load environment by ID
3. `RemoveKeys` (custom step) — delete specified keys from `existing.spec.data`
4. `Persist`

### T01.9 — Go OSS: Wire handlers into gRPC controller

Register the new RPC handlers in the environment gRPC controller (same pattern as existing `apply`, `create`, `update`, `delete`).

### T01.10 — Java Cloud: Implement EnvironmentUpdateVariablesHandler

**Repo**: stigmer-cloud
**Location**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/handler/`

New file: `EnvironmentUpdateVariablesHandler.java`

Pipeline (following `EnvironmentGetSecretValueHandler` pattern for single-env-by-ID access):
1. `ValidateRequest` — ensure environment_id and variables are present
2. `QueryAuthorizedIds` — FGA check (`can_edit` on environment)
3. `LoadEnvironment` — load by ID from repo
4. `MergeVariables` — merge new variables into existing `spec.data`
5. `EncryptNewSecrets` — encrypt only the NEW/CHANGED secret values (not the entire data map)
6. `PersistEnvironment` — save
7. `RedactAndRespond` — redact secret values in the response (consistent with all other env responses)

**Key subtlety**: Step 5 must encrypt only the variables from the request, not re-encrypt existing variables that are already encrypted. Compare each key against the request's variable keys to determine which ones are new/changed.

### T01.11 — Java Cloud: Implement EnvironmentRemoveVariablesHandler

**Repo**: stigmer-cloud

New file: `EnvironmentRemoveVariablesHandler.java`

Pipeline:
1. `ValidateRequest`
2. `QueryAuthorizedIds` — FGA check (`can_edit`)
3. `LoadEnvironment`
4. `RemoveKeys` — delete specified keys from `spec.data`
5. `PersistEnvironment`
6. `RedactAndRespond`

### T01.12 — Java Cloud: Wire handlers and update gRPC controller doc comments

Register handlers in `EnvironmentGrpcAutoController.java`.

---

## Track C: Backend Sentinel Defense-in-Depth

Small, targeted changes. NOT the primary API — this is a safety net for clients that do naive read-modify-write via the existing `update` RPC.

### T01.13 — Java Cloud: Check for redaction marker in EncryptSecretValues

**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/environment/request/step/EncryptSecretValues.java`

Before encrypting a value, check:
```java
if (value.getIsSecret() && RedactSecretValues.isRedacted(value.getValue())) {
    // Value was redacted in a previous read — preserve the existing encrypted value
    EnvironmentValue existing = existingSpec.getDataOrDefault(key, null);
    if (existing != null && existing.getIsSecret()) {
        encryptedData.put(key, existing);
        continue;
    }
}
```

This requires `EncryptSecretValues` to have access to the existing environment's spec. Check if the update pipeline's context already carries the loaded existing resource (from `LoadExistingStep`). If yes, extract it. If not, add it to the context.

### T01.14 — Go OSS: Check for redaction marker in update pipeline

**File**: `backend/services/stigmer-server/pkg/domain/environment/controller/update.go` (or the relevant step)

Same pattern: if a value in the update request matches the redaction marker, preserve the existing value from the loaded resource.

---

## Track D: SDK TypeScript Client + React Hooks

### T01.15 — SDK: Add updateVariables and removeVariables to EnvironmentClient

**File**: `sdk/typescript/src/gen/environment.ts`

Two new methods on `EnvironmentClient`:

```ts
async updateVariables(input: UpdateEnvironmentVariablesInput): Promise<Environment> {
  // Build proto from input, call command.updateVariables()
}

async removeVariables(input: RemoveEnvironmentVariablesInput): Promise<Environment> {
  // Build proto from input, call command.removeVariables()
}
```

New input types:
```ts
export interface UpdateEnvironmentVariablesInput {
  environmentId: string;
  variables: Record<string, EnvVarInput>;
}

export interface RemoveEnvironmentVariablesInput {
  environmentId: string;
  keys: string[];
}
```

**Note**: These are hand-crafted additions to the generated file, OR the codegen schemas (`tools/codegen/schemas/services/environment.json`) need to be extended to describe these RPCs. Check which approach is consistent with how `getSecretValue` was added (it also has a custom request message, not a full resource).

### T01.16 — React: Add useUpdateEnvironmentVariables hook

**File**: `sdk/react/src/environment/useUpdateEnvironmentVariables.ts` (new)

Behavior hook wrapping `stigmer.environment.updateVariables()`. Returns `{ updateVariables, isUpdating, error, clearError }`.

### T01.17 — React: Add useRemoveEnvironmentVariables hook

**File**: `sdk/react/src/environment/useRemoveEnvironmentVariables.ts` (new)

Behavior hook wrapping `stigmer.environment.removeVariables()`. Returns `{ removeVariables, isRemoving, error, clearError }`.

### T01.18 — Barrel exports

Update:
- `sdk/react/src/environment/index.ts`
- `sdk/react/src/index.ts`

---

## Execution Order

```
Track A (codegen)           Track B (proto + backends)        Track C (sentinel)
─────────────────           ──────────────────────────        ──────────────────
T01.1 codegen fix           T01.4 proto messages              T01.13 Java sentinel
T01.2 regenerate SDK        T01.5 proto RPCs                  T01.14 Go sentinel
T01.3 verify React hooks    T01.6 regenerate stubs
                            T01.7 Go updateVariables
                            T01.8 Go removeVariables
                            T01.9 Go wire controller
                            T01.10 Java updateVariables
                            T01.11 Java removeVariables
                            T01.12 Java wire controller
                            
                            Track D (SDK + hooks)
                            ─────────────────────
                            T01.15 SDK client methods
                            T01.16 React updateVars hook
                            T01.17 React removeVars hook
                            T01.18 barrel exports
```

- **Track A** is fully independent — can be done first or in parallel.
- **Track B** is sequential: proto → stubs → Go → Java.
- **Track C** is independent but logically belongs after understanding the update pipeline (after Track B Go/Java work).
- **Track D** depends on Track B (needs the generated proto stubs for the new RPC types).

**Recommended order**: Track A first (unblocks Phase 2 label-based creation immediately), then Track B + C, then Track D.

---

## Open Questions (for review)

1. **`field_path` for new RPCs**: The authorization interceptor uses `field_path` to extract the resource ID from the request. For `UpdateEnvironmentVariablesRequest.environment_id`, the path is `"environment_id"`. Verify this works the same way as `EnvironmentSecretValueInput.environment_id` in the `getSecretValue` RPC.

2. **Codegen for custom RPC methods**: `getSecretValue` has a custom request type (not the full resource). Check how it was added to the SDK client — was the codegen schema extended, or was it hand-added? The new variable RPCs should follow the same pattern.

3. **Return type for removeVariables**: The plan returns `Environment` (full resource after mutation). Alternative: return void/empty. Returning the full resource is more useful (caller sees the updated state) and consistent with all other command RPCs.

4. **Partial encryption in updateVariables (Java)**: The handler must encrypt ONLY the new/changed variables, not re-encrypt existing ones. Need to verify that the encryption service handles this correctly (existing values are already `enc:v1:` prefixed and `isEncrypted()` returns true).

---

## Success Criteria

- [ ] All 17 SDK resource input types include `labels?: Record<string, string>`
- [ ] Personal environment can be created with `labels: { "stigmer.ai/personal": "true" }` via SDK
- [ ] `environment.updateVariables()` adds/updates variables without affecting other keys
- [ ] `environment.removeVariables()` removes variables by key
- [ ] Secret values are preserved during both operations (not destroyed by redaction)
- [ ] Update handler preserves secrets when redaction marker is sent back (sentinel defense)
- [ ] All proto stubs regenerated for Go, Java, TypeScript, Python, Dart
- [ ] TypeScript compilation passes for SDK and React packages
- [ ] Go build passes for OSS backend
- [ ] Java build passes for Cloud backend

## Review Process

**What happens next**:
1. **You review this plan** — Consider the approach, open questions, and track ordering
2. **Provide feedback** — Share any concerns or changes
3. **I'll revise the plan** — Create T01_1_review.md with feedback, then T01_2_revised_plan.md
4. **You approve** — Give explicit approval to proceed
5. **Execution begins** — Implementation tracked in T01_3_execution.md
