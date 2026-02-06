---
name: SDK Unified Resource Pattern
overview: "Apply the established Name/Slug/Args pattern consistently across all SDK resources (agent, environment, mcpserver, skill, workflow) using generated Args as single source of truth."
todos:
  - id: task-1.0
    content: Review and validate established patterns from agent and environment packages
    status: completed
  - id: task-2.1
    content: Create commons/ref/ package - consolidate skill and mcpserver reference factories
    status: completed
  - id: task-2.2
    content: Add ref.Environment() factory to commons/ref/
    status: completed
  - id: task-2.3
    content: Unify Environment as first-class resource with Name/Slug/Args pattern
    status: completed
  - id: task-3.1
    content: Consolidate SubAgent into Agent bounded context (not separate package)
    status: completed
  - id: task-3.2
    content: Apply unified pattern to McpServer resource
    status: completed
  - id: task-3.3
    content: Apply unified pattern to Skill resource
    status: completed
  - id: task-3.4
    content: Apply unified pattern to Workflow resource
    status: completed
  - id: task-4.1
    content: Fix pre-existing test failures across packages
    status: completed
  - id: task-4.2
    content: Update examples to use unified API
    status: completed
  - id: task-4.3
    content: Update documentation for new patterns
    status: completed
isProject: false
---

# SDK Unified Resource Pattern Plan

## Core Principle: Simplicity Over Architecture

This project applies a **simple, unified pattern** across all SDK resources. We DO NOT use complex DDD layer splits (domain/infra/api). Instead, we keep the SDK simple and practical.

## Established Pattern (From Agent & Environment)

Every SDK resource follows this proven pattern:

```go
// Resource struct with identity fields + Args
type Agent struct {
    Name string         // Identity - not in Args
    Slug string         // Identity - auto-generated from Name
    Org  string         // Metadata - organization scope
    Args *AgentArgs     // SINGLE SOURCE OF TRUTH for configuration
}

// Args is alias to generated code (from gen/<resource>/)
type AgentArgs = genAgent.AgentArgs
```

### Key Design Decisions (ALREADY DECIDED - DO NOT CHANGE)

| Decision | Rationale |
|----------|-----------|
| **Use generated Args directly** | Single source of truth, no wrapper duplication |
| **Flat package structure** | Simple imports, no layer complexity |
| **SubAgents in Args** | Already part of `AgentArgs.SubAgents` from proto |
| **Proto types in Args** | No pure domain objects - pragmatic approach |
| **Builder methods modify Args** | Direct mutation, thread-safe with mutex |
| **`commons/ref/` for references** | Factory functions for ApiResourceReference |

### Package Structure (Final)

```
sdk/go/
├── agent/              # Agent resource
│   ├── agent.go        # Agent struct, New(), builder methods
│   ├── subagent.go     # SubAgent (value object within Agent)
│   ├── proto.go        # ToProto() conversion
│   └── errors.go       # Package errors
│
├── environment/        # Environment resource  
│   ├── environment.go  # Environment struct, New(), builder methods
│   ├── proto.go        # ToProto() conversion
│   └── errors.go       # Package errors
│
├── mcpserver/          # MCP Server resource
│   ├── server.go       # MCPServer struct, New(), builder methods
│   ├── proto.go        # ToProto() conversion
│   └── errors.go       # Package errors
│
├── skill/              # Skill resource
│   ├── skill.go        # Skill struct, New(), builder methods
│   ├── proto.go        # ToProto() conversion
│   └── errors.go       # Package errors
│
├── workflow/           # Workflow resource
│   ├── workflow.go     # Workflow struct, New(), builder methods
│   ├── task.go         # Task types and builders
│   ├── proto.go        # ToProto() conversion
│   └── errors.go       # Package errors
│
├── commons/            # Shared utilities
│   └── ref/            # ApiResourceReference factories
│       ├── skill.go    # ref.Skill()
│       ├── mcpserver.go# ref.McpServer()
│       └── environment.go # ref.Environment()
│
├── gen/                # Generated Args (DO NOT EDIT)
│   ├── agent/
│   ├── environment/
│   ├── mcpserver/
│   ├── skill/
│   ├── workflow/
│   └── types/
│
├── stigmer/            # Context and synthesis
│   ├── context.go      # Resource registration
│   └── naming/         # Slug utilities
│
└── internal/           # Internal utilities
    ├── validation/
    └── synth/
```

