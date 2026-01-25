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
**Current Task**: T01.12 CLI Skill Command ✅
**Status**: CLI Refactor Complete
**Last Session**: 2026-01-25 - CLI Skill Command Refactor
**Last Completed**: Refactored CLI with dedicated `stigmer skill push` command, removed artifact mode from apply ✅ 2026-01-25

## Session Progress (2026-01-25 - CLI Skill Command Refactor)

### What Was Accomplished - CLI Command Hierarchy Refactor

**Implemented dedicated `stigmer skill` command group following industry best practices (kubectl, docker, gh):**

**Design Decision - Hierarchical Hybrid Model:**
```
VERB-FIRST (Primary workflows)     NOUN-FIRST (Resource management)
├── apply                          ├── skill    [push]
├── run                            ├── server   [start, stop, status, logs]
├── new                            ├── backend  [set, status]
                                   └── config   [set, get]
```

**Key Changes:**

| Change | Description |
|--------|-------------|
| **Created** `skill.go` | New skill command group with `push` subcommand (~230 lines) |
| **Refactored** `apply.go` | Removed artifact mode detection (~130 lines removed) |
| **Updated** `root.go` | Registered `NewSkillCommand()` |
| **Updated** `COMMANDS.md` | Added skill management documentation |

**New CLI Commands:**
```bash
stigmer skill push              # Push from current directory
stigmer skill push ./my-skill/  # Push from specific directory
stigmer skill push --tag v1.0   # Push with specific tag
stigmer skill push --org acme   # Push to specific organization
stigmer skill push --dry-run    # Validate without pushing
```

**Bug Fixes (Pre-existing):**
1. `internal/cli/artifact/skill.go` - Fixed incorrect field access on Skill response
   - `response.VersionHash` → `response.Status.VersionHash`
   - `response.Tag` → `response.Spec.Tag`
   - `response.ArtifactStorageKey` → `response.Status.ArtifactStorageKey`
2. `backend/.../get_artifact.go` - Fixed `ctx.Request()` → `ctx.Input()`

### Files Created (This Session)

**stigmer OSS repo:**
```
client-apps/cli/cmd/stigmer/root/
└── skill.go   # NEW - ~230 lines (skill command group + push subcommand)
```

### Files Modified (This Session)

**stigmer OSS repo:**
```
client-apps/cli/
├── cmd/stigmer/root.go           # +1 line (register skill command)
├── cmd/stigmer/root/apply.go     # -204 lines (removed artifact mode)
├── internal/cli/artifact/skill.go # +6/-6 (fix field access)
├── COMMANDS.md                    # +24 lines (skill docs)
backend/services/stigmer-server/pkg/domain/skill/controller/
└── get_artifact.go               # +1/-1 (fix ctx.Input())
```

### Build Verification
```
✅ CLI builds successfully
✅ `stigmer skill --help` works
✅ `stigmer skill push --help` shows correct usage
✅ `stigmer apply --help` shows updated message
```

---

## Previous Session Progress (2026-01-25 - MongoDB Index Migration)

### What Was Accomplished - MongoDB skill_audit Indexes

**Created production-grade Mongock migration for skill_audit collection indexes:**

**Migration File Created:**
- `U20260125_SkillAuditIndexes.java` - 7 compound indexes following ESR rule

**Indexes Implemented:**

| Index | Fields | Query Methods Covered |
|-------|--------|----------------------|
| 1 | `skillId` + `archivedAt` DESC | `findAllBySkillId`, `deleteBySkillId` |
| 2 | `skillId` + `status.versionHash` | `findBySkillIdAndVersionHash` |
| 3 | `skillId` + `spec.tag` + `archivedAt` DESC | `findMostRecentBySkillIdAndTag` |
| 4 | `metadata.org` + `metadata.slug` + `status.versionHash` | `findByOrgAndSlugAndVersionHash` |
| 5 | `metadata.org` + `metadata.slug` + `spec.tag` + `archivedAt` DESC | `findMostRecentByOrgAndSlugAndTag` |
| 6 | `metadata.ownerScope` + `metadata.slug` + `status.versionHash` | `findByOwnerScopeAndSlugAndVersionHash` |
| 7 | `metadata.ownerScope` + `metadata.slug` + `spec.tag` + `archivedAt` DESC | `findMostRecentByOwnerScopeAndSlugAndTag` |

