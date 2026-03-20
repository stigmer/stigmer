# Implement `getArtifactContent` Backend Handlers (Go + Java)

**Date**: March 20, 2026

## Summary

Implemented the `getArtifactContent` RPC handler in both the stigmer OSS Go backend and the stigmer-cloud Java backend. This completes the server-side infrastructure for the artifact content reading API defined in Session 13, enabling the `useArtifactContent` React hook to function end-to-end. The Go handler works with both local filesystem and R2 storage backends; the Java handler uses range-limited R2 reads to avoid loading large artifacts into memory.

## Problem Statement

Session 13 defined the `getArtifactContent` proto RPC and built the frontend consumers (TS SDK client method `getArtifactContent`, React hook `useArtifactContent`), but both backends returned `Unimplemented`. Without the server-side handlers, the entire artifact content pipeline — YAML parsing, Stigmer resource detection, and the Apply-to-org flow — was blocked.

### Pain Points

- `useArtifactContent` hook had no backend to call — every invocation failed with `Unimplemented`
- Artifact content reading was a prerequisite for T02.2 (`useDetectStigmerResource`) and the rest of Phase 2
- The OSS Go backend needed a handler that works with `LocalStorage` (development) and `R2Storage` (production)
- The Java cloud backend had no method for reading raw artifact bytes from R2

## Solution

Implemented matching handlers in both backends following their respective established patterns:

- **Go handler** (`stigmer`): Direct method on `AgentExecutionController`, following the `GetArtifactDownloadUrl` pattern. Uses the existing `ArtifactStorage.Download()` interface which works transparently with both local and R2 storage.
- **Java handler** (`stigmer-cloud`): Pipeline-based handler following the `AgentExecutionGetArtifactDownloadUrlHandler` pattern. Added a range-read `get()` method to `AgentExecutionArtifactR2Store` using S3 `HEAD` + `Range`-limited `GET` to avoid loading arbitrarily large objects into memory.

## Implementation Details

### Go Backend (stigmer OSS)

**New file**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/get_artifact_content.go`

- Validates `execution_id` and `storage_key` (non-empty, prefix check for path traversal prevention)
- Verifies execution exists via `c.store.GetResource()`
- Downloads content via `c.artifactStorage.Download()` with a 30-second timeout
- Applies `max_bytes` truncation (default 512 KB) and sets `truncated` flag
- Detects content type via a `knownContentTypes` map (17 artifact-relevant extensions) with `mime.TypeByExtension()` fallback
- Returns `GetArtifactContentResponse` with `content`, `content_type`, `total_size_bytes`, `truncated`

### Java Backend (stigmer-cloud)

**Modified file**: `AgentExecutionArtifactR2Store.java`

- Added `get(String key, long maxBytes)` method returning `Optional<GetResult>`
- Uses S3 `HEAD` to read total size, then `Range`-limited `GET` (`bytes=0-{maxBytes-1}`) when content exceeds the limit
- Returns `GetResult` record containing `content` (byte array) and `totalSizeBytes` (for truncation detection)
- Returns `Optional.empty()` for missing keys (consistent with `SkillArtifactR2Store.get()`)

**New file**: `AgentExecutionGetArtifactContentHandler.java`

- Pipeline: `validateFieldConstraints` → `authorize` → `ValidateStorageKeyPrefixStep` → `LoadArtifactContentStep` → `sendResponse`
- `ValidateStorageKeyPrefixStep`: duplicated (not shared) from the download URL handler because the pipeline framework's generic typing prevents sharing steps across handlers with different request/response types
- `LoadArtifactContentStep`: downloads via `r2Store.get()`, applies truncation, detects content type via a `KNOWN_CONTENT_TYPES` map kept in sync with the Go backend
- Content type detection: identical extension-to-MIME mapping in both backends (17 entries)

### Content Type Detection

Both backends share an identical mapping for artifact-relevant file types:

| Extension | MIME Type |
|-----------|-----------|
| `.yaml`, `.yml` | `text/yaml` |
| `.json` | `application/json` |
| `.md` | `text/markdown` |
| `.txt` | `text/plain` |
| `.zip` | `application/zip` |
| `.py` | `text/x-python` |
| `.go` | `text/x-go` |
| `.ts` | `text/typescript` |
| (+ 9 more) | ... |

Go supplements with `mime.TypeByExtension()` as fallback; Java uses the map exclusively. Both default to `application/octet-stream` for unknown extensions.

## Benefits

- **Unblocks Phase 2**: `useArtifactContent` hook now has a working backend, enabling T02.2 (`useDetectStigmerResource`) and the rest of the Execution Artifacts Widget
- **Works locally**: OSS developers running stigmer-server with `ARTIFACT_STORAGE_TYPE=local` get artifact content served from the filesystem — no R2 required for development
- **Memory-safe**: Java handler uses range-limited reads, so a 100 MB artifact only loads 512 KB into memory
- **Consistent security**: Both handlers enforce the same path-traversal prevention (storage key must start with `artifacts/{execution_id}/`)

## Impact

- **SDK consumers**: `useArtifactContent` hook now works end-to-end
- **Platform builders**: Can read artifact content programmatically via `stigmer.agentExecution.getArtifactContent()` without CORS concerns
- **OSS users**: Local development setup fully supports artifact content reading
- **Cloud deployment**: Production-ready with range-limited R2 reads

## Related Work

- [Execution artifact data hooks and getArtifactContent RPC](2026-03-20-144924-execution-artifact-data-hooks-and-rpc.md) — Session 13 (proto + frontend)
- Phase 2 tasks T02.2–T02.8 in `_projects/2026-03/20260320.01.library-and-artifacts-flow/`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
