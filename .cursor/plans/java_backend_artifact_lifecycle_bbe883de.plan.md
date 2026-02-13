---
name: Java Backend Artifact Lifecycle
overview: Implement agent execution artifact upload/download functionality in the Java backend (stigmer-service), mirroring the Go backend implementation with a separate R2 bucket and domain-specific storage.
todos:
  - id: regenerate-java-stubs
    content: Regenerate Java stubs from updated protos (make java-stubs)
    status: completed
  - id: fix-artifacts-merge
    content: "Fix critical bug: Add artifacts merge in AgentExecutionUpdateStatusHandler.BuildNewStateWithStatusStep"
    status: completed
  - id: r2-config
    content: Create AgentExecutionArtifactR2Config and R2ClientConfig with S3Presigner bean
    status: completed
  - id: r2-store
    content: Implement AgentExecutionArtifactR2Store with upload() and getPresignedDownloadUrl()
    status: completed
  - id: upload-handler
    content: Implement AgentExecutionUploadAttachmentHandler (no auth, ULID key generation)
    status: completed
  - id: download-handler
    content: Implement AgentExecutionGetArtifactDownloadUrlHandler (can_view auth, path validation)
    status: completed
  - id: kustomize-config
    content: Add AGENT_EXECUTION_ARTIFACT_R2_* environment variables to Kustomize
    status: completed
  - id: build-verify
    content: Verify Bazel build succeeds and all handlers compile
    status: completed
isProject: false
---

# Java Backend Artifact Lifecycle Implementation

## Context

The Go backend (stigmer-server) has completed artifact lifecycle implementation. The Java backend (stigmer-service) needs equivalent functionality to support cloud deployments. Proto definitions already exist in stigmer/stigmer - Java stubs need regeneration.

## Architecture Decisions

- **Separate R2 bucket**: `AGENT_EXECUTION_ARTIFACT_R2_*` configuration, isolated from skill artifacts
- **Domain-specific store**: `AgentExecutionArtifactR2Store` with presigned URL support (different from `SkillArtifactR2Store`)

## Prerequisites

Before implementation, regenerate Java stubs to get the new proto types:

```bash
cd stigmer-cloud/apis && make java-stubs
```

This generates `UploadAttachmentRequest`, `UploadAttachmentResponse`, `GetArtifactDownloadUrlRequest`, `GetArtifactDownloadUrlResponse`, and `ExecutionArtifact` in Java.

---

## Phase 1: Critical Bug Fix - Artifacts Merge

**Problem**: [AgentExecutionUpdateStatusHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionUpdateStatusHandler.java) `BuildNewStateWithStatusStep` merges messages, tool_calls, todos, but NOT artifacts.

**Impact**: Agents can publish artifacts via `publish_artifact` tool, but they're never persisted to MongoDB.

**Fix**: Add artifacts merge in `BuildNewStateWithStatusStep.execute()` (around line 230):

```java
// Merge artifacts (replace with latest from request)
if (requestStatus.getArtifactsCount() > 0) {
    statusBuilder.clearArtifacts()
            .addAllArtifacts(requestStatus.getArtifactsList());
}
```

---

## Phase 2: R2 Configuration

Create configuration for agent execution artifact storage:

**New files:**

- `config/r2/AgentExecutionArtifactR2Config.java` - Configuration properties
- `config/r2/AgentExecutionArtifactR2ClientConfig.java` - S3Client and S3Presigner beans
- `resources/application-agent-execution-r2.yaml` - Spring config

**Environment variables:**

- `AGENT_EXECUTION_ARTIFACT_R2_BUCKET`
- `AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT`
- `AGENT_EXECUTION_ARTIFACT_R2_REGION`
- `AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID`
- `AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY`

**Key difference from skill artifacts**: Need `S3Presigner` bean for generating presigned download URLs (skill artifacts use direct gRPC download).

---

## Phase 3: R2 Store Implementation

Create `AgentExecutionArtifactR2Store` in `domain/agentic/agentexecution/artifact/`:

**Methods:**

- `upload(String key, byte[] content, String contentType)` - Upload artifact
- `getPresignedDownloadUrl(String key, Duration expiresIn)` - Generate presigned URL (max 7 days for R2)
- `exists(String key)` - Check existence
- `delete(String key)` - Delete artifact