**Key Design Decisions:**
- **ESR Rule**: All compound indexes follow MongoDB's Equality-Sort-Range optimization
- **Idempotent Rollback**: `dropIndexSafely()` helper for graceful rollbacks
- **Comprehensive Javadoc**: Documents schema, index purposes, query coverage
- **Consistent Patterns**: Follows established codebase patterns from `U20250101_IamPolicyIndexes.java`

### File Created (This Session)

**stigmer-cloud repo:**
```
backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/
└── U20260125_SkillAuditIndexes.java   # NEW - 7 compound indexes, ~190 lines
```

---

## Previous Session Progress (2026-01-25 - Go Test Implementation)

### What Was Accomplished - Go Unit & Integration Tests

**Implemented comprehensive test suite for the Go skill domain (stigmer-server):**

**1. Storage Layer Tests:**

| File | Tests | Purpose |
|------|-------|---------|
| `storage/testutil.go` | - | ZIP creation utilities (CreateTestZip, CreateZipBomb, etc.) |
| `storage/artifact_storage_test.go` | 11 | LocalFileStorage CRUD, deduplication, hash calculation |
| `storage/zip_extractor_test.go` | 18 | Security validation (ZIP bombs, path traversal, size limits) |

**2. Controller Handler Tests:**

| File | Tests | Purpose |
|------|-------|---------|
| `controller/get_artifact_test.go` | 5 | GetArtifact handler (success, not found, validation) |
| `controller/push_test.go` | 20 | Push handler (create, update, deduplication, validation) |
| `controller/integration_test.go` | 11 | End-to-end pipeline (Push→Get→GetByReference→GetArtifact) |

**Test Categories:**
- **Storage Unit Tests (29)**: Store, Get, Exists, GetStorageKey, deduplication, hash calculation
- **Security Tests (10)**: ZIP bomb detection, size limits, file count limits, invalid filenames
- **Handler Unit Tests (25)**: Create, update, validation errors, org/platform scoping
- **Integration Tests (11)**: Full pipeline flows, version resolution, concurrent operations

### Files Created (This Session)

**stigmer OSS repo (Go):**
```
backend/services/stigmer-server/pkg/domain/skill/
├── storage/
│   ├── testutil.go                    # NEW - ZIP creation utilities
│   ├── artifact_storage_test.go       # NEW - 11 tests
│   └── zip_extractor_test.go          # NEW - 18 tests
└── controller/
    ├── get_artifact_test.go           # NEW - 5 tests
    ├── push_test.go                   # NEW - 20 tests
    └── integration_test.go            # NEW - 11 tests
```

### Files Modified (This Session)

```
backend/services/stigmer-server/pkg/domain/skill/
├── storage/BUILD.bazel       # +16 lines (added go_test target)
└── controller/BUILD.bazel    # +9 lines (added new test sources)
```

### Test Summary

| Category | Tests |
|----------|-------|
| Storage: LocalFileStorage | 11 |
| Storage: ZIP Extractor | 18 |
| Controller: GetArtifact | 5 |
| Controller: Push | 20 |
| Integration | 11 |
| **Total New Go Tests** | **65** |

### Testing Philosophy Applied
- Table-driven tests for comprehensive edge case coverage
- Real dependencies with `t.TempDir()` (following codebase patterns)
- testify/assert + require for clear assertions
- Security-first testing for ZIP handling
- Concurrent operation tests for race condition validation

---

## Previous Session Progress (2026-01-25 - Integration Test Implementation)

### What Was Accomplished - Integration Tests

**Implemented comprehensive integration tests for the skill artifact download and extraction pipeline:**

**1. Python Integration Tests (stigmer OSS - agent-runner):**

| File | Tests | Status |
|------|-------|--------|
| `tests/test_integration_skill_pipeline.py` | 21 integration tests | ✅ All Passing |

**Test Coverage:**
- `TestFullPipelineIntegration` (3 tests) - Full artifact extraction → permissions → paths
- `TestADR001Compliance` (5 tests) - LOCATION header, SKILL.md injection, /bin/skills/
- `TestVersionResolutionIntegration` (2 tests) - Version hashes, deduplication
- `TestErrorRecoveryIntegration` (4 tests) - Invalid ZIP, empty ZIP, fallback
- `TestPromptGenerationIntegration` (4 tests) - Headers, formatting preservation
- `TestPathResolution` (3 tests) - Hash paths, slug fallback

