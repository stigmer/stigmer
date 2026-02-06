# Next Task: SDK Unified Resource Pattern

**Project**: `_projects/2026-02/20260205.01.sdk-all-resources`

## Current State
- **Status**: ✅ Task 3.2 Complete - Ready for Task 3.3
- **Last Session**: February 6, 2026 (McpServer unified pattern applied)
- **Active Branch**: `feat/add-sdk-implementation-for-all-resources`

## Plan Correction (February 6, 2026)

The plan was corrected to match the **ACTUAL established pattern**:

### What Was Wrong
- Plan proposed complex DDD layers: `domain/`, `infra/proto/`, `api/`, `app/`
- Plan proposed pure domain objects separate from proto
- Plan proposed SubAgent as separate concept (but it's already in generated Args)
- Plan contradicted the decisions made during implementation

### What Is Correct (Established Pattern)
1. **Use generated Args directly**: `type AgentArgs = genAgent.AgentArgs`
2. **Flat package structure**: `agent/`, `environment/`, `mcpserver/`, `skill/`, `workflow/`
3. **SubAgents in Args**: Part of `AgentArgs.SubAgents` from proto
4. **Proto types in Args**: No pure domain abstraction
5. **Builder methods modify Args**: Direct mutation with mutex
6. **`commons/ref/` for references**: Factory functions

## Completed Tasks

| Task | Description | Status |
|------|-------------|--------|
| 1.0 | Establish patterns from Agent/Environment | ✅ Complete |
| 2.1 | Create commons/ref/ package | ✅ Complete |
| 2.2 | Add ref.Environment() factory | ✅ Complete |
| 2.3 | Unify Environment as first-class resource | ✅ Complete |
| 3.1 | Consolidate SubAgent into Agent | ✅ Complete (Feb 6) |
| 3.2 | Apply unified pattern to McpServer | ✅ Complete (Feb 6) |

### Task 3.2 Details (Completed Feb 6, 2026)

**What was done**:
- Added `Org` field to MCPServer struct for organization scoping
- Created `errors.go` with sentinel errors (ErrNameRequired, ErrStdioRequired, etc.)
- Implemented 9 builder methods for ergonomic configuration
  - SetDescription, SetIconUrl
  - AddTag/AddTags for categorization
  - EnableTool/EnableTools for default tools
  - RequireApproval for tool approval policies
  - RequireSecret/RequireConfig for environment variables
- Added `ensureEnvSpec()` helper for thread-safe initialization
- Updated constructors (Stdio/HTTP) to use sentinel errors
- Updated ToProto() to include Org in metadata
- Fixed test type imports (gen/types → proto stubs)
- Added comprehensive tests (37 passing, race-tested)

**Key accomplishment**: mcpserver now follows exact same pattern as Agent/Environment

**Files changed**: 5 modified, 1 created (+582 net lines)

**Commit**: `0a954a88` - feat(sdk/mcpserver): apply unified Name/Slug/Org/Args pattern

**Changelog**: `_changelog/2026-02/2026-02-06-173352-apply-unified-pattern-to-mcpserver.md`

### Task 3.1 Details (Completed Feb 6, 2026)

**What was done**:
- Removed duplicate `agent.SubAgent` custom type (352 lines)
- Deleted `subagent_parsing.go` (95 lines)
- Updated `Agent` struct to remove separate `SubAgents` field
- Modified `AddSubAgent()` to use `*agentv1.SubAgent` proto type
- Simplified `ToProto()` to use `Args.SubAgents` directly (removed conversion)
- Created `subagent_helpers.go` with ergonomic builder API
- Updated all tests to use proto SubAgent type
- Updated example `04_agent_with_subagents.go`

**Key accomplishment**: Args is now single source of truth for SubAgents

**Files changed**: 11 modified, 2 deleted, 1 created (-1,271 net lines)

**Changelog**: `_changelog/2026-02/2026-02-06-165921-fix-subagent-args-single-source-of-truth.md`

## Next Task: 3.3 - Apply Pattern to Skill

**Goal**: Update `skill/` package to follow the established Name/Slug/Org/Args pattern.

**Current State**: skill/ has `skill/synth.go` with synthesis logic but needs full resource pattern

**Steps**:
1. Review current skill/ implementation
2. Create Args alias: `type SkillArgs = genSkill.SkillArgs`
3. Create Skill struct: `Skill{Name, Slug, Org, Args, ctx, mu}`
4. Implement `New(ctx Context, name string, args *SkillArgs) (*Skill, error)`
5. Add builder methods (if applicable for skill configuration)
6. Implement `ToProto()` method
7. Create `errors.go` with sentinel errors
8. Update/add tests

**Validation**:
```bash
go build ./skill/... && go test ./skill/...
```

## Remaining Tasks

| Task | Description | Status |
|------|-------------|--------|
| 3.3 | Apply unified pattern to Skill | 🔜 Next |
| 3.4 | Apply unified pattern to Workflow | Pending |
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

## Quick Resume

```
@_projects/2026-02/20260205.01.sdk-all-resources/next-task.md
```

Then say: "Continue with Task 3.2 - Apply pattern to McpServer"

## Important Files
- **Main Plan**: `plans/sdk_layer_reorganization_d0769037.plan.md`
- **Agent (reference)**: `sdk/go/agent/agent.go`
- **Environment (reference)**: `sdk/go/environment/environment.go`
- **McpServer (to update)**: `sdk/go/mcpserver/server.go`

---

**Last Updated**: February 6, 2026  
**Branch**: `feat/add-sdk-implementation-for-all-resources`  
**Status**: Plan corrected, ready for next task
