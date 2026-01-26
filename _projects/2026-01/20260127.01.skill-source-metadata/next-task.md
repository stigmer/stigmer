# Next Task: 20260127.01.skill-source-metadata

## Current State
- **Status**: In-progress (T01-T04 completed, T05 pending)
- **Last Session**: 2026-01-27 (Session 1)
- **Active Task**: T05 - Backend storage of source metadata

## Session Progress (2026-01-27 Session 1)

### ✅ Completed Tasks

**T01: Proto Design**
- Added `SkillSource`, `LocalSource`, `GitSource` messages to `spec.proto`
- Added `name` and `source` fields to `SkillSpec` 
- Added `source` field to `PushSkillRequest` in `io.proto`
- Generated Go and Python stubs successfully

**T02: CLI YAML Parsing**
- Created `skillmd.go` with YAML frontmatter parser
- Extracts skill name from SKILL.md (required field)
- Validates kebab-case format
- Clear error messages for missing/invalid frontmatter

**T03: CLI Git Detection**
- Implemented auto-detection of git repository info
- Collects: remote URL (origin), commit SHA, subdirectory
- Creates `LocalSource` with git metadata
- Graceful fallback for non-git directories

**T04: CLI Remote GitHub Push**
- Added CLI flags: `--git-url`, `--git-ref`, `--subdir`
- Implemented `executeRemoteSkillPush()` with shallow clone
- Created `PushSkillFromGit()` with `GitSource` metadata
- Handles tags, branches, and commit SHAs

### 📊 Files Modified (10 files, +903 lines, -66 lines)
- `apis/ai/stigmer/agentic/skill/v1/spec.proto` - New source messages
- `apis/ai/stigmer/agentic/skill/v1/io.proto` - Updated push request
- `apis/stubs/go/**/*.pb.go` - Generated Go stubs
- `apis/stubs/python/**/*.py` - Generated Python stubs
- `client-apps/cli/cmd/stigmer/root/skill.go` - Remote push support
- `client-apps/cli/internal/cli/artifact/skill.go` - Git detection + remote push
- `client-apps/cli/internal/cli/artifact/skillmd.go` - **NEW** YAML parser

### 🎯 Key Decisions
1. Used `oneof` in `SkillSource` for extensibility (local vs git)
2. Skill name from YAML frontmatter is **required** (no folder name fallback)
3. Git detection is automatic for local pushes (non-intrusive)
4. Remote push uses shallow clone (`--depth 1`) for performance

### 📝 Documentation Created
- `tasks/T01_0_plan.md` - Initial design plan
- `tasks/T01_3_execution.md` - Implementation summary (T01-T04)

## Next Steps

### 🚧 Immediate: T05 - Backend Storage (stigmer-cloud)

**Location**: `/Users/suresh/scm/github.com/stigmer/stigmer-cloud/`

**Files to Update**:
1. **Skill Handler** (Java):
   - `backend/services/stigmer-service/.../skill/handler/SkillHandler.java`
   - Accept `source` field from `PushSkillRequest`
   - Store in skill entity/state

2. **Skill Entity** (Java):
   - Update skill model to include source field
   - Map proto `SkillSource` to entity field

3. **Response Mapping**:
   - Return source info in skill responses
   - Include in get/list operations

**What's Needed**:
- Accept `source` in push handler
- Store in database/state
- Return in responses

### 🔄 After T05
1. Test end-to-end flow (local + remote push)
2. Update CLI documentation/examples
3. Consider creating a sample skill with proper YAML
4. Create changelog entry

## Context for Resume

### Expected SKILL.md Format
```yaml
---
name: my-skill-name
version: 1.0.0
description: Optional description
---

# Skill Title
...
```

### CLI Usage Examples
```bash
# Local push (auto-detects git)
stigmer skill push ./my-skill/

# Remote GitHub push
stigmer skill push \
  --git-url https://github.com/org/repo.git \
  --git-ref v1.0.0 \
  --subdir skills/calculator
```

### Proto Structure
- `SkillSource` - oneof wrapper
  - `LocalSource` - for local pushes (git_remote_url, git_commit, subdir, is_git_repo)
  - `GitSource` - for remote pushes (url, ref, subdir)

## Files to Review for T05

When resuming T05 (backend work):
1. Check latest proto stubs in stigmer-cloud: `apis/stubs/java/`
2. Find skill handler: `backend/services/stigmer-service/src/main/java/.../skill/`
3. Review how other fields are stored (e.g., `tag`, `skill_md`)
4. Update entity and handler to persist `source`

## Quick Resume

To continue this project, drag this file into chat:
```
@_projects/2026-01/20260127.01.skill-source-metadata/next-task.md
```

Or reference specific files:
- Latest execution notes: `@tasks/T01_3_execution.md`
- Design plan: `@tasks/T01_0_plan.md`

---

**Session 1 Summary**: Proto design and CLI implementation complete (T01-T04). Backend storage remains (T05). All changes compile and verify successfully. Ready for stigmer-cloud backend updates.
