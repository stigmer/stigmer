# Remove Anemic Accessor Methods from SDK

**Date**: February 6, 2026

## Summary

Removed redundant accessor methods from Agent and Environment packages that simply delegated to public `Args` fields without providing any encapsulation or computation. This change aligns the SDK with Pulumi's direct field access pattern and eliminates architectural inconsistency across resources. The refactoring touched 19 files, removing ~52 lines of anemic code and updating all usages to use direct field access.

## Problem Statement

The Agent and Environment packages contained accessor methods that violated clean architecture principles by being anemic - they provided no value beyond simple field delegation.

### Pain Points

- **Anemic Model Anti-Pattern**: Methods like `Instructions()`, `Description()`, `IconURL()`, `SkillRefs()`, and `McpServerUsages()` simply returned `Args` field values with nil-checks
- **Only Used for Logging**: 100% of accessor method usage was in examples, tests, and logging - never in core SDK logic
- **Architectural Inconsistency**: Agent had 5 accessors, Environment had 2, MCPServer had 1 (computed), Workflow had 0 - creating cognitive load
- **Contradicts Pulumi Pattern**: Pulumi resources expose fields directly; our accessors created unnecessary indirection
- **Redundancy**: Since `Args` is public, users could already access fields directly (`agent.Args.Instructions`)
- **False Encapsulation**: Nil-safety checks in accessors provided no real benefit since `New()` always initializes `Args`

## Solution

Removed all anemic accessor methods and updated the codebase to use direct field access following the Pulumi pattern: `resource.Args.Field` instead of `resource.Field()`.

**Methods Removed**:
- **Agent**: `Instructions()`, `Description()`, `IconURL()`, `SkillRefs()`, `McpServerUsages()`
- **Environment**: `Description()`, `Data()`

**Kept Valid Patterns**:
- `MCPServer.ServerType()` - computes derived state from multiple Args fields (valid domain logic)
- `Skill.IsLocal()`, `IsGit()`, etc. - access private fields (proper encapsulation)
- All `String()` methods - implement `Stringer` interface
- All `ToProto()` methods - conversion interface

## Implementation Details

### Files Modified

**Core Packages** (2 files):
- `agent/agent.go` - Removed 44 lines of accessor methods (lines 156-198)
- `environment/environment.go` - Removed 20 lines of accessor methods (lines 200-218)

**Examples** (6 files):
- Updated all examples to use direct field access: `agent.Args.Instructions`, `agent.Args.SkillRefs`, etc.

**Tests** (8 files):
- Updated all test assertions to use direct field access
- Removed invalid test `TestEnvironment_NilArgs_Accessors` (tested now-invalid scenario)

**Documentation** (3 files):
- Updated README and getting-started guide to show direct field access pattern
- Updated package docs to reference correct API

### Pattern Change

```go
// Before (accessor method)
fmt.Printf("Instructions: %s\n", agent.Instructions())
fmt.Printf("Skills: %d\n", len(agent.SkillRefs()))

// After (direct field access - Pulumi pattern)
fmt.Printf("Instructions: %s\n", agent.Args.Instructions)
fmt.Printf("Skills: %d\n", len(agent.Args.SkillRefs))
```

### Validation Results

- **Build**: SUCCESS - All packages compile cleanly
- **Vet**: SUCCESS - No issues found
- **Tests**: All core SDK tests passing
  - `agent`: PASS
  - `environment`: PASS  
  - `stigmer`: PASS
- **Examples**: 16/19 passing (3 pre-existing failures in workflow examples 09, 10, 11 due to unrelated enum conversion bugs)

## Benefits

### Code Quality
- **Removed 52 lines** of anemic boilerplate code
- **Eliminated false encapsulation** - Args fields were already public
- **Cleaner architecture** - no more delegation methods that add zero value

### Developer Experience
- **Consistent pattern** - All resources now use the same field access pattern
- **Aligns with Pulumi** - Developers familiar with Pulumi will find this natural
- **Less to learn** - One pattern instead of mix of accessors and direct access
- **More explicit** - `agent.Args.Instructions` makes it clear you're accessing configuration

### Maintainability
- **Less code to maintain** - Fewer methods to keep in sync with Args fields
- **No method duplication** - When Args fields change, no need to update accessor methods
- **Clearer intent** - Direct field access is more transparent than method delegation

## Impact

### Breaking Change
This is a **breaking change** for code using the accessor methods. Migration is straightforward:

```go
// Simple find/replace pattern
agent.Instructions()    → agent.Args.Instructions
agent.Description()     → agent.Args.Description
agent.IconURL()         → agent.Args.IconUrl
agent.SkillRefs()       → agent.Args.SkillRefs
agent.McpServerUsages() → agent.Args.McpServerUsages
env.Description()       → env.Args.Description
env.Data()              → env.Args.Data
```

### Affected Components
- **SDK Examples**: All updated in this changeset
- **SDK Tests**: All updated in this changeset
- **External Users**: Will need to update their code when they upgrade

### Architecture Consistency
All SDK resources now follow the same pattern:
- **Agent**: Direct Args access ✅
- **Environment**: Direct Args access ✅
- **MCPServer**: Direct Args access ✅ (with computed `ServerType()` method)
- **Skill**: Private fields with proper accessors ✅
- **Workflow**: Direct Args access ✅

## Related Work

This refactoring was identified during architectural review of the SDK unified resource pattern project. Key references:

- **Pulumi SDK Research**: Analyzed how Pulumi handles resource field access (direct public fields, no accessor methods)
- **DDD Analysis**: Identified accessor methods as anemic model anti-pattern
- **Usage Analysis**: Confirmed accessor methods were only used for logging, never in business logic
- **Consistency Review**: Found inconsistent accessor patterns across resources

## Technical Notes

### Why MCPServer.ServerType() Was Kept

Unlike the removed accessor methods, `ServerType()` is a **computed derived value**:

```go
func (m *MCPServer) ServerType() string {
    if m.Args.Stdio != nil { return "stdio" }
    if m.Args.Http != nil { return "http" }
    return "unknown"
}
```

This method encapsulates business logic (determining server type from configuration), making it a valid domain method rather than an anemic accessor.

### Why Skill Accessors Were Kept

Skill's accessor methods (`IsLocal()`, `LocalPath()`, `GitURL()`, etc.) access **private fields**, providing proper encapsulation:

```go
type Skill struct {
    // Private fields - proper encapsulation
    sourceType sourceType
    localPath  string
    gitURL     string
    // ...
}

func (s *Skill) LocalPath() string {
    return s.localPath  // Accessor provides controlled access to private field
}
```

---

**Status**: ✅ Production Ready  
**Timeline**: Completed in single session (February 6, 2026)  
**Net Impact**: -52 lines of code, +architectural consistency