**Key implementation details:**

- Use `S3Presigner.presignGetObject()` with expiration duration
- R2 maximum expiration: 7 days (604,800 seconds)
- Content type detection from filename extension

---

## Phase 4: Upload Attachment Handler

Create `AgentExecutionUploadAttachmentHandler` in `domain/agentic/agentexecution/request/handler/`:

**Pipeline steps:**

1. `ValidateFieldConstraints` - filename required, content required
2. `GenerateStorageKey` - Generate ULID, build key: `attachments/{ulid}/{filename}`
3. `DetectContentType` - From request or filename extension
4. `UploadToR2` - Upload with timeout
5. `BuildResponse` - Return storage_key

**Authorization**: Skip (storage_key acts as capability token)

**Reference**: Go implementation at [upload_attachment.go](backend/services/stigmer-server/pkg/domain/agentexecution/controller/upload_attachment.go)

---

## Phase 5: Get Artifact Download URL Handler

Create `AgentExecutionGetArtifactDownloadUrlHandler` in `domain/agentic/agentexecution/request/handler/`:

**Pipeline steps:**

1. `ValidateFieldConstraints` - execution_id required, storage_key required
2. `ValidateStorageKeyPrefix` - **Security critical**: Must start with `artifacts/{execution_id}/`
3. `LoadExecution` - Verify execution exists
4. `Authorize` - Check `can_view` permission (via proto annotation)
5. `GeneratePresignedUrl` - 7-day expiration
6. `BuildResponse` - Return download_url and expires_at (ISO 8601)

**Security**: Path traversal prevention - reject storage_keys that don't match expected prefix.

**Reference**: Go implementation at [get_artifact_download_url.go](backend/services/stigmer-server/pkg/domain/agentexecution/controller/get_artifact_download_url.go)

---

## Phase 6: Wiring and Configuration

**BUILD.bazel** - Already has AWS SDK dependencies (used by skill artifacts)

**Kustomize** - Add new environment variables to [_kustomize/base/service.yaml](backend/services/stigmer-service/_kustomize/base/service.yaml)

**Spring profiles** - Add `agent-execution-r2` profile include

---

## File Summary

**New files (8):**

- `config/r2/AgentExecutionArtifactR2Config.java`
- `config/r2/AgentExecutionArtifactR2ClientConfig.java`
- `resources/application-agent-execution-r2.yaml`
- `domain/agentic/agentexecution/artifact/AgentExecutionArtifactR2Store.java`
- `domain/agentic/agentexecution/request/handler/AgentExecutionUploadAttachmentHandler.java`
- `domain/agentic/agentexecution/request/handler/AgentExecutionGetArtifactDownloadUrlHandler.java`

**Modified files (2):**

- `AgentExecutionUpdateStatusHandler.java` - Add artifacts merge
- `_kustomize/base/service.yaml` - Add R2 env vars

---

## Data Flow

```
Upload Flow (CLI → Storage):
  CLI → uploadAttachment RPC → stigmer-service → R2 → storage_key returned

Download Flow (Storage → CLI):
  CLI → getArtifactDownloadUrl RPC → stigmer-service
    → validate path prefix (security)
    → authorize (can_view)
    → generate presigned URL
  CLI → HTTP GET presigned URL → R2 → file downloaded

Agent Publish Flow:
  Python agent → publish_artifact tool → R2 (artifacts/{exec_id}/{name})
  Python agent → updateStatus RPC → stigmer-service
    → merge artifacts into status (Phase 1 fix)
    → persist to MongoDB
```

---

## Testing Strategy

1. **Unit tests**: Mock R2Store, verify handler logic
2. **Integration tests**: Verify presigned URL generation with real R2
3. **Security tests**: Path traversal attempts rejected
4. **Build verification**: `bazel build //backend/services/stigmer-service:stigmer_service_lib`

---

## Constants (matching Go backend)

- `DEFAULT_URL_EXPIRATION = Duration.ofDays(7)` (R2 maximum)
- `UPLOAD_TIMEOUT = Duration.ofSeconds(60)`
- `PRESIGN_TIMEOUT = Duration.ofSeconds(30)`
- Attachment prefix: `attachments/{ulid}/{filename}`
- Artifact prefix: `artifacts/{execution_id}/{filename}`