---

## Completed Work

### ✅ Task 1.0: Established Patterns (Reference)

The Agent and Environment packages established the pattern:

**Agent Package** (`agent/agent.go`):
```go
type AgentArgs = genAgent.AgentArgs  // Alias to generated

type Agent struct {
    Name      string
    Slug      string
    Org       string
    Args      *AgentArgs   // Single source of truth
    SubAgents []SubAgent   // Value objects (converted to Args.SubAgents in ToProto)
}

func New(ctx Context, name string, args *AgentArgs) (*Agent, error)
func (a *Agent) AddSkill(ref string, opts ...SkillOption) *Agent
func (a *Agent) UseMCP(ref string, enabledTools ...string) *Agent
func (a *Agent) RequireSecret(name, description string) *Agent
func (a *Agent) RequireConfig(name, defaultValue, description string) *Agent
```

**Environment Package** (`environment/environment.go`):
```go
type EnvironmentArgs = genEnv.EnvironmentArgs  // Alias to generated

type Environment struct {
    Name string
    Slug string
    Org  string
    Args *EnvironmentArgs
}

func New(ctx Context, name string, args *EnvironmentArgs) (*Environment, error)
func (e *Environment) Set(name string, value string, isSecret bool) *Environment
func (e *Environment) SetSecret(name, value string) *Environment
func (e *Environment) SetConfig(name, value string) *Environment
```

### ✅ Task 2.1: commons/ref/ Package

Created `commons/ref/` with:
- `ref.Skill(org, slug string, opts ...SkillOption)` - Create skill reference
- `ref.McpServer(org, slug string)` - Create MCP server reference
- Comprehensive parsing functions and tests

### ✅ Task 2.2: ref.Environment() Factory

Added `ref.Environment(org, slug string)` to commons/ref/.

### ✅ Task 2.3: Unified Environment Resource

Transformed Environment from variable abstraction to first-class resource:
- Follows Name/Slug/Args pattern
- Uses `EnvironmentArgs` from generated code
- Registered with Context for synthesis

### ✅ Task 3.1: SubAgent Consolidation

Moved SubAgent into Agent bounded context:
- `agent/subagent.go` - SubAgent struct and NewSubAgent()
- `agent/subagent_parsing.go` - Skill reference parsing for SubAgents
- SubAgent errors merged into `agent/errors.go`
- Deleted standalone `subagent/` package

---

## Remaining Tasks

### Task 3.2: Apply Unified Pattern to McpServer

**Goal**: Update `mcpserver/` package to follow established pattern.

**Current State** (needs review):
- `mcpserver/server.go` - Has Server struct
- `mcpserver/proto.go` - Has ToProto conversion

**Required Changes**:

1. **Verify Args alias exists**:
```go
// mcpserver/server.go
type McpServerArgs = genMcpServer.McpServerArgs  // Should exist
```

2. **Verify struct follows pattern**:
```go
type MCPServer struct {
    Name string
    Slug string
    Org  string
    Args *McpServerArgs  // Single source of truth
}
```

3. **Verify New() signature**:
```go
func New(ctx Context, name string, args *McpServerArgs) (*MCPServer, error)
```

4. **Builder methods should modify Args directly**

**Validation**: `go build ./mcpserver/... && go test ./mcpserver/...`

### Task 3.3: Apply Unified Pattern to Skill

**Goal**: Update `skill/` package to follow established pattern.

