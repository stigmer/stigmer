# Fix SubAgent Implementation: Args as Single Source of Truth

**Date**: February 6, 2026

## Summary

Eliminated the duplicate SubAgent implementation in the Agent SDK by removing the custom `agent.SubAgent` type and making `Args.SubAgents` the single source of truth. This change removes ~450 lines of duplicate code, aligns SubAgent handling with the established unified resource pattern, and prevents state synchronization bugs between the custom SDK type and the proto-generated Args field.

## Problem Statement

The Agent SDK violated the "Args is single source of truth" principle that was established for all SDK resources. SubAgents had two separate representations:

1. **Custom SDK type**: `agent.SubAgent` with private fields, builder methods, and conversion logic
2. **Generated proto type**: `Args.SubAgents []*agentv1.SubAgent` from the protobuf definition

This duplication created several issues:
- Risk of `Agent.SubAgents` and `Args.SubAgents` getting out of sync
- ~450 lines of unnecessary wrapper code
- Inconsistent pattern compared to Environment, SkillRefs, and McpServerUsages
- Complex conversion logic in `ToProto()` that ignored `Args.SubAgents`

### Pain Points

- **Pattern inconsistency**: Environment uses proto types directly in Args, but Agent had custom SubAgent wrapper
- **Duplicate state**: Two places to store SubAgents with no synchronization
- **Maintenance burden**: Changes to SubAgent proto required updating both wrapper and conversion code
- **Confusion**: Developers unsure whether to use `Agent.SubAgents` or `Args.SubAgents`

## Solution

Removed the custom `agent.SubAgent` type entirely and use `*agentv1.SubAgent` proto type directly in `Args.SubAgents`. Replaced the custom type with ergonomic helper functions that create proto SubAgents while maintaining developer experience.

**Key decisions**:
1. Delete custom `agent.SubAgent` struct and all related code
2. Change `AddSubAgent(*agentv1.SubAgent)` to accept proto type
3. Remove `convertSubAgents()` from `ToProto()` - use `Args.SubAgents` directly
4. Provide helper functions: `NewSubAgent()`, `BuildSubAgent()` for ergonomic API

## Implementation Details

### Files Deleted (447 lines)
- `sdk/go/agent/subagent.go` (352 lines) - Custom SubAgent struct with private fields and builder methods
- `sdk/go/agent/subagent_parsing.go` (95 lines) - SubAgent-specific skill reference parsing

### Files Modified

**`agent/agent.go`** (~50 lines changed):
- Removed `SubAgents []SubAgent` field from Agent struct
- Updated `New()` to not initialize separate SubAgents slice
- Changed `AddSubAgent(sub *agentv1.SubAgent)` to append to `Args.SubAgents`
- Changed `AddSubAgents(subs ...*agentv1.SubAgent)` to use proto types

**`agent/proto.go`** (~45 lines changed):
- Deleted `convertSubAgents()` function entirely (30 lines)
- `ToProto()` now directly uses `spec.SubAgents = a.Args.SubAgents`

**`agent/errors.go`** (~70 lines removed):
- Removed `ErrSubAgentOrgRequired`, `ErrSubAgentEmptyRef`, etc.
- Removed `SubAgentRefParseError` struct and methods

### Files Created

**`agent/subagent_helpers.go`** (149 lines):
Provides ergonomic API for creating proto SubAgents:

```go
// Simple constructor
func NewSubAgent(name, instructions string) *agentv1.SubAgent

// With description
func NewSubAgentWithDescription(name, instructions, description string) *agentv1.SubAgent

// Fluent builder
func BuildSubAgent(name, instructions string) *SubAgentBuilder
func (b *SubAgentBuilder) Description(desc string) *SubAgentBuilder
func (b *SubAgentBuilder) GrantMcpAccess(server string, tools ...string) *SubAgentBuilder
func (b *SubAgentBuilder) AddSkillRef(ref *apiresource.ApiResourceReference) *SubAgentBuilder
func (b *SubAgentBuilder) Build() *agentv1.SubAgent
```

### Tests Updated

**`agent/agent_subagents_test.go`** - Completely rewritten (200 lines changed):
- All tests now use `NewSubAgent()` or `BuildSubAgent()`
- Access SubAgents via `agent.Args.SubAgents` instead of `agent.SubAgents`
- Verify proto field access: `sub.Name`, `sub.McpAccess`, `sub.SkillRefs`

**`agent/agent_builder_test.go`** (~50 lines changed):
- Updated SubAgent builder tests to use new helpers
- Changed assertions to check `Args.SubAgents` instead of custom field

**`agent/edge_cases_test.go`** (~6 lines):
- Fixed nil slice tests to reference `Args.SubAgents`

### Example Updated

**`examples/04_agent_with_subagents.go`** (~210 lines changed):
- Demonstrates `NewSubAgent()` for simple cases
- Demonstrates `BuildSubAgent()` for complex configurations with MCP access and skills
- Shows direct proto usage for advanced scenarios

## Benefits

1. **Eliminated duplication**: Removed 447 lines of duplicate code (subagent.go + subagent_parsing.go)
2. **Single source of truth**: SubAgents only exist in `Args.SubAgents`
3. **Pattern consistency**: Matches how Environment, SkillRefs, and McpServerUsages work
4. **Simpler ToProto()**: Removed 30 lines of conversion logic
5. **No sync bugs**: Impossible for SDK and Args to get out of sync
6. **Cleaner API**: Proto types used directly, no SDK-specific wrapper needed
7. **Maintained ergonomics**: Helper functions preserve developer experience

## Impact

### Affected Code
- Agent package: Core implementation simplified
- Tests: All SubAgent tests updated to new API
- Examples: One example updated to demonstrate new patterns
- External users: Breaking change - must update to new API

### Migration Path
Old code:
```go
sub, _ := agent.NewSubAgent("helper", &agent.SubAgentArgs{
    Instructions: "Help with tasks",
})
sub.GrantMcpAccess("github", "search_code")
agent.AddSubAgent(sub)
```

New code:
```go
sub := agent.BuildSubAgent("helper", "Help with tasks").
    GrantMcpAccess("github", "search_code").
    Build()
agent.AddSubAgent(sub)
```

### Breaking Changes
- `agent.SubAgent` type removed - use `*agentv1.SubAgent` directly
- `agent.NewSubAgent(name, *SubAgentArgs)` signature changed to helper functions
- `agent.AddSubAgent(SubAgent)` now takes `*agentv1.SubAgent`
- Access via `agent.Args.SubAgents` instead of `agent.SubAgents`

## Related Work

This change is part of the broader "SDK Unified Resource Pattern" project:
- Task 3.1: SubAgent consolidation (this changelog)
- Previous: Task 2.2 - Environment unified as first-class resource
- Previous: Task 2.1 - Created commons/ref/ package for references
- Next: Task 3.2 - Apply pattern to McpServer

**Plan reference**: `_projects/2026-02/20260205.01.sdk-all-resources/plans/sdk_layer_reorganization_d0769037.plan.md`

---

**Status**: ✅ Complete - All tests passing  
**Code Impact**: -1,872 insertions, +601 deletions (net -1,271 lines)  
**Files Changed**: 11 files modified, 2 files deleted, 1 file created
