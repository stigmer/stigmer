# Next Task: SDK Unified Resource Pattern

**Project**: `_projects/2026-02/20260205.01.sdk-all-resources`

## Current State
- **Status**: ✅ Task 3.3 Complete - Ready for Task 3.4
- **Last Session**: February 6, 2026 (Skill unified pattern applied)
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

## Next Task: 3.4 - Apply Pattern to Workflow

**Goal**: Update `workflow/` package to follow the established Name/Slug/Org/Args pattern.

**Context**: Workflow is a configuration resource like Agent/MCPServer, so it SHOULD follow the full pattern.

**Steps**:
1. Review current workflow/ implementation
2. Verify Args alias: `type WorkflowArgs = genWorkflow.WorkflowArgs`
3. Verify struct follows pattern: `Workflow{Name, Slug, Org, Args, Tasks, ctx, mu}`
4. Verify `New(ctx Context, name string, args *WorkflowArgs) (*Workflow, error)`
5. Add RequireSecret/RequireConfig methods (parity with Agent)
6. Ensure task system integrates properly with Args
7. Verify `errors.go` exists with sentinel errors
8. Update/add tests

**Validation**:
```bash
go build ./workflow/... && go test ./workflow/...
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

### Task 3.3 Summary (Just Completed)

**Changes**:
- Created `errors.go` with sentinel errors and type aliases
- Updated `synth.go` to use errors, added protovalidate validation
- Fixed `doc.go` to remove incorrect API references
- Created comprehensive test suite (31 tests, all passing)

**Files**: 2 created, 2 modified (+~602 lines)

**Quality**: All tests passing, no linter errors, world-class standards

**Key insight**: Respected Skill's unique architecture as content artifact rather than forcing misaligned patterns

## Remaining Tasks

| Task | Description | Status |
|------|-------------|--------|
| 3.4 | Apply unified pattern to Workflow | 🔜 Next |
| 4.1 | Fix pre-existing test failures | Pending |
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

---

**Last Updated**: February 6, 2026 (Task 3.3 completed)  
**Branch**: `feat/add-sdk-implementation-for-all-resources`  
**Status**: Ready for Task 3.4 (Workflow)
