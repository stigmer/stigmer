# T01.1 - Cleanup Needed for Old Proto References

**Status**: IDENTIFIED
**Priority**: HIGH (must be done before T01.2)

## Overview

The proto definitions have been successfully updated, but there are many references to the old field names throughout the codebase that need to be updated.

## Old Field Names → New Field Names

| Old Name | New Name | Location |
|----------|----------|----------|
| `markdown_content` | `skill_md` | SkillSpec |
| `description` | REMOVED | SkillSpec |

## Files Requiring Updates

### 1. SDK Go Package (91 references to `MarkdownContent`)

**Location**: `sdk/go/skill/`

**Files**:
- `sdk/go/skill/skill.go` - Main skill struct and methods
- `sdk/go/skill/proto.go` - Proto conversion
- `sdk/go/skill/skill_inline_test.go` - Tests
- `sdk/go/skill/proto_integration_test.go` - Integration tests

**Changes Needed**:
- Update `Skill` struct field: `MarkdownContent` → `SkillMd`
- Update all references in methods
- Update tests to use new field name

### 2. SDK Examples (Multiple files)

**Files**:
- `sdk/go/examples/02_agent_with_skills.go`
- `sdk/go/examples/06_agent_with_inline_content.go`

**Changes Needed**:
- Update example code to use `SkillMd` instead of `MarkdownContent`
- Update comments and documentation

### 3. SDK Integration Tests

**Files**:
- `sdk/go/integration_scenarios_test.go`
- `sdk/go/agent/proto_integration_test.go`
- `sdk/go/agent/benchmarks_test.go`
- `sdk/go/stigmer/context_test.go`

**Changes Needed**:
- Update all test cases to use new field names
- Verify tests still pass after changes

### 4. Backend Controller Tests

**Location**: `backend/services/stigmer-server/pkg/domain/skill/controller/`

**File**: `skill_controller_test.go`

**Changes Needed**:
- Update test cases from `MarkdownContent` to `SkillMd`
- Remove references to `Description` field (no longer exists in spec)
- Update validation tests

### 5. CLI Code

**Location**: `client-apps/cli/`

**Files**:
- `client-apps/cli/cmd/stigmer/root/apply.go` - References to `Spec.Description`
- `stigmer-cloud/client-apps/cli/internal/cli/converter/converter.go` - MarkdownContent reference

**Changes Needed**:
- Update field references in CLI commands
- Remove display of `Description` (or use metadata if needed)

### 6. Generated Code (Already Updated)

**Status**: ✅ COMPLETE

**Files**: All proto stubs regenerated with new field names
- `apis/stubs/go/ai/stigmer/agentic/skill/v1/spec.pb.go` ✅
- `apis/stubs/python/...` ✅

## Recommendations

### Option 1: Update All References Now (Comprehensive)
- Update all SDK, backend, and CLI code
- Update all tests
- Ensure everything compiles
- Run all tests to verify

**Pros**:
- Clean, complete migration
- No broken code

**Cons**:
- Takes more time
- Requires testing everything

### Option 2: Progressive Updates (Recommended)
1. **T01.2 (CLI)**: Update CLI code when implementing new features
2. **T01.3 (Backend)**: Update backend handlers when implementing new logic
3. **T01.4 (Agent Integration)**: Update SDK and agent code together
4. **T01.5 (Testing)**: Update all tests during test phase

**Pros**:
- Incremental, manageable
- Update code as we work on it
- Natural progression through tasks

**Cons**:
- Some code broken temporarily
- Need to track what's updated

### Option 3: Minimal Updates for Proto Only
- Leave old references as-is
- Only update when adding new features
- Let broken code fail tests

**Pros**:
- Fastest for proto task completion

**Cons**:
- Many broken references
- Hard to track what works

## Recommendation for Next Steps

**Use Option 2: Progressive Updates**

For T01.2 (CLI Enhancement):
1. Update CLI code to use new proto field names
2. Update CLI-specific tests
3. Leave SDK examples and integration tests for later tasks

For T01.3 (Backend Implementation):
1. Update backend controller code
2. Update backend tests
3. Implement new push/versioning logic

For T01.4 (Agent Integration):
1. Update SDK skill package
2. Update all SDK tests
3. Update examples
4. Update agent integration code

## Tracking

**Current Status**:
- ✅ Proto definitions updated
- ✅ Proto stubs generated
- ⏳ SDK code needs update (91 references)
- ⏳ Backend tests need update (30+ references)
- ⏳ CLI code needs update (2 files)
- ⏳ Examples need update (2 files)

---

**Note**: This is a natural consequence of breaking changes. Since we're not maintaining backward compatibility (as requested), we'll update references progressively through each task.
