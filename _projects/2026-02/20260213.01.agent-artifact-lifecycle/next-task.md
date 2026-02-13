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
**Last Session**: 2026-02-13 - Agent Runner Python Implementation completed
**Current Task**: T02 (Agent Runner Implementation)
**Status**: ✅ COMPLETED - Full Python artifact lifecycle implemented

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
| 1 | Artifact proto definitions | ✅ COMPLETED |
| 2 | Artifact storage service (R2) | Pending |
| 3 | Artifact gRPC controllers | Pending |
| 4 | Agent execution spec extension | Pending |
| 5 | Input artifact injection (Python) | Pending |
| 6 | `publish_artifact` tool (Python) | Pending |
| 7 | CLI artifact commands | Pending |
| 8 | CLI `--attach` flag for run | Pending |
| 9 | Daytona Volume integration | Pending |
| 10 | Session/Project model update | Pending |
| 11 | Lifecycle webhooks | Pending |

---

## Next Steps

### Immediate (Task 2: Agent Runner Python Implementation)
1. Implement attachment injection in agent-runner
   - Create `inject_attachments()` function in `execute_graphton.py`
   - Handle inline content vs storage_key references
   - Upload files to sandbox at mount_path using Daytona SDK

2. Implement `publish_output` tool
   - Create `backend/services/agent-runner/worker/tools/publish_output.py`
   - Handle file vs directory (ZIP for directories)
   - Upload to R2 artifact store
   - Generate signed download URLs
   - Return `ExecutionOutput` proto

3. Register tool with agent
   - Wire `publish_output` into graphton agent tools list

### Following (Task 3: CLI Implementation)
1. Add `--attach` flag to `stigmer run agent` command
2. Implement file attachment creation (inline or upload to R2)
3. Display outputs in execution result
4. Add `stigmer execution download` command

### Context for Resume
- Proto definitions are complete and linting passes
- Generated stubs are in place (Go + Python)
- All validation constraints documented in proto comments
- Field numbering follows sequential pattern (9, 15)
- Next work is Python agent-runner implementation

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
