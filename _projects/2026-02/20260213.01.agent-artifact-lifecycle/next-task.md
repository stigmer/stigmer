# Next Task: 20260213.01.agent-artifact-lifecycle

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Agent Artifact Lifecycle

**Description**: Implement production-grade artifact lifecycle for sandboxed agent execution: file inputs, file outputs, and persistent storage that survives sandbox failures.

**Goal**: Enable users to upload files to agents, download agent-created artifacts, and persist work across sandbox restarts using Daytona Volumes and R2 artifact store.

**Tech Stack**: Go, Python, gRPC, Temporal, Daytona SDK, Cloudflare R2

**Components**: agent-runner, stigmer-server, CLI, proto APIs, Daytona integration

---

## Research Foundation

This project is based on deep research. Read the research report first:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.agent-artifact-io-model/04.report.gpt.md
```

### Key Research Findings
1. **Daytona HAS download APIs**: `fs.download_file()`, `fs.download_files()`
2. **Daytona supports Volumes**: FUSE-backed persistent storage
3. **Temporal constraint**: 2MB payload limit - pass references, not bytes
4. **Best practice**: Two-layer persistence (Artifact Store + Persistent Workspace)

---

## Three Milestones

| Milestone | Description | Priority |
|-----------|-------------|----------|
| **M1: Artifact Store** | Upload/download files via R2, artifact refs in agent execution | HIGH (MVP) |
| **M2: Persistent Workspace** | Daytona Volumes for workspace that survives sandbox death | MEDIUM |
| **M3: Lifecycle Automation** | Retention policies, quotas, auto-checkpointing | LOW |

---

## The Core Problems Being Solved

```
BEFORE (Broken):
  User ──[text only]──> Agent ──[creates files]──> Sandbox (EPHEMERAL)
                                                         │
                                               Files LOST on death
                                                         
  User <──[text only]── Agent (can't get files!)

AFTER (This Project):
  User ──[files + text]──> Agent ──[creates files]──> Sandbox
    │                                                    │
    │                                          ┌─────────┘
    │                                          ▼
    │                                   Persistent Volume
    │                                          │
    │                                          ▼
    │                                    Artifact Store (R2)
    │                                          │
  User <──[files + text]── Agent <─────[downloadable artifacts]
```

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260213.01.agent-artifact-lifecycle/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-13
**Last Session**: 2026-02-13 Session 4 - Java Backend Implementation completed
**Current Task**: T07 (Java Backend / Cloud Implementation)
**Status**: ✅ COMPLETED - Full Java backend artifact lifecycle implementation for stigmer-cloud

---

## Session Progress (2026-02-13 - Session 4)

### Completed ✅
- **Task 7**: Java Backend Implementation (stigmer-cloud)
  - **Critical Bug Fix**
    - Fixed missing artifacts merge in `AgentExecutionUpdateStatusHandler.BuildNewStateWithStatusStep`
    - Mirrors the fix previously applied to Go backend
    - Ensures agent-published artifacts persist to MongoDB
  - **R2 Configuration Layer**
    - Created `AgentExecutionArtifactR2Config` with dedicated bucket configuration
    - Created `AgentExecutionArtifactR2ClientConfig` with S3Client and S3Presigner beans
    - Added Spring profile `application-agent-execution-r2.yaml`
    - Separate from skill artifacts for independent lifecycle policies
  - **R2 Store Implementation**
    - Created `AgentExecutionArtifactR2Store` with presigned URL support
    - Methods: `upload()`, `getPresignedDownloadUrl()`, `exists()`, `delete()`, `isHealthy()`
    - 7-day maximum presigned URL expiration (R2 limit)
  - **Upload Attachment Handler**
    - Implemented `AgentExecutionUploadAttachmentHandler` using pipeline pattern
    - No authorization (storage_key acts as capability token)
    - ULID-based storage keys: `attachments/{ulid}/{filename}`
    - Content type detection from filename or request
  - **Download URL Handler**
    - Implemented `AgentExecutionGetArtifactDownloadUrlHandler` with security validation
    - **Security**: Path traversal prevention - validates `storage_key` starts with `artifacts/{execution_id}/`
    - Proto-level authorization (`can_view` permission via interceptor)
    - Returns presigned URL with 7-day expiration + ISO 8601 timestamp
  - **Kustomize Configuration**
    - **Moved** R2 config from base to prod overlay (stigmer-service)
    - **Added** R2 config to agent-runner prod overlay
    - Environment-specific: `AGENT_EXECUTION_ARTIFACT_R2_BUCKET`, `_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`
  - **Python Agent Runner Updates**
    - Updated `worker/storage/__init__.py` to use specific env var naming
    - Changed from generic `R2_*` to `AGENT_EXECUTION_ARTIFACT_R2_*`
    - Consistent naming across all services

### Key Architectural Decisions
- **Separate R2 Bucket**: Agent execution artifacts use dedicated bucket (different lifecycle from skill artifacts)
- **Domain-Specific Storage**: `AgentExecutionArtifactR2Store` vs `SkillArtifactR2Store` (different semantics)
- **Environment-Based Config**: R2 configs in prod overlay, not base (endpoints/credentials are environment-specific)
- **Consistent Naming**: `AGENT_EXECUTION_ARTIFACT_R2_*` across Java, Python, and Kustomize

### Data Flow Completed
```
Java Backend (stigmer-cloud/stigmer-service):
  CLI → uploadAttachment RPC → stigmer-service → R2 → storage_key returned
  CLI → getArtifactDownloadUrl RPC → stigmer-service → presigned URL → HTTP GET download
  
Python Agent Runner (stigmer/agent-runner):
  Agent → publish_artifact tool → R2 upload → artifacts/{execution_id}/{filename}
  Agent → updateStatus RPC → artifacts[] persisted to MongoDB (via Java or Go backend)
```

### Files Created (stigmer-cloud)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/config/r2/AgentExecutionArtifactR2Config.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/config/r2/AgentExecutionArtifactR2ClientConfig.java`
- `backend/services/stigmer-service/src/main/resources/application-agent-execution-r2.yaml`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/artifact/AgentExecutionArtifactR2Store.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionUploadAttachmentHandler.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionGetArtifactDownloadUrlHandler.java`

### Files Modified
- **stigmer-cloud**: 93 files (Java stubs regenerated, handlers, configs, Kustomize)
- **stigmer**: 4 files (agent-runner Kustomize, Python storage module, next-task.md, checkpoint)

### Build Verification
- ✅ Java artifact handlers compile successfully (no errors in new code)
- ✅ Java stubs regenerated from updated protos
- ✅ Pre-existing build issues in other services (unrelated to artifact work)

---

## Session Progress (2026-02-13 - Session 3)

### Completed ✅
- **Task 3**: Go Backend Implementation
  - **Proto Renaming** (Industry Standard Alignment)
    - `ExecutionOutput` → `ExecutionArtifact`
    - `ExecutionOutputKind` → `ExecutionArtifactKind`
    - `outputs` field → `artifacts` field in `AgentExecutionStatus`
    - Storage path: `outputs/` → `artifacts/`
  - **New RPC Endpoints** (command.proto, query.proto)
    - `uploadAttachment`: CLI pre-upload for large files (>4MB)
    - `getArtifactDownloadUrl`: Generate presigned URLs for downloads
    - Comprehensive proto documentation for both endpoints
  - **Python Updates** (agent-runner)
    - Renamed `publish_output.py` → `publish_artifact.py`
    - Updated `StatusBuilder`: `add_output()` → `add_artifact()`
    - Updated storage prefix throughout: `outputs/` → `artifacts/`
  - **Go Handler Implementation**
    - Created `upload_attachment.go`: Validates input, generates ULID, uploads to `attachments/{ulid}/{filename}`
    - Created `get_artifact_download_url.go`: Security validation, presigned URL generation (7-day expiry)
    - Fixed critical bug in `update_status.go`: Added artifacts merge (was missing)
  - **Server Wiring**
    - Verified artifact storage already initialized in server.go
    - Configuration supports both local filesystem and R2
    - Health checks on startup

### Key Technical Decisions
- **Naming**: "Artifact" matches GitHub Actions and industry conventions
- **Security**: Path traversal prevention in download handler (`storage_key` must start with `artifacts/{execution_id}/`)
- **Authorization**: Upload has no auth (capability-based), download requires `can_view` permission
- **Expiration**: 7-day presigned URLs (R2 maximum)

### Data Flow Completed
```
Attachment Upload:
  CLI → uploadAttachment RPC → attachments/{ulid}/{filename} → returns storage_key

Artifact Download:
  Agent → publish_artifact tool → artifacts/{execution_id}/{filename}
  Agent → updateStatus RPC → artifacts[] in status → persisted to DB
  CLI → getArtifactDownloadUrl RPC → presigned URL → HTTP GET download
```

### Files Created
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/upload_attachment.go`
- `backend/services/stigmer-server/pkg/domain/agentexecution/controller/get_artifact_download_url.go`
- `backend/services/agent-runner/worker/tools/publish_artifact.py` (renamed from publish_output.py)
- `_changelog/2026-02/2026-02-13-132838-artifact-naming-and-cli-endpoints.md`

### Files Modified (37 total)
- 5 proto files (api, command, query, enum, io)
- 22 generated stubs (Go and Python)
- 10 source files (Python agent-runner, Go backend, config)

### Build Verification
- ✅ Go backend compiles successfully
- ✅ Python code compiles without errors
- ✅ All proto stubs regenerated

### Commit
- **SHA**: 54f80e6a
- **Message**: feat(artifact-lifecycle): rename outputs to artifacts and add CLI endpoints
- **Changes**: +3755 insertions, -333 deletions

---

## Session Progress (2026-02-13 - Session 2)

### Completed ✅
- **Task 2**: Agent Runner Python Implementation
  - **Storage Abstraction Layer** (worker/storage/)
    - Created `ArtifactStorage` protocol with dual backend support
    - `LocalArtifactStorage` for OSS/local deployments (filesystem-based)
    - `R2ArtifactStorage` for cloud deployments (Cloudflare R2 via boto3)
    - Factory function with environment-based configuration
  - **Attachment Injection** (`execute_graphton.py`)
    - Added `inject_attachments()` function supporting both inline content and storage_key
    - Handles both local filesystem and Daytona sandbox modes
    - Integrated as Step 3.5 after skill writing
  - **publish_output Tool** (worker/tools/)
    - Created LangChain-compatible StructuredTool for artifact publishing
    - Automatic ZIP creation for directories
    - Supports both local and R2 storage backends
    - Returns `ExecutionOutput` proto with download URLs
  - **Tool Registration**
    - Integrated `publish_output` as built-in tool in agent creation
    - Injected dependencies (sandbox, storage, execution_id, status_builder)
  - **StatusBuilder Output Tracking**
    - Added `add_output()` method for tracking published outputs
    - Updated `finalize_context_info()` to include outputs in final status
    - Outputs properly propagated to `AgentExecutionStatus` proto

### Key Design Decisions
- **Storage Abstraction**: Followed existing Go pattern from `workflow-runner/pkg/claimcheck/store.go`
- **Local vs R2**: Mode-based factory pattern with environment configuration
- **Tool Integration**: Used LangChain `StructuredTool` for seamless Graphton integration
- **Dependency Injection**: Tool captures sandbox, storage, and status_builder context
- **Async Support**: Proper async/await pattern for tool execution

### Files Created
- `backend/services/agent-runner/worker/storage/__init__.py` - Factory and config
- `backend/services/agent-runner/worker/storage/base.py` - Protocol definition
- `backend/services/agent-runner/worker/storage/local.py` - Local filesystem storage
- `backend/services/agent-runner/worker/storage/r2.py` - R2/S3 storage (boto3)
- `backend/services/agent-runner/worker/tools/__init__.py` - Tools package
- `backend/services/agent-runner/worker/tools/publish_output.py` - publish_output tool

### Files Modified
- `backend/services/agent-runner/worker/config.py` - Added artifact_storage config
- `backend/services/agent-runner/worker/activities/execute_graphton.py` - Attachment injection + tool registration
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` - Output tracking

---

## Previous Session Progress (2026-02-13 - Session 1)

### Completed ✅
- **Task 1**: Proto definitions for Attachments & Outputs
  - Added `ExecutionOutputKind` enum to `enum.proto`
  - Added `Attachment` message to `spec.proto` (field 9 in AgentExecutionSpec)
  - Added `ExecutionOutput` message to `api.proto` (field 15 in AgentExecutionStatus)
  - Regenerated Go and Python stubs successfully
  - All proto linting passed

---

## Implementation Order (from Plan)

| Order | Task | Status |
|-------|------|--------|
| 1 | Artifact proto definitions | ✅ COMPLETED (Session 1) |
| 2 | Agent Runner Python Implementation | ✅ COMPLETED (Session 2) |
| 3 | Go Backend Implementation | ✅ COMPLETED (Session 3) |
| 7 | Java cloud backend (stigmer-service) | ✅ COMPLETED (Session 4) |
| 4 | CLI artifact commands | 🔴 NEXT - Ready to implement |
| 5 | CLI `--attach` flag for run | Pending |
| 6 | Integration testing | Pending |
| 8 | Daytona Volume integration | Future (M2) |
| 9 | Lifecycle webhooks | Future (M3) |

---

## Next Steps

### Immediate (Task 4: CLI Implementation)

Ready to implement CLI commands using the completed backend:

1. **Implement `stigmer execution upload` command**
   - Call `uploadAttachment` RPC with file contents
   - Handle large files (>4MB)
   - Display returned storage_key

2. **Add `--attach` flag to `stigmer run agent`**
   - Parse file paths from CLI
   - Pre-upload large files using `uploadAttachment`
   - Create `Attachment` messages with storage_keys
   - Include attachments in `AgentExecutionSpec`

3. **Implement `stigmer execution artifacts` command**
   - List artifacts from execution status
   - Show artifact metadata (name, size, kind, created_at)

4. **Implement `stigmer execution download` command**
   - Call `getArtifactDownloadUrl` RPC
   - Download artifact using presigned URL
   - Save to local filesystem

### Following (Task 5: Integration Testing)
1. End-to-end test: CLI upload → Agent execution → CLI download
2. Test large file handling (>4MB)
3. Test directory artifacts (ZIP handling)
4. Test presigned URL expiration and refresh
5. Test security validation (path traversal prevention)

### Context for Resume
- **Backend Complete**: All backends implemented (Go OSS, Java Cloud, Python Agent Runner)
- **Proto Complete**: All types renamed to "artifact" terminology, stubs regenerated
- **Storage Ready**: Both local filesystem and R2 backends functional in all services
- **Security**: Path traversal prevention and authorization in place
- **Configuration**: R2 configs moved to prod overlays (environment-specific)
- **Next Work**: CLI implementation to consume the backend endpoints

### Important Notes for CLI Implementation
- Use `uploadAttachment` RPC for files >4MB (returns `storage_key`)
- For small files (<4MB), can use inline `content` in `Attachment`
- Download flow: Get execution → Extract `storage_key` → Call `getArtifactDownloadUrl` → HTTP GET
- Presigned URLs expire after 7 days (configurable)

---

## Quick Commands

After loading context:
- "Review the plan" - Look at T01_0_plan.md
- "Approve plan and start" - Begin implementation
- "I have feedback on the plan" - Provide changes
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
