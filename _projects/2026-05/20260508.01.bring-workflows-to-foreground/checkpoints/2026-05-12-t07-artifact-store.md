# T07: Artifact Store Integration — Session Checkpoint

**Date**: May 12, 2026
**Status**: COMPLETE (proto-only for Phase 0)
**Commit**: (pending)

## Accomplishments

- Designed and implemented the full Artifact Store proto contract
- Created new `artifact/v1` bounded context as a first-class shared resource
- Extended execution event model and task model with artifact support
- All codegen pipelines pass cleanly across both repos

## New Proto Package: `apis/ai/stigmer/agentic/artifact/v1/`

| File | Contents |
|------|----------|
| `api.proto` | `Artifact` resource (api_version + kind + metadata + spec + status), `ArtifactStatus` |
| `spec.proto` | `ArtifactSpec`, `ArtifactSource`, `RetentionPolicy` |
| `enum.proto` | `ArtifactStorageState` (pending → stored → deleted) |
| `io.proto` | `ArtifactId`, `ArtifactList`, `CreateArtifactInput`, `ListArtifactsByExecutionRequest`, `ArtifactDownloadUrl` |
| `query.proto` | `ArtifactQueryController`: `get`, `listByExecution`, `getDownloadUrl` |
| `command.proto` | `ArtifactCommandController`: `create`, `delete` |

## Modifications to Existing Protos

- **`ApiResourceKind`**: Added `artifact = 55` (prefix: "art", tier: open_source, org-scoped)
- **`workflowexecution/v1/event.proto`**: Added `artifact_created = 53` event type + `ArtifactCreatedPayload` message + oneof branch
- **`workflowexecution/v1/api.proto`**: Added `repeated string artifact_ids = 11` to `WorkflowTask`

## Design Decisions

1. **DD-T07-01**: Shared `artifact/v1` bounded context — artifacts are first-class resources, not sub-resources of executions
2. **DD-T07-02**: No `artifact_store` task kind — artifact creation is infrastructure, not a computation step
3. **DD-T07-03**: Content-addressable blob storage (SHA-256) — dedup for free, safe GC
4. **DD-T07-04**: Metadata in DB, blobs on object storage — local FS for OSS, S3 for Cloud
5. **DD-T07-05**: Automatic promotion threshold (256KB default) — transparent to workflow authors

## Generated Artifacts

SDK clients auto-generated across all target languages:
- Go: `sdk/go/internal/gen/artifact.go`
- TypeScript: `sdk/typescript/src/gen/artifact.ts`
- Python: `sdk/python/src/stigmer/_gen/_artifact.py`
- Java: `sdk/java/src/main/java/ai/stigmer/sdk/gen/ArtifactClient.java`
- Docs: `docs/sdk/resources/artifact.mdx`
- Service schema: `tools/codegen/schemas/services/artifact.json` (2 services, 5 methods)

## Verification

- `buf lint` — clean
- `buf breaking` — clean
- `make codegen` (stigmer) — 22 resources, 0 failures
- `make protos` (stigmer-cloud) — clean
- `go vet` — clean
- `@stigmer/sdk typecheck` — clean

## What's Next

T07 completes Phase 0 (Harden the Workflow Core). Next:
- Phase 1 begins: T08 (Workflow Pages), T09 (Execution Viewer), etc.
- T13 (Backend Implementation) will implement the artifact repository, blob store, auto-promotion logic, and GC