**Current State** (needs review):
- `skill/synth.go` - Current implementation

**Required Changes**:

1. **Create Args alias**:
```go
// skill/skill.go
type SkillArgs = genSkill.SkillArgs
```

2. **Create Skill struct**:
```go
type Skill struct {
    Name string
    Slug string
    Org  string
    Args *SkillArgs
}
```

3. **Implement New() and Context registration**:
```go
func New(ctx Context, name string, args *SkillArgs) (*Skill, error)
```

4. **Add builder methods for common operations**

**Validation**: `go build ./skill/... && go test ./skill/...`

### Task 3.4: Apply Unified Pattern to Workflow

**Goal**: Update `workflow/` package to follow established pattern.

**Current State**:
- `workflow/workflow.go` - Has Workflow struct
- Complex task system with many task types

**Required Changes**:

1. **Verify Args alias**:
```go
type WorkflowArgs = genWorkflow.WorkflowArgs
```

2. **Verify struct follows pattern**:
```go
type Workflow struct {
    Name  string
    Slug  string
    Org   string
    Args  *WorkflowArgs
    Tasks []Task  // Task hierarchy
}
```

3. **Verify New() signature and Context registration**

4. **Add RequireSecret/RequireConfig methods** (parity with Agent):
```go
func (w *Workflow) RequireSecret(name, description string) *Workflow
func (w *Workflow) RequireConfig(name, defaultValue, description string) *Workflow
```

**Validation**: `go build ./workflow/... && go test ./workflow/...`

### Task 4.1: Fix Pre-existing Test Failures

**Known Issues**:
- `examples_test.go` - Undefined protobuf enum types
- `mcpserver/proto_test.go` - Type conversion issues
- `stigmer/context_test.go` - Old Agent.Instructions field references

**Approach**: Fix each test file, ensure all tests pass.

### Task 4.2: Update Examples

Review and update all examples in `examples/` to use the unified API:
- Consistent import patterns
- Use `commons/ref/` for all references
- Remove deprecated patterns

### Task 4.3: Update Documentation

Update documentation to reflect unified pattern:
- `README.md` - Quick start examples
- `docs/architecture/` - Pattern explanation
- `docs/guides/` - Usage guides

---

## Quality Gates

After each task:

```bash
cd sdk/go
go build ./...
go test ./...
```

**Standards**:
1. **Args is single source of truth** - No duplication
2. **Generated code untouched** - `gen/` is read-only
3. **Consistent naming** - `New()`, `Args`, builder methods
4. **Thread-safe** - Mutex for concurrent access
5. **Clear errors** - Contextual error messages

---

## What This Plan Does NOT Include

The following were considered but **rejected** as unnecessary complexity:

| Rejected Approach | Why Rejected |
|-------------------|--------------|
| `domain/` pure entities | Proto types work fine, no need for abstraction |
| `infra/proto/` adapters | Proto conversion in same package is simpler |
| `api/` builder layer | Builder methods on resource struct is sufficient |
| `app/` orchestration layer | `stigmer/context.go` handles this already |
| Separate SubAgent package | SubAgent is part of Agent aggregate |
| Domain value objects | Generated Args struct is the value object |

**Philosophy**: The SDK should be simple to use and maintain. Complex architectural patterns add cognitive load without corresponding benefit for this use case.

---

## Summary

This plan ensures all SDK resources follow one simple, consistent pattern:

```go
// 1. Import the resource package
import "github.com/stigmer/stigmer/sdk/go/agent"

// 2. Create with Name + Args
ag, err := agent.New(ctx, "my-agent", &agent.AgentArgs{
    Instructions: "...",
})

// 3. Use builder methods
ag.AddSkill("org/slug").
   UseMCP("github", "create_pr").
   RequireSecret("API_KEY", "description")

// 4. Synthesis happens automatically via Context
```

No DDD layers. No complex adapters. Just simple, practical code.
