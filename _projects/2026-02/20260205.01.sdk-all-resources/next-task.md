# Next Task: SDK Unified Resource Pattern

**Project**: `_projects/2026-02/20260205.01.sdk-all-resources`

## Current State
- **Status**: ✅ Task 3.4 Complete - Ready for Task 4.1
- **Last Session**: February 6, 2026 (Workflow unified pattern applied)
- **Active Branch**: `feat/add-sdk-implementation-for-all-resources`

## Session Progress (February 6, 2026 - Task 3.3)

### What Was Accomplished
- ✅ Applied unified pattern to Skill package while respecting its unique architecture
- ✅ Created comprehensive error handling (`skill/errors.go`)
- ✅ Fixed documentation (`skill/doc.go`) to remove incorrect API references
- ✅ Added protovalidate validation to `ToProto()` method
- ✅ Created comprehensive test suite with 31 passing tests
- ✅ All quality gates passed (build, test, vet, linter)

### Key Discovery: Skill is Architecturally Different

The session revealed that **Skill is fundamentally different** from Agent/MCPServer/Environment:
- Skill is a **content artifact** (like Docker images), not a configuration resource
- Users provide **source location** (path/git URL), not configuration Args
- SkillArgs is **backend-populated** from artifact content, not user-provided
- ToProto returns **SkillSynth** (handover message), not full resource proto

**Decision**: Did NOT force the Name/Slug/Args pattern on Skill because it would create:
- Confusion about what SkillArgs means
- Technical debt from misaligned architecture
- Maintenance burden when the pattern doesn't fit

### Implementation Details

#### Files Created
1. **`sdk/go/skill/errors.go`** (98 lines)
   - Sentinel errors: `ErrPathRequired`, `ErrUrlRequired`, `ErrSourceNil`, `ErrConversion`
   - Type aliases to shared validation package
   - Helper constructors for Skill-specific errors

2. **`sdk/go/skill/synth_test.go`** (442 lines)
   - 31 comprehensive tests covering all functionality
   - Mock context implementation for testing
   - Tests for FromDir, FromGit, ToProto, accessors, String(), errors

#### Files Modified
1. **`sdk/go/skill/synth.go`**
   - Replaced inline `errors.New()` with sentinel errors from `errors.go`
   - Added protovalidate validation infrastructure (validator, init())
   - Enhanced `ToProto()` with proper nil source validation
   - Added validation for empty paths/URLs

2. **`sdk/go/skill/doc.go`** (62 lines)
   - Fixed incorrect references to non-existent `skill.New()` and `skill.Parse()`
   - Correctly directs users to `commons/ref/` package for skill references
   - Clarified the distinction between defining skills (this package) vs referencing them

### Test Results
```
✅ All 31 tests passing
✅ go build ./skill/... - Success
✅ go test ./skill/... - Success (31/31 tests)
✅ go vet ./skill/... - No issues
✅ Linter - No errors
```

### Net Changes
- **Files created**: 2 (errors.go, synth_test.go)
- **Files modified**: 2 (synth.go, doc.go)
- **Total lines added**: ~602 lines
- **Quality**: World-class standards, comprehensive test coverage

## Session Progress (February 6, 2026 - Task 3.4)

### What Was Accomplished
- ✅ Applied unified pattern to Workflow package with single-source-of-truth architecture
- ✅ Replaced hand-written WorkflowArgs with type alias to generated proto
- ✅ Implemented immediate task conversion (fail-fast pattern)
- ✅ Added environment methods (RequireSecret, RequireConfig)
- ✅ Simplified ToProto() to pure delegation
- ✅ Updated all test files to use new pattern
- ✅ All quality gates passed (build, test, vet, linter)

### Key Architectural Decisions

**Single Source of Truth**: 
- Eliminated dual-state anti-pattern (SDK Document/Tasks alongside Args.Document/Args.Tasks)
- `Args *WorkflowArgs` is now the ONLY source for Document, Tasks, EnvSpec, Description
- Consistent with Agent/MCPServer pattern

**Fail-Fast Task Conversion**:
- Tasks convert from SDK to proto immediately in `AddTask()`
- Errors surface at AddTask time, not ToProto time
- `Args.Tasks` always contains proto types, never SDK types

**Transient Builder Pattern**:
- SDK `Task` type remains as builder, but not stored
- TaskFieldRef still works (only needs task name, not stored state)

### Implementation Details

#### Files Modified
1. **`workflow.go`** (Major refactor)
   - Replaced hand-written WorkflowArgs with type alias
   - Updated Workflow struct: removed Document/Tasks fields, added Name/Args
   - Updated New() to build Args.Document directly
   - Updated AddTask/AddTasks to convert immediately (fail-fast)
   - Added ensureEnvSpec(), RequireSecret(), RequireConfig()

2. **`proto.go`** (Simplified)
   - Removed convertTasks() - no longer needed
   - Simplified ToProto() to pure delegation (Args.Document, Args.Tasks, Args.EnvSpec)
   - Removed complex conversion logic

3. **`validation.go`** (Updated)
   - Added validateArgsDocument() for Args.Document fields
   - Moved constants from deleted document.go
   - Added semver regex validation

4. **`errors.go`** (Enhanced)
   - Added ErrArgsNil, ErrTaskConversion sentinel errors

5. **Test Files** (All rewritten):
   - `benchmarks_test.go` - Updated to use New() and AddTask()
   - `proto_integration_test.go` - Rewritten with new pattern
   - `error_cases_test.go` - Updated for fail-fast behavior
   - `edge_cases_test.go` - Added env method tests

#### Files Deleted
- **`document.go`** - SDK Document struct no longer needed (Args.Document is proto type)

