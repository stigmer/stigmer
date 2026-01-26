# Next Task: 20260127.02.agent-skills-spec-alignment

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Current State

- **Status**: In Progress - Phase 2 Complete (Go Backend + CLI)
- **Last Session**: 2026-01-27 - Completed Phase 2 (Go Backend + Proto + CLI)
- **Active Task**: Ready for Phase 3 (Java Backend in stigmer-cloud)

## Architectural Revision (2026-01-27)

### Feedback Received
The original approach had CLI extracting `name` and `description` from SKILL.md and sending them in `PushSkillRequest`. This is redundant because:
- Backend already extracts SKILL.md content from the artifact
- Parsing YAML frontmatter should happen in backend (single source of truth)
- CLI should only validate format, not extract fields for the API

### Revised Approach
1. **CLI**: Validate SKILL.md format → Create ZIP → Send artifact only
2. **Backend**: Extract SKILL.md → Parse YAML frontmatter → Store name/description

### Key Changes from Original Plan
| Original | Revised |
|----------|---------|
| Add `description` to `PushSkillRequest` | **Remove** `name` and `description` from `PushSkillRequest` |
| CLI extracts and sends name/description | CLI validates only, backend extracts |
| Backend uses request fields | Backend parses YAML frontmatter |
| Go backend only | Both Go (OSS) and Java (Cloud) backends |

## Session Progress (2026-01-27)

### Phase 1: Proto Cleanup - COMPLETE ✅
- Removed `name` field from `PushSkillRequest`
- Removed `description` field from `PushSkillRequest`
- Added `reserved 1, 7;` for backward compatibility

### Phase 2: Go Backend + Proto Renumbering + CLI - COMPLETE ✅

**Proto Field Renumbering:**
- Removed `reserved 1, 7;` statement (no backward compatibility needed)
- Renumbered fields: scope=1, org=2, artifact=3, tag=4, source=5
- Regenerated Go and Python stubs

**Go Backend Frontmatter Parsing:**
- Created `frontmatter.go` with robust YAML parsing (ported from CLI `skillmd.go`)
- Extended `ExtractSkillMdResult` with `Name` and `Description` fields
- Updated `ExtractSkillMd` to parse frontmatter and populate result

**Push Pipeline Updates:**
- Reordered pipeline: `ExtractAndHashArtifactStep` now runs before `ResolveSlugForPushStep`
- Updated `BuildInitialSkillStep`: Removed `req.Name` reference
- Updated `ResolveSlugForPushStep`: Uses extracted name from frontmatter
- Updated `PopulateSkillFieldsStep`: Sets `spec.name` and `spec.description` from extracted frontmatter

**CLI Cleanup:**
- Removed `Name` field from `PushSkillRequest` construction in both `PushSkill` and `PushSkillFromGit`
- Kept `ParseSkillMetadata` for local validation (good UX with clear error messages)

**Files Modified:**
- `apis/ai/stigmer/agentic/skill/v1/io.proto`
- `apis/stubs/go/...` (regenerated)
- `apis/stubs/python/...` (regenerated)
- `backend/services/stigmer-server/pkg/domain/skill/storage/frontmatter.go` (new)
- `backend/services/stigmer-server/pkg/domain/skill/storage/zip_extractor.go`
- `backend/services/stigmer-server/pkg/domain/skill/storage/BUILD.bazel`
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go`
- `client-apps/cli/internal/cli/artifact/skill.go`

### Pending Tasks
1. ~~**Proto Cleanup**: Remove fields from `PushSkillRequest`~~ ✅
2. ~~**Proto Renumbering**: Clean field numbers 1-5~~ ✅
3. ~~**Regenerate Stubs**: Run stub generation~~ ✅
4. ~~**Go Backend**: Add YAML frontmatter parsing~~ ✅
5. ~~**CLI Cleanup**: Remove name from `PushSkillRequest` construction~~ ✅
6. **Java Backend**: Add YAML frontmatter parsing to stigmer-cloud skill handler

## Next Steps

1. **Phase 3: Java Backend** - Add frontmatter parsing in stigmer-cloud
   - Identify skill push handler in Java backend
   - Port YAML frontmatter parsing logic
   - Extract `name` and `description` from SKILL.md content

## Files to Reference

### Proto Files
- `apis/ai/stigmer/agentic/skill/v1/io.proto` - Remove name/description fields
- `apis/ai/stigmer/agentic/skill/v1/spec.proto` - Keep description field

### Go Backend (stigmer OSS)
- `backend/services/stigmer-server/pkg/domain/skill/storage/zip_extractor.go` - Add frontmatter parsing
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go` - Use extracted values

### Java Backend (stigmer-cloud)
- Skill push handler (to be identified)

### CLI
- `client-apps/cli/internal/cli/artifact/skill.go` - Remove fields from request
- `client-apps/cli/internal/cli/artifact/skillmd.go` - Keep for validation

## Project Info

**Description**: Align Stigmer's Agent Skills implementation with the official Agent Skills specification
**Goal**: Backend as single source of truth for SKILL.md parsing
**Tech Stack**: Protobuf, Go (CLI + backend), Java (stigmer-cloud backend)
**Scope**: Both OSS and Cloud repositories

## Essential Files

- **Plan**: `.cursor/plans/skill_description_proto_phase1_a323bc80.plan.md`
- **Task Plan**: `_projects/2026-01/20260127.02.agent-skills-spec-alignment/tasks/T01_0_plan.md`

## Quick Resume

To continue this project, drag into chat:
```
@_projects/2026-01/20260127.02.agent-skills-spec-alignment/next-task.md
```

Then say: "I've reviewed the plan, please proceed with Phase 1 - Proto Cleanup"

---

*Last updated: 2026-01-27 (Revised based on architectural feedback)*
