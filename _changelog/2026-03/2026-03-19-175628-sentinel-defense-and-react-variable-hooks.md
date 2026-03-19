# Sentinel Defense for Secret Preservation and React Variable Management Hooks

**Date**: March 19, 2026

## Summary

Added defense-in-depth secret preservation to all environment update pipelines (Java Cloud and Go OSS) and created two new React behavior hooks for incremental variable management. The sentinel defense prevents the read-modify-write pattern from destroying encrypted secrets when the `***REDACTED***` marker is sent back in update requests. The hooks provide platform builders with clean, protobuf-free APIs for adding, updating, and removing individual environment variables.

## Problem Statement

Two related gaps existed in the environment management stack:

### Pain Points

- **Secret destruction via read-modify-write**: When a client reads an environment (secrets come back as `***REDACTED***`), modifies non-secret fields, and updates the full resource, the literal `***REDACTED***` string gets encrypted and stored — permanently destroying the real secret. Neither the Java Cloud `EncryptSecretValues` step nor the Go OSS `BuildUpdateState` step checked for this marker.
- **No React hooks for the new variable RPCs**: The `updateVariables` and `removeVariables` SDK client methods (added in Session 2) had no corresponding React hooks, meaning platform builders had to manage loading state, error handling, and proto construction manually.

## Solution

**Track C (Sentinel Defense):** Added marker detection at 4 points across both backends. When the redaction marker is detected on a secret value, the existing encrypted value from the pre-update resource is preserved. When the marker is used for a non-existent key (no secret to preserve), a clear `INVALID_ARGUMENT` error is returned.

**Track D (React Hooks):** Created `useUpdateEnvironmentVariables` and `useRemoveEnvironmentVariables` following the established mutation hook pattern, with friendly input types that shield platform builders from protobuf internals.

## Implementation Details

### Sentinel Defense (4 insertion points)

**Java Cloud — `EncryptSecretValues` (full `update` RPC):**
- Added `preserveExistingSecret()` helper that uses `instanceof UpdateContextV2` to access the pre-update resource
- Sentinel check runs before `secretService.encrypt()` in the main loop

**Java Cloud — `LoadMergeEncryptAndPersist` (`updateVariables` RPC):**
- Sentinel check before encryption in the merge loop
- Simpler than C1: the loaded environment is already a local variable

**Go OSS — `PreserveRedactedSecretsStep` (full `update` RPC):**
- New pipeline step with `RedactedMarker` constant
- Inserted between `BuildUpdateState` and `NormalizeReferences`
- Reads `NewState()` and `ExistingResourceKey`, patches redacted entries

**Go OSS — `mergeVariablesAndPersistStep` (`updateVariables` RPC):**
- Sentinel check in merge loop before key overwrite

### React Hooks

**`useUpdateEnvironmentVariables`:**
- Accepts `UpdateEnvironmentVariablesInput` with `EnvVarInput` from `@stigmer/sdk`
- Converts to proto via `create(EnvironmentValueSchema)` and `create(UpdateEnvironmentVariablesRequestSchema)`
- Returns `{ updateVariables, isUpdatingVariables, error, clearError }`

**`useRemoveEnvironmentVariables`:**
- Accepts `RemoveEnvironmentVariablesInput` with `environmentId` and `keys`
- Converts to proto via `create(RemoveEnvironmentVariablesRequestSchema)`
- Returns `{ removeVariables, isRemovingVariables, error, clearError }`

## Benefits

- **Data safety**: Secrets can no longer be accidentally destroyed by naive read-modify-write cycles
- **Clear error messages**: Attempting to set a new secret to the redaction marker returns an actionable error rather than silently corrupting data
- **Platform builder DX**: Two clean hooks with friendly input types, zero protobuf knowledge required
- **Consistent patterns**: Both hooks follow established mutation hook conventions, making the React SDK predictable

## Impact

- **Backend (Java Cloud)**: 2 files modified — `EncryptSecretValues.java`, `EnvironmentUpdateVariablesHandler.java`
- **Backend (Go OSS)**: 3 files modified, 1 new file — `update.go`, `merge_variables_and_persist.go`, `BUILD.bazel`, `preserve_redacted_secrets.go`
- **SDK React**: 2 new files, 2 modified — hooks + barrel exports
- **Affected RPCs**: `update`, `updateVariables` (both now sentinel-defended)
- **Affected packages**: `@stigmer/react` gains 2 new hooks, 2 input types, 2 return types

## Related Work

- Tracks A and B (SDK labels codegen + variable management RPCs) from the same sub-project
- Parent project: 20260319.02.agent-picker-personal-env (Phase 2 prerequisites)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