### Test Results
```
✅ All tests passing (100+ tests)
✅ go build ./workflow/... - Success
✅ go test ./workflow/... - Success
✅ go vet ./workflow/... - No issues
✅ Linter - No errors
```

### Net Changes
- **Files modified**: 9 (workflow.go, proto.go, validation.go, errors.go, 5 test files)
- **Files deleted**: 1 (document.go)
- **Lines changed**: ~1,278 insertions, ~1,288 deletions
- **Quality**: World-class implementation, comprehensive test coverage

## Next Task: 4.1 - Fix Pre-existing Test Failures

**Goal**: Address any pre-existing test failures in other SDK packages after the unified pattern changes.

**Steps**:
1. Run full SDK test suite: `go test ./sdk/go/...`
2. Identify any failures related to workflow changes
3. Fix integration issues
4. Ensure all packages work together

**Validation**:
```bash
cd sdk/go && go test ./...
```

## Completed Tasks

| Task | Description | Status |
|------|-------------|--------|
| 1.0 | Establish patterns from Agent/Environment | ✅ Complete |
| 2.1 | Create commons/ref/ package | ✅ Complete |
| 2.2 | Add ref.Environment() factory | ✅ Complete |
| 2.3 | Unify Environment as first-class resource | ✅ Complete |
| 3.1 | Consolidate SubAgent into Agent | ✅ Complete (Feb 6) |
| 3.2 | Apply unified pattern to McpServer | ✅ Complete (Feb 6) |
| 3.3 | Apply unified pattern to Skill | ✅ Complete (Feb 6) |
| 3.4 | Apply unified pattern to Workflow | ✅ Complete (Feb 6) |

### Task 3.4 Summary (Just Completed)

**Changes**:
- Replaced hand-written WorkflowArgs with type alias to generated proto
- Updated Workflow struct to single-source-of-truth (Args only)
- Implemented fail-fast task conversion (immediate proto conversion in AddTask)
- Added RequireSecret/RequireConfig environment methods
- Simplified ToProto to pure delegation
- Deleted document.go (SDK Document no longer needed)
- Updated all test files to new pattern

**Files**: 9 modified, 1 deleted (~1,278 insertions, ~1,288 deletions)

**Quality**: All 100+ tests passing, no linter errors, world-class implementation

**Key insight**: Eliminated dual-state anti-pattern by making Args the single source of truth, with immediate task conversion for fail-fast errors

## Remaining Tasks

| Task | Description | Status |
|------|-------------|--------|
| 4.1 | Fix pre-existing test failures | 🔜 Next |
| 4.2 | Update examples | Pending |
| 4.3 | Update documentation | Pending |

## The Unified Pattern (Reference)

Every SDK resource follows this pattern:

```go
// Resource struct
type Agent struct {
    Name string         // Identity
    Slug string         // Auto-generated from Name
    Org  string         // Organization scope
    Args *AgentArgs     // Single source of truth
}

// Args is alias to generated code
type AgentArgs = genAgent.AgentArgs

// Constructor registers with Context
func New(ctx Context, name string, args *AgentArgs) (*Agent, error)

// Builder methods modify Args
func (a *Agent) AddSkill(ref string) *Agent
func (a *Agent) RequireSecret(name, desc string) *Agent
```

## Context for Resume

### Important Patterns Established
1. **Error handling**: All packages now have `errors.go` with sentinel errors
2. **Validation**: protovalidate used consistently in `ToProto()` methods
3. **Testing**: Comprehensive test coverage with mock contexts
4. **Documentation**: Clear distinction between defining vs referencing resources

### Architectural Understanding
- **Skill is special**: Content artifact (source location) vs configuration (Args)
- **SkillArgs backend-populated**: Extracted from SKILL.md, not user-provided
- **Pattern flexibility**: Apply pattern where it fits, respect unique architectures

### Files to Reference
- **Skill implementation**: `sdk/go/skill/` - Shows how to handle content artifacts
- **Agent/MCPServer**: Reference for configuration resources
- **Environment**: Reference for simpler resource pattern

## Quick Resume

To continue this project:
```
@_projects/2026-02/20260205.01.sdk-all-resources/next-task.md
```

Then say: "Continue with Task 3.4 - Apply pattern to Workflow"

## Important Files
- **Main Plan**: `plans/sdk_layer_reorganization_d0769037.plan.md`
- **Agent (reference)**: `sdk/go/agent/agent.go`
- **Environment (reference)**: `sdk/go/environment/environment.go`
- **McpServer (reference)**: `sdk/go/mcpserver/server.go`
- **Skill (just completed)**: `sdk/go/skill/` - All files
- **Workflow (next)**: `sdk/go/workflow/workflow.go`

## Context for Resume

### Implementation Summary
- **Tasks 3.1-3.4**: All core SDK resources now follow unified pattern
- **Agent**: Has SubAgent consolidated, full pattern implementation
- **MCPServer**: Clean implementation following Agent pattern
- **Skill**: Unique architecture respected (content artifact)
- **Workflow**: Single-source-of-truth with fail-fast task conversion

### Key Patterns Established
1. **Name/Slug/Org/Args pattern**: Consistent identity across resources
2. **Type aliases**: `type XxxArgs = genXxx.XxxArgs` for single source of truth
3. **Environment methods**: RequireSecret/RequireConfig pattern
4. **Fail-fast validation**: Errors surface at build time, not ToProto time
5. **Proto validation**: protovalidate used consistently

### Architecture Decisions
- **Workflow**: Tasks convert to proto immediately (fail-fast)
- **Skill**: Remains unique as content artifact
- **Args as truth**: No duplicate SDK structs alongside Args

---

**Last Updated**: February 6, 2026 (Task 3.4 completed)  
**Branch**: `feat/add-sdk-implementation-for-all-resources`  
**Status**: Ready for Task 4.1 (Fix pre-existing tests)
