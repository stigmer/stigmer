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
**Current Task**: T01.4 (Agent Integration)
**Status**: Go Implementation Complete ✅
**Last Session**: 2026-01-25 - Version Resolution Implemented
**Last Completed**: T01.4 Go Version Resolution ✅ 2026-01-25 17:00

## Session Progress (2026-01-25 - Latest)

### What Was Accomplished - Version Resolution (Latest Session)
- Created `LoadSkillByReferenceStep` - Skill-specific version resolution step
- Supports: empty/"latest", tag names, SHA256 hash lookups
- Searches main collection first, then audit records for historical versions
- Added comprehensive tests for all version resolution scenarios

### Files Created/Modified
- `backend/services/stigmer-server/pkg/domain/skill/controller/load_skill_by_reference.go` - **NEW** Version resolution step
- `backend/services/stigmer-server/pkg/domain/skill/controller/get_by_reference.go` - Updated to use new step
- `backend/services/stigmer-server/pkg/domain/skill/controller/BUILD.bazel` - Added new file
- `backend/services/stigmer-server/pkg/domain/skill/controller/skill_controller_test.go` - Added version tests

### Previous Session - Archive Deletion
- Added `DeleteResourcesByIdPrefix` method to badger store for prefix-based deletion
- Created `DeleteSkillArchivesStep` in delete.go to clean up version history archives
- Updated skill delete pipeline to include archive cleanup before resource deletion

### Key Decisions Made
- Skill-specific step rather than generic (only Skills have versioning currently)
- Audit key format: `skill_audit/<resource_id>/<timestamp>` - Allows prefix scanning
- Latest by timestamp - Multiple audit records with same tag sorted by timestamp
- Hash detection: 64 lowercase hex characters = SHA256 hash = exact version lookup

## Test Results

All version resolution tests pass:
```
✅ TestSkillController_GetByReference (all 6 scenarios)
✅ TestSkillController_GetByReference_AuditVersions (all 3 scenarios)
✅ TestIsHash (all 11 scenarios)
```

## Next Steps (when resuming)

1. **Java Backend (stigmer-cloud)**: Implement similar version resolution
2. **Python Agent-Runner**: Implement prompt engineering with skill injection
3. Consider T01.5 (Testing & Validation) or T01.6 (Documentation)

## Context for Resume

- Version resolution in Go is complete: `GetByReference` now handles `version` field in `ApiResourceReference`
- Archive records are stored with keys: `skill/skill_audit/<resource_id>/<timestamp>`
- The delete pipeline has 5 steps including archive cleanup
- Go tests: `go test ./backend/services/stigmer-server/pkg/domain/skill/controller/... -v`

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