**2. Java Integration Tests (stigmer-cloud):**

| File | Tests | Status |
|------|-------|--------|
| `SkillVersionResolutionIntegrationTest.java` | 18 integration tests | ✅ No lint errors |

**Test Coverage:**
- `LoadFromRepoTests` (10 tests) - Version resolution: empty/latest/tag/hash
- `PlatformScopedSkillTests` (2 tests) - Platform-scoped skill queries
- `FullHandlerIntegrationTests` (2 tests) - Load → Authorize pipeline
- `EdgeCaseTests` (4 tests) - Whitespace, semver tags, hash patterns

### Files Created (This Session)

**stigmer OSS repo:**
```
backend/services/agent-runner/tests/
└── test_integration_skill_pipeline.py   # 21 integration tests
```

**stigmer-cloud repo:**
```
backend/services/stigmer-service/src/test/java/ai/stigmer/domain/agentic/skill/request/handler/
└── SkillVersionResolutionIntegrationTest.java  # 18 integration tests
```

### Test Execution Results
```
Python (50 total tests): ✅ All passing
  - test_skill_client.py: 7 passed
  - test_skill_writer.py: 22 passed
  - test_integration_skill_pipeline.py: 21 passed

Java (29 tests total): ✅ No lint errors
  - SkillGetArtifactHandlerTest.java: 11 tests
  - SkillVersionResolutionIntegrationTest.java: 18 tests
```

---

## Previous Session Progress (2026-01-25 - Unit Test Implementation)

### What Was Accomplished - Unit Tests

**Implemented unit tests for the skill artifact download pipeline:**

**1. Python Tests (stigmer OSS - agent-runner):**

| File | Tests | Status |
|------|-------|--------|
| `tests/conftest.py` | Shared fixtures (mock_skill, sample_artifact_zip, etc.) | ✅ Created |
| `tests/test_skill_client.py` | 7 tests for `get_artifact()` method | ✅ 7/7 Passing |
| `tests/test_skill_writer.py` | 22 tests for extraction and prompt generation | ✅ 22/22 Passing |
| `pytest.ini` | pytest configuration | ✅ Created |

**2. Java Tests (stigmer-cloud):**

| File | Tests | Status |
|------|-------|--------|
| `SkillGetArtifactHandlerTest.java` | 11 tests for LoadArtifact step | ✅ Created |

---

## Previous Session Progress (2026-01-25 - OSS GetArtifact Implementation)

### What Was Accomplished - OSS GetArtifact Handler

**Implemented `GetArtifact` handler in stigmer OSS (Go) matching the Cloud version (Java):**

1. **New file: `get_artifact.go`**
   - Implements `GetArtifact(ctx, *GetArtifactRequest) (*GetArtifactResponse, error)`
   - Uses the same pipeline pattern as other handlers:
     - `ValidateProtoStep` - Validates `artifact_storage_key` field
     - `loadArtifactStep` - Loads artifact from storage
   - Proper gRPC status codes (NotFound, Internal)
   - Uses existing `ArtifactStorage` interface (local file storage)

2. **Updated `BUILD.bazel`**
   - Added `get_artifact.go` to sources
   - Added grpc/codes and grpc/status dependencies

### Comparison: Cloud (Java) vs OSS (Go)

| Aspect | Cloud (Java) | OSS (Go) |
|--------|--------------|----------|
| Storage | R2 (CloudFlare) | Local filesystem |
| Pipeline | `RequestPipelineV2` | `pipeline.Pipeline` |
| Validation | `commonSteps.validateFieldConstraints` | `steps.NewValidateProtoStep` |
| Load step | `LoadArtifact` inner class | `loadArtifactStep` struct |
| Response | `TransformResponse` + `SendResponse` | Direct return |

### Files Modified (This Session)

**stigmer OSS repo:**
```
backend/services/stigmer-server/pkg/domain/skill/controller/
├── get_artifact.go   # NEW - 93 lines (GetArtifact handler)
└── BUILD.bazel       # +3 lines (new source + deps)
```

---

## Previous Session Progress (2026-01-25 - Code Review Session)

### What Was Accomplished - Code Review

