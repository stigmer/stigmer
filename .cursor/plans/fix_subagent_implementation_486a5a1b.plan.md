---
name: Fix SubAgent Implementation
overview: Remove the duplicate SubAgent field from Agent struct and custom SubAgent type. SubAgents should ONLY exist in Args.SubAgents (proto type), following the established "Args is single source of truth" principle.
todos:
  - id: fix-agent-struct
    content: Remove SubAgents field from Agent struct and update New()/AddSubAgent() methods
    status: completed
  - id: delete-subagent-file
    content: Delete agent/subagent.go entirely
    status: completed
  - id: delete-subagent-parsing
    content: Delete agent/subagent_parsing.go entirely
    status: completed
  - id: update-proto-go
    content: Remove convertSubAgents(), use Args.SubAgents directly in ToProto()
    status: completed
  - id: update-errors
    content: Remove SubAgent-specific errors from errors.go
    status: completed
  - id: add-helper-functions
    content: Add NewSubAgent() and optional SubAgentBuilder helper functions
    status: completed
  - id: update-tests
    content: Update all test files to use proto SubAgent type
    status: completed
  - id: update-example
    content: Update 04_agent_with_subagents.go example
    status: completed
  - id: verify-build
    content: Run go build ./... && go test ./... to verify everything works
    status: completed
isProject: false
---

# Fix SubAgent Implementation: Args as Single Source of Truth

## The Problem

The current implementation violates the **"Args is single source of truth"** principle:

**Current (Wrong):**

- `Agent.Args.SubAgents []*agentv1.SubAgent` - in generated Args (correct location)
- `Agent.SubAgents []SubAgent` - DUPLICATE separate field with custom SDK type

**Generated AgentArgs already has SubAgents:**

```go
// gen/agent/agentspec_args.go (line 51)
SubAgents []*agentv1.SubAgent `json:"subAgents,omitempty"`
```

**But Agent struct has a duplicate field:**

```go
// agent/agent.go (line 65)
SubAgents []SubAgent  // WRONG - duplicates Args.SubAgents
```

**And ToProto ignores Args.SubAgents:**

```go
// agent/proto.go (line 50-51)
subAgents, err := convertSubAgents(a.SubAgents)  // Uses custom type
spec.SubAgents = subAgents  // Ignores Args.SubAgents entirely
```

## The Correct Pattern

Following Environment and other resources - use proto types directly:

```go
type Agent struct {
    Name string
    Slug string
    Org  string
    Args *AgentArgs  // Args.SubAgents is THE ONLY source for SubAgents
    ctx  Context
    mu   sync.Mutex
    // NO SubAgents field here
}

// Helper function creates proto SubAgent (ergonomic API)
func NewSubAgent(name, instructions string, opts ...SubAgentOption) *agentv1.SubAgent

// Builder adds directly to Args.SubAgents
func (a *Agent) AddSubAgent(sub *agentv1.SubAgent) *Agent {
    a.Args.SubAgents = append(a.Args.SubAgents, sub)
    return a
}
```

## Changes Required

### 1. [agent/agent.go](sdk/go/agent/agent.go)

**Remove the duplicate `SubAgents` field:**

```go
type Agent struct {
    Name string
    Slug string
    Org  string
    Args *AgentArgs
    // DELETE: SubAgents []SubAgent  <-- REMOVE THIS
    ctx  Context
    mu   sync.Mutex
}
```

**Update `New()` - remove SubAgents initialization:**

```go
a := &Agent{
    Name: name,
    Args: args,
    ctx:  ctx,
    // DELETE: SubAgents: []SubAgent{},
}
```

**Update `AddSubAgent()` to use proto type:**

```go
// AddSubAgent adds a sub-agent to Args.SubAgents (single source of truth).
func (a *Agent) AddSubAgent(sub *agentv1.SubAgent) *Agent {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.Args.SubAgents = append(a.Args.SubAgents, sub)
    return a
}
```

**Update `AddSubAgents()` to use proto type:**

```go
func (a *Agent) AddSubAgents(subs ...*agentv1.SubAgent) *Agent {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.Args.SubAgents = append(a.Args.SubAgents, subs...)
    return a
}
```

### 2. Delete [agent/subagent.go](sdk/go/agent/subagent.go)

The entire file (352 lines) should be deleted. The custom `SubAgent` type with private fields is unnecessary - use `*agentv1.SubAgent` directly.

**Replace with a simple helper function** (can be in agent/agent.go or a new small file):

```go
// NewSubAgent creates a proto SubAgent with the given name and instructions.
// This provides an ergonomic API while using the proto type directly.
func NewSubAgent(name, instructions string) *agentv1.SubAgent {
    return &agentv1.SubAgent{
        Name:         name,
        Instructions: instructions,
    }
}

// NewSubAgentWithDescription creates a SubAgent with description.
func NewSubAgentWithDescription(name, instructions, description string) *agentv1.SubAgent {
    return &agentv1.SubAgent{
        Name:         name,
        Instructions: instructions,
        Description:  description,
    }
}
```

**If needed, provide SubAgent builder helpers:**

