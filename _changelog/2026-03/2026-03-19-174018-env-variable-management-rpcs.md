# Environment Variable Management RPCs — Full-Stack Implementation

**Date**: March 19, 2026

## Summary

Implemented `updateVariables` and `removeVariables` RPCs for the Environment resource, enabling incremental variable management without full-resource replace semantics. The feature spans proto definitions, stub generation across 6 languages, Go OSS backend handlers, Java Cloud handlers with encryption, and auto-generated SDK clients in Go, TypeScript, Java, and Python.

## Problem Statement

Environment variable management previously required full-resource `update` operations, forcing clients to fetch the entire environment, modify the variables map, and write it back. This read-modify-write pattern is error-prone (race conditions, accidental overwrites), bandwidth-wasteful for large variable sets, and dangerous for secrets (redacted values get written back, destroying encrypted data).

### Pain Points

- No way to add or change a single environment variable without replacing the entire spec
- No way to remove specific variable keys without reconstructing the full map
- Full-resource updates risk overwriting concurrent changes from other clients
- Redacted secret values (`***REDACTED***`) could be accidentally persisted back as literal strings

## Solution

Added two targeted RPCs to `EnvironmentCommandController`:

1. **`updateVariables`** — Server-side merge of provided key-value pairs into the existing environment's variable map. Existing keys not in the request are preserved. New keys are added. Changed keys are overwritten.

2. **`removeVariables`** — Server-side deletion of specified keys from the environment's variable map. Keys that don't exist are silently ignored.

Both RPCs accept an `environment_id` (not the full resource) and return the complete updated `Environment`, making them idempotent and safe for concurrent use.

## Implementation Details

### Proto Definitions

Two new request messages in `io.proto`:

- `UpdateEnvironmentVariablesRequest` — `environment_id` (required) + `map<string, EnvironmentValue> variables`
- `RemoveEnvironmentVariablesRequest` — `environment_id` (required) + `repeated string keys` (min 1)

Two new RPCs in `command.proto` with `can_edit` authorization using `field_path = "environment_id"` — since the request is not the resource itself, the authorization interceptor resolves org/project context from the referenced environment.

### Go OSS Backend

**Generic pipeline step refactoring**: Introduced `HasEnvironmentId` interface constraint (`proto.Message + GetEnvironmentId() string`) to generalize `LoadEnvironmentByIDStep` across 3 different request proto types.

**Custom pipeline steps**: Created `MergeVariablesAndPersistStep` and `RemoveVariableKeysAndPersistStep` as self-contained steps that handle loading, domain logic, audit timestamp updates, and persistence. The pipeline generic type is the request message (not `Environment`), consistent with the `GetSecretValue` handler pattern.

**Handlers**: `update_variables.go` and `remove_variables.go` each orchestrate a 3-step pipeline: `ValidateProto → LoadByEnvironmentID → CustomStep`.

### Java Cloud Backend

**`EnvironmentUpdateVariablesHandler`**: Extends `CustomOperationHandlerV2` with a `LoadMergeEncryptAndPersist` inner step that loads the environment, merges incoming variables (encrypting secrets via `EnvironmentSecretService.encrypt()`), updates audit timestamps, and persists. The existing `RedactSecretValues` step is reused for response sanitization.

**`EnvironmentRemoveVariablesHandler`**: Same pattern with a `LoadRemoveAndPersist` inner step that loads and removes specified keys. No encryption needed for removal.

Both handlers use `@RequestRoute` for automatic gRPC method wiring via annotation processing.

### SDK Codegen

The `proto2schema --comprehensive` command auto-regenerated `environment.json` (now 2 services, 10 methods), and the SDK generator produced `updateVariables()` and `removeVariables()` client methods in all 4 languages.

## Benefits

- **Atomic variable operations**: Add/update/remove individual variables without touching the rest
- **Concurrent safety**: No read-modify-write cycle needed; server handles the merge
- **Secret safety**: Clients never need to round-trip the full variable map, reducing risk of redacted value corruption
- **Bandwidth efficiency**: Send only the variables that change, not the entire spec
- **SDK ergonomics**: Generated client methods in Go, TypeScript, Java, and Python with typed request objects

## Impact

- **Platform builders**: Can now manage environment variables incrementally via SDK methods
- **Console/UI**: Can implement per-variable edit/delete without full-resource PATCH semantics
- **Security posture**: Reduced surface area for accidental secret destruction
- **All SDKs**: 4 languages gain 2 new methods each, auto-generated from proto definitions

## Related Work

- Track A (same session): SDK labels codegen — enables label-based filtering needed for personal environments
- Track C (pending): Sentinel defense-in-depth — will protect the existing full `update` RPC from redacted value corruption
- Track D (pending): React hooks `useUpdateEnvironmentVariables` / `useRemoveEnvironmentVariables`
- Previous: `getSecretValue` RPC (same non-CRUD handler pattern, same `HasEnvironmentId` interface)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
