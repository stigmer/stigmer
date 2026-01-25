# Next Task: 20260125.01.skill-api-enhancement

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260125.01.skill-api-enhancement

**Description**: Enhance Skill API with proper versioning, proto definitions, and support for both local daemon and cloud storage (CloudFlare bucket). Remove inline skill feature.
**Goal**: Implement a proper Skill API resource following Stigmer standards, with version support in ApiResourceReference, CLI detection in stigmer apply, and unified backend for local/cloud deployments
**Tech Stack**: Protobuf, Go (CLI), Java (Backend), Temporal (Orchestration)
**Components**: apis/ (proto definitions), client-apps/cli/ (Go CLI), backend/ (Java handlers), Agent integration

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260125.01.skill-api-enhancement/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-25 12:14
**Current Task**: T01.6 Artifact Download & Extraction ✅
**Status**: Artifact Download & Extraction Complete
**Last Session**: 2026-01-25 - Artifact Download & Extraction Implementation
**Last Completed**: Complete artifact download pipeline (proto → Java → Python) ✅ 2026-01-25

## Session Progress (2026-01-25 - Latest Session)

### What Was Accomplished - Artifact Download & Extraction

**Complete implementation of artifact download and extraction pipeline following ADR 001**

**1. Proto Definitions (stigmer OSS):**
- Added `GetArtifactRequest` message with `artifact_storage_key` field
- Added `GetArtifactResponse` message with `artifact` bytes field
- Added `getArtifact` RPC to SkillQueryController
- Regenerated all proto stubs (Java, Python, Go, TypeScript, Dart)

**2. Java Backend Handler (stigmer-cloud):**
- Created `SkillGetArtifactHandler.java`
- Downloads artifacts from R2 using `SkillArtifactR2Store`
- Returns ZIP bytes via gRPC
- Proper error handling (NOT_FOUND, INTERNAL)

**3. Python gRPC Client (stigmer OSS):**
- Added `get_artifact()` method to `SkillClient`
- Downloads ZIP files from backend
- Error handling and logging

**4. Skill Writer Enhancement (stigmer OSS):**
- Updated `SkillWriter.write_skills()` to accept optional `artifacts` parameter
- Added `_extract_artifact_local()` - extracts ZIP to local filesystem
- Added `_extract_artifact_daytona()` - extracts ZIP in Daytona sandbox
- Makes scripts executable (`.sh`, `.py`, `.js`, `.ts`, `.rb`, `.pl`)
- Backward compatible - works with or without artifacts

**5. Execute Graphton Integration (stigmer OSS):**
- Downloads artifacts for skills with `artifact_storage_key`
- Passes artifacts to `skill_writer.write_skills()`
- Graceful fallback to SKILL.md-only if download fails

**Architecture Flow:**
```
Agent Execution → Fetch Skills → Download Artifacts (if key exists) 
→ Extract to /bin/skills/{hash}/ → Inject SKILL.md into prompt
```

### Files Modified

**stigmer OSS repo (13 files):**
```
apis/ai/stigmer/agentic/skill/v1/
├── io.proto                         # +13 lines (new messages)
└── query.proto                      # +11 lines (new RPC)
apis/stubs/                          # Auto-generated (all languages)
backend/services/agent-runner/
├── grpc_client/skill_client.py      # +44 lines (get_artifact)
├── worker/activities/
    ├── execute_graphton.py          # +28 lines (download artifacts)
    └── graphton/skill_writer.py     # +140 lines (extraction logic)
```

**stigmer-cloud repo (new file + stubs):**
```
backend/services/stigmer-service/src/main/java/
└── ai/stigmer/domain/agentic/skill/request/handler/
    └── SkillGetArtifactHandler.java # +113 lines (new handler)
apis/stubs/                          # Auto-generated (all languages)
```

### Previous Sessions Summary

**Session 1 - Python Agent-Runner Skill Injection:**
- skill_writer.py complete rewrite per ADR 001
- execute_graphton.py skill handling for both modes
- Full SKILL.md injection into system prompt

**Session 2 - Java R2 Storage & Audit:**
- R2 storage configuration and credentials
- SkillArtifactR2Store.java - R2 operations
- SkillAuditRepo.java - version history
- SkillPushHandler.java and SkillGetByReferenceHandler.java

### Previous Session - Java R2 Storage & Audit

