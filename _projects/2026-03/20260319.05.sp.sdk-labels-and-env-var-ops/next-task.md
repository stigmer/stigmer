# Next Task: 20260319.05.sp.sdk-labels-and-env-var-ops

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260319.02.agent-picker-personal-env
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260319.02.agent-picker-personal-env
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/next-task.md`
**Spawned From Task**: Phase 2 preparation

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260319.05.sp.sdk-labels-and-env-var-ops

**Description**: Add labels support to all SDK resource input types (codegen fix) and add incremental environment variable management RPCs (updateVariables, removeVariables) with backend sentinel defense-in-depth.
**Goal**: 1) Add optional labels field to ALL SDK resource input types and wire into build*Proto functions. 2) Add updateVariables proto RPC to EnvironmentCommandController (server-side merge of new/changed vars). 3) Add removeVariables proto RPC to EnvironmentCommandController (remove specific keys). 4) Implement Go OSS handlers for both new RPCs. 5) Implement Java Cloud handlers for both new RPCs (with encryption awareness). 6) Add backend sentinel defense-in-depth: update handlers preserve existing secret values when redaction marker is sent back. 7) Add SDK TypeScript client methods + React hooks for the new RPCs.
**Tech Stack**: TypeScript/React, Go (backend env merge), Protobuf, OpenFGA
**Components**: sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.02.agent-picker-personal-env/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260319.05.sp.sdk-labels-and-env-var-ops/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-19 16:50
**Current Task**: T01 — ALL TRACKS COMPLETE (A, B, C, D)
**Status**: Complete

## Session Progress (2026-03-19 — Session 1)

### Track A: SDK Labels Codegen Fix — COMPLETE

- Modified all 4 codegen generators (Go, TypeScript, Java, Python) to emit `labels` field
- Added `Labels` to `metaFieldNames` set defensively
- Regenerated all 17 resource client files across all 4 SDKs (68 files total)
- Verified: Go compiles, TypeScript has zero errors, all codegen tests pass

## Session Progress (2026-03-19 — Session 2)

### Track B: Environment Variable Management RPCs — COMPLETE

**What was accomplished (5-phase execution):**

1. **Proto definitions** — Added `UpdateEnvironmentVariablesRequest` and `RemoveEnvironmentVariablesRequest` messages to `io.proto`. Added `updateVariables` and `removeVariables` RPCs to `command.proto` with `can_edit` authorization on `field_path = "environment_id"`.

2. **Stub regeneration** — Ran `make protos` in stigmer OSS (Go, Java, Python, TS stubs + SDK clients). Ran `make protos` in stigmer-cloud (Go, Java, Python, TS, Dart stubs).

3. **Go OSS handlers** — Generalized `LoadEnvironmentByIDStep` with `HasEnvironmentId` interface constraint (now supports 3 proto types). Created `MergeVariablesAndPersistStep` and `RemoveVariableKeysAndPersistStep` custom pipeline steps. Created `update_variables.go` and `remove_variables.go` handlers. Updated both BUILD.bazel files. Code compiles cleanly (`go vet` and `go build` pass).

4. **Java Cloud handlers** — Created `EnvironmentUpdateVariablesHandler` (pipeline: validate → authorize → LoadMergeEncryptAndPersist → RedactSecretValues → sendResponse). Created `EnvironmentRemoveVariablesHandler` (same pattern minus encryption). Both reuse existing `RedactSecretValues` step. Both use `@RequestRoute` for automatic gRPC wiring.

5. **SDK codegen** — `proto2schema --comprehensive` auto-regenerated `environment.json` (2 services, 10 methods). SDK clients regenerated for all 4 languages with `updateVariables()` and `removeVariables()` methods.

**Key architectural decisions:**
- Pipeline type is the request proto (not the resource), consistent with `GetSecretValue` pattern
- Self-contained custom steps handle domain logic + persistence + context storage
- `IndexSearchStep` skipped for variable ops (search extractor only indexes metadata, not spec.data)
- Go OSS does NOT encrypt (consistent with existing create/update); Java Cloud DOES encrypt incoming secrets
- Java handlers set modified env as `target` in context so existing `RedactSecretValues` step works via wildcard type compatibility

**Files created/modified (source changes, excluding generated stubs):**
- `apis/ai/stigmer/agentic/environment/v1/io.proto` — 2 new request messages
- `apis/ai/stigmer/agentic/environment/v1/command.proto` — 2 new RPCs
- `backend/.../environment/controller/steps/load_environment_by_id.go` — generalized with HasEnvironmentId
- `backend/.../environment/controller/steps/merge_variables_and_persist.go` — NEW
- `backend/.../environment/controller/steps/remove_variable_keys_and_persist.go` — NEW
- `backend/.../environment/controller/update_variables.go` — NEW
- `backend/.../environment/controller/remove_variables.go` — NEW
- `backend/.../environment/controller/get_secret_value.go` — updated type param
- `backend/.../environment/controller/BUILD.bazel` — added new srcs
- `backend/.../environment/controller/steps/BUILD.bazel` — added new srcs and deps
- (stigmer-cloud) `EnvironmentUpdateVariablesHandler.java` — NEW
- (stigmer-cloud) `EnvironmentRemoveVariablesHandler.java` — NEW

## Session Progress (2026-03-19 — Session 3)

### Track C: Backend Sentinel Defense-in-Depth — COMPLETE

**What was accomplished (4 insertion points across 2 repos):**

1. **Java Cloud `EncryptSecretValues` step** — Added sentinel check in the encryption loop for the full `update` RPC. When `***REDACTED***` marker is detected, the step uses `instanceof UpdateContextV2` to access the pre-update resource and preserves the existing encrypted value. New `preserveExistingSecret()` helper method. If no existing secret exists for the key, returns `INVALID_ARGUMENT` error.

2. **Java Cloud `LoadMergeEncryptAndPersist` inner step** — Added sentinel check in the `updateVariables` RPC handler. Before encrypting an incoming variable, checks if its value equals the redaction marker and preserves the existing value from the loaded environment. Same `INVALID_ARGUMENT` error for the edge case.

3. **Go OSS `PreserveRedactedSecretsStep`** (NEW) — New pipeline step inserted between `BuildUpdateState` and `NormalizeReferences` in the full `update` pipeline. Defines `RedactedMarker` constant. Iterates `newState.Spec.Data`, replaces any redacted secret entries with values from `ExistingResourceKey`. Returns `INVALID_ARGUMENT` if marker used for a non-existent key.

4. **Go OSS `mergeVariablesAndPersistStep`** — Added sentinel check in the merge loop for the `updateVariables` RPC. Skips overwrite when incoming value matches the redaction marker and an existing secret exists.

**Files created/modified:**
- (stigmer-cloud) `EncryptSecretValues.java` — Added `UpdateContextV2` import, sentinel check, `preserveExistingSecret()` method
- (stigmer-cloud) `EnvironmentUpdateVariablesHandler.java` — Added sentinel check in `LoadMergeEncryptAndPersist`
- (stigmer) `steps/preserve_redacted_secrets.go` — NEW step with `RedactedMarker` constant
- (stigmer) `steps/merge_variables_and_persist.go` — Added sentinel check in merge loop
- (stigmer) `controller/update.go` — Added `envsteps` import and wired new step into pipeline
- (stigmer) `steps/BUILD.bazel` — Added new file to srcs

**Verification:** `go vet` and `go build` pass cleanly.

### Track D: SDK React Hooks — COMPLETE

**What was accomplished:**

1. **`useUpdateEnvironmentVariables` hook** — New behavior hook accepting `UpdateEnvironmentVariablesInput` (friendly type with `EnvVarInput` from `@stigmer/sdk`). Converts to proto internally via `create(EnvironmentValueSchema, ...)` and `create(UpdateEnvironmentVariablesRequestSchema, ...)`. Returns `{ updateVariables, isUpdatingVariables, error, clearError }`.

2. **`useRemoveEnvironmentVariables` hook** — New behavior hook accepting `RemoveEnvironmentVariablesInput`. Simpler conversion (just `environmentId` + `keys`). Returns `{ removeVariables, isRemovingVariables, error, clearError }`.

3. **Barrel exports** — Both hooks and their types exported from `environment/index.ts` and the main `index.ts`.

**Files created/modified:**
- (stigmer) `sdk/react/src/environment/useUpdateEnvironmentVariables.ts` — NEW
- (stigmer) `sdk/react/src/environment/useRemoveEnvironmentVariables.ts` — NEW
- (stigmer) `sdk/react/src/environment/index.ts` — Added exports
- (stigmer) `sdk/react/src/index.ts` — Added exports

**Verification:** `tsc --noEmit` shows zero errors in new files (pre-existing errors in other files are unrelated).

## Sub-Project Status: ALL TRACKS COMPLETE

| Track | Description | Status |
|-------|-------------|--------|
| **A** | SDK Labels Codegen Fix | COMPLETE (Session 1) |
| **B** | Environment Variable Management RPCs | COMPLETE (Session 2) |
| **C** | Backend Sentinel Defense-in-Depth | COMPLETE (Session 3) |
| **D** | SDK React Hooks | COMPLETE (Session 3) |

## Context for Resume

- All 4 tracks are complete — this sub-project is done
- Changes span both stigmer (OSS) and stigmer-cloud repos
- Session 3 changes: 5 modified + 3 new files in stigmer OSS, 2 modified files in stigmer-cloud
- `RedactedMarker` constant in Go steps package is reusable by future environment operations
- React hooks follow the established mutation hook pattern (useState + useCallback, friendly input types)
- The hooks shield platform builders from protobuf-es imports — they accept `EnvVarInput` from `@stigmer/sdk`

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Return to parent project" - Go back to 20260319.02.agent-picker-personal-env

---

*This file provides portable paths to all project resources for quick context loading.*
