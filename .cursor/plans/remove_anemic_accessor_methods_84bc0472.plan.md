---
name: Remove Anemic Accessor Methods
overview: Remove redundant accessor methods from Agent and Environment that simply delegate to public Args fields, aligning with Pulumi's direct field access pattern and eliminating inconsistency across SDK resources.
todos:
  - id: remove-agent-accessors
    content: Remove 5 accessor methods from agent/agent.go (Instructions, Description, IconURL, SkillRefs, McpServerUsages)
    status: completed
  - id: remove-env-accessors
    content: Remove 2 accessor methods from environment/environment.go (Description, Data)
    status: completed
  - id: update-examples
    content: Update 6 example files to use direct field access (agent.Args.Instructions, etc.)
    status: completed
  - id: update-tests
    content: Update agent test files (edge_cases_test.go, parsing_test.go) to use direct field access
    status: completed
  - id: verify-build
    content: Run go build, go test, go vet to verify changes
    status: completed
isProject: false
---

# Remove Anemic Accessor Methods from SDK

## Problem Statement

The Agent and Environment packages have accessor methods that:

1. Simply delegate to public `Args` fields (no computation, no encapsulation)
2. Are only used for logging/examples - never in core SDK logic
3. Contradict Pulumi's direct field access pattern
4. Create inconsistency (Agent: 5 accessors, Workflow: 0)

## Methods to Remove

### Agent Package ([sdk/go/agent/agent.go](sdk/go/agent/agent.go))


| Method              | Current                   | Replacement                  |
| ------------------- | ------------------------- | ---------------------------- |
| `Instructions()`    | `agent.Instructions()`    | `agent.Args.Instructions`    |
| `Description()`     | `agent.Description()`     | `agent.Args.Description`     |
| `IconURL()`         | `agent.IconURL()`         | `agent.Args.IconUrl`         |
| `SkillRefs()`       | `agent.SkillRefs()`       | `agent.Args.SkillRefs`       |
| `McpServerUsages()` | `agent.McpServerUsages()` | `agent.Args.McpServerUsages` |


Lines 161-198 in `agent.go`:

```go
// DELETE these 5 methods (38 lines)
func (a *Agent) Instructions() string { ... }
func (a *Agent) Description() string { ... }
func (a *Agent) IconURL() string { ... }
func (a *Agent) SkillRefs() []*apiresource.ApiResourceReference { ... }
func (a *Agent) McpServerUsages() []*agentv1.McpServerUsage { ... }
```

### Environment Package ([sdk/go/environment/environment.go](sdk/go/environment/environment.go))


| Method          | Current             | Replacement            |
| --------------- | ------------------- | ---------------------- |
| `Description()` | `env.Description()` | `env.Args.Description` |
| `Data()`        | `env.Data()`        | `env.Args.Data`        |


Lines 205-218 in `environment.go`:

```go
// DELETE these 2 methods (14 lines)
func (e *Environment) Description() string { ... }
func (e *Environment) Data() map[string]*environmentv1.EnvironmentValue { ... }
```

## Methods to KEEP (Valid Patterns)


| Package   | Method                                      | Reason                                                  |
| --------- | ------------------------------------------- | ------------------------------------------------------- |
| MCPServer | `ServerType()`                              | **Computed** - derives from `Args.Stdio` vs `Args.Http` |
| Skill     | `IsLocal()`, `IsGit()`, `LocalPath()`, etc. | **Private fields** - fields are not exposed             |
| Context   | `Agents()`, `Workflows()`, etc.             | **Registry access** - computed from internal state      |
| All       | `String()`                                  | Implements `Stringer` interface                         |
| All       | `ToProto()`                                 | Conversion interface                                    |


## Files Requiring Updates

### Examples (update to direct field access)

- `examples/01_basic_agent.go` - 3 calls
- `examples/02_agent_with_skills.go` - 10 calls
- `examples/03_agent_with_mcp_servers.go` - 4 calls
- `examples/05_agent_with_environment_variables.go` - 2 calls
- `examples/06_agent_with_inline_content.go` - 6 calls
- `examples/12_agent_with_typed_context.go` - 3 calls

### Tests (update to direct field access)

- `agent/edge_cases_test.go` - 1 call
- `agent/parsing_test.go` - 12 calls

## Migration Pattern

```go
// Before (accessor method)
fmt.Printf("Instructions: %s\n", agent.Instructions())
fmt.Printf("Skills: %d\n", len(agent.SkillRefs()))

// After (direct field access)
fmt.Printf("Instructions: %s\n", agent.Args.Instructions)
fmt.Printf("Skills: %d\n", len(agent.Args.SkillRefs))
```

## Validation

```bash
cd sdk/go
go build ./...
go test ./...
go vet ./...
```

## Impact Analysis

- **Lines removed**: ~52 lines of accessor methods
- **Lines changed**: ~40 lines in examples/tests (simple find-replace)
- **Breaking change**: Yes - but aligns with established pattern
- **Consistency**: All resources now follow same pattern (direct Args access)