**R2 Storage Configuration:**
- Created `stigmer-service-r2-config.yaml` (variables group)
- Created `stigmer-service-r2-credentials.yaml` (secrets group with placeholders)
- Added AWS SDK v2 to MODULE.bazel and BUILD.bazel

**Java Implementation (stigmer-cloud):**
- `SkillArtifactR2Store.java` - R2 storage operations
- `SkillAuditRepo.java` - MongoDB repository for skill version history
- `SkillPushHandler.java` - Complete push operation handler
- `SkillGetByReferenceHandler.java` - Version resolution (main + audit)

## Pending User Actions

Before testing:

1. **Create R2 Bucket**: `stigmer-prod-skills-r2-bucket` in Cloudflare
2. **Create R2 API Token**: Generate token with read/write access
3. **Update Secrets**: Replace placeholders in `stigmer-service-r2-credentials.yaml`

## Next Steps (when resuming)

1. ✅ ~~**Artifact Download & Extraction**~~ - COMPLETED
2. **Unit Tests**: Add tests for skill_writer.py, SkillClient.get_artifact(), SkillGetArtifactHandler
3. **Integration Test**: End-to-end test of skill push → download → extract → inject flow
4. **MongoDB Migration**: Add indices to `skill_audit` collection
5. **CLI Enhancement**: Add `stigmer skill push` command
6. **Documentation**: Update agent-runner docs with complete skill architecture

## Context for Resume

- **Artifact download & extraction COMPLETE**: Full pipeline implemented per ADR 001
- **Skill injection complete**: Full SKILL.md content injected into prompts
- **Both local and cloud modes supported**: Works with filesystem and Daytona
- **Graceful degradation**: Falls back to SKILL.md-only if artifact download fails
- **Backward compatible**: Works with skills that don't have artifacts
- **R2 bucket not yet created**: Placeholders in stigmer-cloud secrets (pending user action)
- **No unit tests yet**: Added to next steps

## What's Complete (ADR 001)

Per ADR 001, the complete skill injection and mounting architecture is now implemented:
1. ✅ SKILL.md injection into system prompt with LOCATION headers
2. ✅ Artifact download from R2/storage via gRPC
3. ✅ ZIP extraction to `/bin/skills/{version_hash}/`
4. ✅ Executable permissions for scripts
5. ✅ Both local filesystem and Daytona sandbox support

## Uncommitted Changes

**stigmer OSS repo (13 files modified):**
- `apis/ai/stigmer/agentic/skill/v1/io.proto` - GetArtifact messages
- `apis/ai/stigmer/agentic/skill/v1/query.proto` - getArtifact RPC
- `apis/stubs/` - Proto stubs (auto-generated)
- `backend/services/agent-runner/grpc_client/skill_client.py` - get_artifact()
- `backend/services/agent-runner/worker/activities/execute_graphton.py` - artifact download
- `backend/services/agent-runner/worker/activities/graphton/skill_writer.py` - extraction
- `_projects/2026-01/20260125.01.skill-api-enhancement/next-task.md` - this file

**stigmer-cloud repo (new file + stubs):**
- `backend/services/stigmer-service/.../SkillGetArtifactHandler.java` - NEW handler
- `apis/stubs/` - Proto stubs (auto-generated)

## Architecture Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                      PUSH SKILL FLOW                             │
├──────────────────────────────────────────────────────────────────┤
│ 1. Client sends PushSkillRequest (name, artifact zip, tag, org) │
│ 2. Extract SKILL.md from zip                                     │
│ 3. Calculate SHA256 hash of artifact                             │
│ 4. Upload to R2: skills/{org}/{slug}/{hash}.zip (deduplicated)  │
│ 5. If exists → Archive current version to skill_audit           │
│ 6. Upsert to skill collection (main)                            │
│ 7. Create IAM policies (if new)                                 │
│ 8. Return Skill resource                                         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                   GET BY REFERENCE FLOW                          │
├──────────────────────────────────────────────────────────────────┤
│ 1. Client sends ApiResourceReference (slug, org, version)       │
│ 2. If version empty/"latest" → Query skill collection (main)    │
│ 3. If version is hash → Check main, then skill_audit            │
│ 4. If version is tag → Check main, then skill_audit (most recent)│
│ 5. Return matched Skill                                          │
└──────────────────────────────────────────────────────────────────┘
```

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
