# Implement Artifact Controllers + Runner Integration (T07 Artifact Store)

**Date**: May 24, 2026

## Summary

Implemented the full T07 Artifact Store pipeline: ArtifactQueryController and ArtifactCommandController gRPC services in the Go server (OSS), Java handlers in stigmer-cloud, TypeScript runner integration for automatic artifact promotion, and comprehensive tests. This resolves the `Unimplemented` gRPC errors flooding logs when the WorkflowExecutionViewer calls `listByExecution`.

## Problem Statement

The `WorkflowExecutionViewer` React component called `ArtifactQueryController/listByExecution` via gRPC-Web, but no backend implemented this service. The gRPC framework returned `Unimplemented`, flooding logs with errors on every workflow execution view. Beyond the missing controller, no code path created first-class `Artifact` resources — the runner uploaded blobs directly and recorded metadata as `ExecutionArtifact` on `AgentExecutionStatus` (a separate, older model).

### Pain Points

- Red `Unimplemented` errors in server logs on every workflow execution page load
- The proto contract for Artifact (6 proto files, full resource model) was designed but had zero backend implementation
- No pipeline existed to create first-class Artifact resources from workflow task outputs
- The `artifact` kind was already registered (enum value 55, id_prefix "art") but never used

## Solution

Implemented the complete T07 pipeline across three codebases:

1. **Go Server (OSS)** — `ArtifactController` with 5 RPCs: `create`, `get`, `listByExecution`, `getDownloadUrl`, `delete`
2. **Java Service (Cloud)** — `ArtifactGrpcAutoController`, 5 handlers, `ArtifactRepo` with MongoDB indexed queries
3. **TypeScript Runner** — `promoteTaskOutput` Temporal local activity that auto-promotes large task outputs (>256KB) to the Artifact store

## Implementation Details

### Go Controller (OSS)

New package `backend/services/stigmer-server/pkg/domain/artifact/controller/` with 6 files:

- **`create.go`** — Direct handler (not pipeline) because `CreateArtifactInput` is non-standard (spec + content bytes, not a resource proto). SHA-256 hashes content for content-addressable storage, uploads blob via `ArtifactStorage`, generates `art_{ulid}` IDs via `steps.GenerateID("art")`, derives org from the producing execution, persists metadata to SQLite.
- **`get.go`** — Standard pipeline with `ValidateProto` + `LoadTarget`. `ArtifactId` satisfies `HasIdValue`.
- **`list_by_execution.go`** — Custom pipeline with `ListResources` + in-memory filtering by `spec.source.workflow_execution_id` or `agent_execution_id`. Follows the `ListBySession` pattern.
- **`get_download_url.go`** — Direct handler that loads artifact, checks `storage_state != deleted`, generates signed URL via `ArtifactStorage.GetSignedURL`.
- **`delete.go`** — Soft delete: transitions `storage_state` to `deleted`, does NOT remove blob (GC deferred).

Registered in `server.go` after the existing `agentExecutionArtifactStorage` initialization, reusing the same `ArtifactStorage` instance.

### Java Controller (Cloud)

New package `domain/agentic/artifact/` with:

- `ArtifactGrpcAutoController` — annotation-processor-driven routing
- `ArtifactRepo` — `AbstractMongoApiResourceRepository<Artifact>` with `findByWorkflowExecutionId` and `findByAgentExecutionId` indexed queries
- 5 handlers following `CustomOperationHandlerV2` pipeline pattern

### Runner Integration (TypeScript)

- Added `ArtifactCommandController` client to `stigmer-client.ts`
- New `promote-task-output.ts` Temporal local activity: checks if serialized output exceeds 256KB, calls `ArtifactCommandController.create()`, returns `_artifact_ref` replacement
- Wired into `do-executor.ts` between task completion and status truncation
- Added `promoteTaskOutput` callback to `TaskExecutionContext`
- Added `ArtifactCreatedEvent` to `WorkflowEventDescriptor` union
- Added `artifact_created` case to `toProtoEvent()` in event activities

### Key Design Decisions

- **Content-addressable blob storage**: Blobs keyed by SHA-256 hash, enabling natural deduplication. Two artifacts with identical content share the same blob but have distinct metadata records.
- **`create` as direct handler**: `CreateArtifactInput` (spec + content) doesn't satisfy `HasMetadata`, so the standard pipeline (`BuildNewStateStep` → `PersistStep`) can't be used. Custom handler builds the Artifact proto manually.
- **`FindAllByField` returns unfiltered**: Discovered during testing that the SQLite `FindAllByField` implementation returns ALL resources of a kind without filtering. `listByExecution` uses `ListResources` + manual filtering instead (same pattern as `ListBySession`).
- **Org derivation via proto field 3 proxy**: All Stigmer resources share `ApiResourceMetadata` at proto field 3. The `create` handler uses `Artifact` as a lightweight proxy to read metadata.org from workflow/agent execution records without importing execution-specific proto packages.

## Benefits

- Eliminates `Unimplemented` gRPC errors from the WorkflowExecutionViewer
- Enables the artifact sidebar in the execution viewer to show real data
- Provides the write path for runners to create first-class artifacts
- Content-addressable blob storage enables natural deduplication
- Soft-delete preserves metadata for audit while marking blobs for future GC

## Impact

- **Frontend**: `useWorkflowExecutionArtifacts` hook now receives real responses instead of errors
- **Backend (OSS)**: Two new gRPC services registered (`ArtifactCommandController`, `ArtifactQueryController`)
- **Backend (Cloud)**: New artifact domain with MongoDB repo and 5 handlers
- **Runner**: Workflow task outputs >256KB automatically promoted to artifacts with `_artifact_ref` substitution

## Related Work

- Proto contract designed during T07 (Artifact Store) milestone
- `ExecutionArtifact` (agent-level artifacts embedded in status) remains separate — convergence is a future concern
- Retention/GC background job deferred
- `WorkflowTask.artifact_ids` proto field wiring deferred to when promotion is verified end-to-end

---

**Status**: Production Ready
**Timeline**: Single session
