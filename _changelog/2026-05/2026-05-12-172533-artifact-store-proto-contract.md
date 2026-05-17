# Artifact Store Proto Contract (T07)

**Date**: May 12, 2026

## Summary

Designed and implemented the complete Artifact Store proto contract — a new `artifact/v1` bounded context that gives workflow and agent executions a first-class mechanism for persisting large outputs outside Temporal history. This is the final task of Phase 0 (Harden the Workflow Core), completing the foundational API layer for the entire workflow orchestration system.

## Problem Statement

Temporal workflow histories are capped at 51,200 events / 50 MB. Large task outputs (agent-generated reports, datasets, code bundles, structured JSON) stored inline in `WorkflowTask.output` will exhaust these limits as workflows scale. The platform needed an externalization mechanism that keeps execution snapshots lean while giving artifacts their own lifecycle, retrieval APIs, and storage strategy.

### Pain Points

- Inline task outputs bloat Temporal history and risk hitting hard limits
- No way to retrieve large outputs independently of the execution status snapshot
- No lifecycle management (retention, expiration) for execution-produced data
- OSS and Cloud editions need different storage backends but identical APIs

## Solution

Created a new shared `artifact/v1` bounded context following the established Stigmer resource pattern (api_version + kind + metadata + spec + status). Artifacts are first-class resources with content-addressable blob storage (SHA-256), automatic size-based promotion, and a download-URL pattern that avoids streaming through the gRPC control plane.

## Implementation Details

### New Proto Package (6 files)

| File | Key Messages/Services |
|------|----------------------|
| `api.proto` | `Artifact` resource, `ArtifactStatus` (content_hash, size_bytes, storage_state, expires_at) |
| `spec.proto` | `ArtifactSpec`, `ArtifactSource` (execution provenance), `RetentionPolicy` (ttl_days) |
| `enum.proto` | `ArtifactStorageState` (pending → stored → deleted) |
| `io.proto` | `ArtifactId`, `ArtifactList`, `CreateArtifactInput` (50MB max), `ArtifactDownloadUrl` |
| `query.proto` | `ArtifactQueryController` — get, listByExecution, getDownloadUrl |
| `command.proto` | `ArtifactCommandController` — create, delete |

### Resource Registration

Added `artifact = 55` to `ApiResourceKind` enum with prefix "art", open_source tier, org-scoped authorization.

### Execution Model Extensions

- `WorkflowEventType.artifact_created = 53` + `ArtifactCreatedPayload` in event.proto
- `repeated string artifact_ids = 11` on `WorkflowTask` in api.proto

### Design Decisions

1. **Shared bounded context** — artifacts have their own identity and lifecycle, not sub-resources
2. **No artifact_store task kind** — persistence is infrastructure, not computation
3. **Content-addressable storage** — SHA-256 for dedup and safe garbage collection
4. **Metadata in DB, blobs on object storage** — local filesystem (OSS) / S3 (Cloud)
5. **Auto-promotion at 256KB** — transparent to workflow authors

## Benefits

- Temporal history stays lean regardless of output size
- Artifacts can outlive their parent execution (independent retention)
- Content deduplication across retried tasks via SHA-256 hashing
- Download-URL pattern avoids gRPC streaming bottleneck for large blobs
- Identical API contract across OSS and Cloud editions
- SDK clients auto-generated for Go, TypeScript, Python, Java

## Impact

- **Phase 0 complete**: All foundational workflow tasks (T02-T07) are now done
- **Unblocks Phase 1**: Execution viewer (T09) can render artifact panels
- **Unblocks T13**: Backend implementation has a clear contract to implement against
- **SDK ready**: All clients generated and compiling — frontend can start building artifact UX

## Related Work

- T06: Execution Event Stream Model — artifact_created event type extends T06's event taxonomy
- T02: Structured Agent Output — artifacts externalize the large outputs that agent_call tasks produce
- T13 (future): Backend implementation of artifact repository, blob store, auto-promotion, GC

---

**Status**: ✅ Production Ready (proto contract; backend implementation in T13)
**Timeline**: ~1 hour