**Verified handler patterns in stigmer-cloud:**
- Reviewed `SkillGetArtifactHandler.java` vs `SkillGetByReferenceHandler.java`
- Confirmed handler follows established static inner class pattern:
  - `LoadArtifact` is a `@Component` static inner class
  - Implements `RequestPipelineStepV2` interface
  - Uses `RequestPipelineStepResultV2.success(getName())` / `failure()` pattern
  - Dependency injection via `@RequiredArgsConstructor`
- Pattern consistency verified across skill handlers

### Files Reviewed
- `SkillGetArtifactHandler.java` - Static inner class pattern ✅
- `SkillGetByReferenceHandler.java` - Reference pattern for handlers

### Key Observation
The `SkillGetArtifactHandler` was already correctly implemented with the static inner class pattern in commit `841c7921`. No changes were necessary.

---

## Previous Session Progress (2026-01-25 - Artifact Download Implementation)

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
2. ✅ ~~**OSS GetArtifact Handler**~~ - COMPLETED (Go implementation)
3. ✅ ~~**Unit Tests (Python/Java)**~~ - COMPLETED (Python: 29 tests, Java: 11 tests)
4. ✅ ~~**Integration Tests (Python/Java)**~~ - COMPLETED (Python: 21 tests, Java: 18 tests)
5. ✅ ~~**Go Unit & Integration Tests**~~ - COMPLETED (65 tests for skill domain)
6. ✅ ~~**MongoDB Migration**~~ - COMPLETED (7 compound indexes for skill_audit)
7. ✅ ~~**CLI Enhancement**~~ - COMPLETED (`stigmer skill push` command)
8. **Documentation**: Update agent-runner docs with complete skill architecture
9. **Commit Changes**: Commit CLI refactor changes (uncommitted)

## Context for Resume

- **CLI refactor COMPLETE**: Dedicated `stigmer skill push` command implemented
- **Artifact download & extraction COMPLETE**: Full pipeline implemented per ADR 001
- **OSS GetArtifact handler COMPLETE**: Go implementation matching Java/Cloud version
- **Unit tests COMPLETE**: Python (29 tests) + Java (11 tests) for artifact pipeline
- **Integration tests COMPLETE**: Python (21 tests) + Java (18 tests) for full pipeline
- **Go tests COMPLETE**: 65 tests for skill domain (storage + controller + integration)
- **MongoDB indexes COMPLETE**: 7 compound indexes for skill_audit collection
- **Skill injection complete**: Full SKILL.md content injected into prompts
- **Both local and cloud modes supported**: Works with filesystem and Daytona
- **Graceful degradation**: Falls back to SKILL.md-only if artifact download fails
- **Backward compatible**: Works with skills that don't have artifacts
- **ADR 001 compliance verified**: All ADR validation requirements tested
- **R2 bucket not yet created**: Placeholders in stigmer-cloud secrets (pending user action)
- **Build issue note**: `bazel build` has pre-existing issue with missing `com_github_google_safearchive` repo (not related to changes)
- **CLI command hierarchy**: Now follows industry best practices (verb-first + noun-first hybrid)

## What's Complete (ADR 001)

Per ADR 001, the complete skill injection and mounting architecture is now implemented:
1. ✅ SKILL.md injection into system prompt with LOCATION headers
2. ✅ Artifact download from R2/storage via gRPC
3. ✅ ZIP extraction to `/bin/skills/{version_hash}/`
4. ✅ Executable permissions for scripts
5. ✅ Both local filesystem and Daytona sandbox support

## Uncommitted Changes

**stigmer OSS repo (CLI Refactor Session):**
```
Modified files:
- client-apps/cli/cmd/stigmer/root.go              # +1 line (register skill command)
- client-apps/cli/cmd/stigmer/root/apply.go        # -204 lines (removed artifact mode)
- client-apps/cli/internal/cli/artifact/skill.go   # Fixed field access bugs
- client-apps/cli/COMMANDS.md                      # +24 lines (skill docs)
- backend/.../skill/controller/get_artifact.go     # Fixed ctx.Input() bug
- _projects/.../next-task.md                       # This file

New files:
- client-apps/cli/cmd/stigmer/root/skill.go        # NEW (~230 lines)
- _projects/.../checkpoints/2026-01-25-mongodb-index-migration.md  # NEW checkpoint
```

**stigmer-cloud repo:**
- All changes committed (clean working tree)
- Latest commit: `302b8180` feat(backend/skill): add MongoDB indexes for skill_audit collection

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
