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
**Current Task**: T01.5 Python Agent-Runner Skill Injection ✅
**Status**: Agent-Runner Skill Injection Complete
**Last Session**: 2026-01-25 - Python Agent-Runner Skill Injection (ADR 001)
**Last Completed**: Agent-Runner skill_writer.py + execute_graphton.py updates ✅ 2026-01-25

## Session Progress (2026-01-25 - Latest Session)

### What Was Accomplished - Python Agent-Runner Skill Injection

**Following ADR 001: Skill Injection & Sandbox Mounting Strategy**

**skill_writer.py - Complete Rewrite:**
- Fixed proto field names (`skill.spec.skill_md` instead of non-existent `markdown_content`)
- Changed skills path to `/bin/skills/{version_hash}/` per ADR
- Implemented full SKILL.md injection into system prompt with LOCATION header
- Added local mode support (filesystem backend)
- Added cloud mode support (Daytona sandbox)

**execute_graphton.py - Updated Skill Handling:**
- Local mode: Writes skills to `{local_root}/bin/skills/{version_hash}/`
- Cloud mode: Uploads to Daytona sandbox at `/bin/skills/{version_hash}/`
- Both modes inject full skill content into system prompt

**System Prompt Format (per ADR):**
```text
### SKILL: calculator
LOCATION: /bin/skills/abc123def456.../

(Full content of SKILL.md here...)
```

**Key Design Decisions:**
- Version hash as directory name (`skill.status.version_hash`)
- Full content injection - SKILL.md in prompt so agents know how to use tools
- LOCATION header tells agents where executable files are located

### Files Modified (stigmer OSS repo)

```
backend/services/agent-runner/worker/activities/
├── execute_graphton.py      # Updated skill handling for both modes
└── graphton/
    └── skill_writer.py      # Complete rewrite per ADR 001
```

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

1. **Artifact Download & Extraction**: Implement ZIP download from R2/storage and extraction to `/bin/skills/{hash}/`
2. **Unit Tests**: Add tests for skill_writer.py, SkillAuditRepo, SkillArtifactR2Store
3. **Integration Test**: End-to-end test of skill push → resolve → inject flow
4. **MongoDB Migration**: Add indices to `skill_audit` collection
5. **Documentation**: Update agent-runner docs with skill injection architecture

## Context for Resume

- **Skill injection complete**: Full SKILL.md content now injected into prompts
- **Artifact extraction NOT implemented**: Only writes SKILL.md, not ZIP artifact extraction
- **Both local and cloud modes supported**: SkillWriter handles both
- **R2 bucket not yet created**: Placeholders in stigmer-cloud secrets
- **No unit tests yet**: Added to next steps

## What's NOT Yet Implemented

Per ADR 001, artifact mounting (downloading ZIP and extracting to `/bin/skills/{hash}/`) is not yet implemented. Current implementation only writes SKILL.md content. If skills have executable implementations (scripts, binaries), those would need:
1. Download artifact from R2/storage using `skill.status.artifact_storage_key`
2. Extract ZIP to `/bin/skills/{version_hash}/`

## Uncommitted Changes

**stigmer OSS repo (3 files):**
- `backend/services/agent-runner/worker/activities/execute_graphton.py`
- `backend/services/agent-runner/worker/activities/graphton/skill_writer.py`
- `_projects/2026-01/20260125.01.skill-api-enhancement/next-task.md`

**stigmer-cloud repo:**
- Previous session changes (Java R2 + Audit) - already committed

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