```go
// SubAgentBuilder provides a fluent API for building SubAgents.
type SubAgentBuilder struct {
    sub *agentv1.SubAgent
}

func BuildSubAgent(name, instructions string) *SubAgentBuilder {
    return &SubAgentBuilder{
        sub: &agentv1.SubAgent{Name: name, Instructions: instructions},
    }
}

func (b *SubAgentBuilder) Description(desc string) *SubAgentBuilder {
    b.sub.Description = desc
    return b
}

func (b *SubAgentBuilder) GrantMcpAccess(mcpServer string, tools ...string) *SubAgentBuilder {
    b.sub.McpAccess = append(b.sub.McpAccess, &agentv1.McpAccess{
        McpServer:    mcpServer,
        EnabledTools: tools,
    })
    return b
}

func (b *SubAgentBuilder) AddSkillRef(ref *apiresource.ApiResourceReference) *SubAgentBuilder {
    b.sub.SkillRefs = append(b.sub.SkillRefs, ref)
    return b
}

func (b *SubAgentBuilder) Build() *agentv1.SubAgent {
    return b.sub
}
```

### 3. Delete [agent/subagent_parsing.go](sdk/go/agent/subagent_parsing.go)

This file (95 lines) is no longer needed. If any parsing functions are useful, move them to [agent/parsing.go](sdk/go/agent/parsing.go).

### 4. Update [agent/proto.go](sdk/go/agent/proto.go)

**Remove `convertSubAgents()` function entirely** (lines 99-128).

**Update `ToProto()` to use Args.SubAgents directly:**

```go
func (a *Agent) ToProto() (*agentv1.Agent, error) {
    // ... existing code ...

    spec := &agentv1.AgentSpec{
        Description:     a.Args.Description,
        IconUrl:         a.Args.IconUrl,
        Instructions:    a.Args.Instructions,
        SkillRefs:       a.Args.SkillRefs,
        McpServerUsages: a.Args.McpServerUsages,
        SubAgents:       a.Args.SubAgents,  // Direct from Args - NO CONVERSION
        EnvSpec:         a.Args.EnvSpec,
    }

    // ... rest of validation ...
}
```

### 5. Update [agent/errors.go](sdk/go/agent/errors.go)

Remove SubAgent-specific errors if they're no longer needed:

- `ErrSubAgentOrgRequired`
- `SubAgentRefParseError`

### 6. Update Tests

**[agent/agent_subagents_test.go](sdk/go/agent/agent_subagents_test.go):**

- Update to use `*agentv1.SubAgent` or the new helper functions
- Remove tests for deleted custom SubAgent type

**[agent/agent_builder_test.go](sdk/go/agent/agent_builder_test.go):**

- Update any SubAgent-related tests

**[agent/error_cases_test.go](sdk/go/agent/error_cases_test.go), [agent/edge_cases_test.go](sdk/go/agent/edge_cases_test.go):**

- Remove or update SubAgent-specific error tests

### 7. Update Example

**[examples/04_agent_with_subagents.go](sdk/go/examples/04_agent_with_subagents.go):**

```go
// Before (wrong):
sub, _ := agent.NewSubAgent("helper", &agent.SubAgentArgs{Instructions: "..."})
sub.GrantMcpAccess("github", "search_code")
ag.AddSubAgent(sub)

// After (correct):
sub := agent.BuildSubAgent("helper", "Help with analysis").
    Description("Security analyzer").
    GrantMcpAccess("github", "search_code").
    Build()
ag.AddSubAgent(sub)

// Or simpler:
ag.AddSubAgent(&agentv1.SubAgent{
    Name:         "helper",
    Instructions: "Help with analysis",
    McpAccess: []*agentv1.McpAccess{
        {McpServer: "github", EnabledTools: []string{"search_code"}},
    },
})
```

## Summary of Files to Change


| File                                  | Action                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| `agent/agent.go`                      | Remove SubAgents field, update AddSubAgent signature   |
| `agent/subagent.go`                   | DELETE entirely (352 lines)                            |
| `agent/subagent_parsing.go`           | DELETE entirely (95 lines)                             |
| `agent/proto.go`                      | Remove convertSubAgents(), use Args.SubAgents directly |
| `agent/errors.go`                     | Remove SubAgent-specific errors                        |
| `agent/agent_subagents_test.go`       | Rewrite tests for new API                              |
| `agent/agent_builder_test.go`         | Update SubAgent tests                                  |
| `agent/error_cases_test.go`           | Update/remove tests                                    |
| `agent/edge_cases_test.go`            | Update/remove tests                                    |
| `agent/proto_integration_test.go`     | Update tests                                           |
| `examples/04_agent_with_subagents.go` | Update to new API                                      |


## Validation

After changes:

```bash
cd sdk/go && go build ./... && go test ./...
```

## Why This Matters

1. **Single Source of Truth**: SubAgents live in Args.SubAgents only
2. **No Type Conversion**: Proto types used directly, no SDK-specific wrapper
3. **Simpler Code**: ~450 lines deleted, no duplicate state to manage
4. **Consistent Pattern**: Matches how Environment, SkillRefs, McpServerUsages work
5. **Fewer Bugs**: No risk of Args.SubAgents and Agent.SubAgents getting out of sync

