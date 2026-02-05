# Reconciliation Value Objects Foundation - A2 Implementation

**Date**: February 5, 2026

## Summary

Implemented world-class foundational value objects for the Project reconciliation engine - ResourceKey, DesiredState, and ActualState. These immutable types form the core of the "desired vs actual state" comparison that powers Project-based deployments, enabling the reconciliation engine to compute intelligent diffs and execute atomic resource updates. This implementation follows the port plan from stigmer-cloud (Java) to stigmer OSS (Go), establishing patterns for the remaining reconciliation components.

## Problem Statement

The Project entity needs a reconciliation engine to compare desired state (from `Project.Spec` containing embedded resources) with actual state (from repositories) to compute what needs to be created, updated, or deleted. Before implementing the reconciliation algorithms, we need robust, type-safe value objects that:

1. Uniquely identify resources across different kinds (agents, workflows, MCP servers, skills)
2. Represent desired state parsed from Project specs with immutability guarantees
3. Represent actual state fetched from repositories with safe access patterns
4. Provide O(1) lookups and deterministic ordering for reconciliation algorithms

### Pain Points

- No type-safe way to reference resources in reconciliation context
- Risk of accidental mutation during reconciliation operations
- Need defensive copying patterns to prevent external state corruption
- Requires deterministic ordering for reproducible reconciliation and tests
- Go interface nil gotcha needs explicit handling for proto.Message returns

## Solution

Created three foundational value objects in the `reconcile` package:

1. **ResourceKey**: Type-safe composite key `"{kind}:{slug}"` with validation
2. **DesiredState**: Immutable state parsed from Project.Spec
3. **ActualState**: Immutable state fetched from repositories with ID extraction

All types follow strict immutability patterns with unexported fields, factory functions, and defensive copying.

## Implementation Details

### ResourceKey (`resource_key.go` - 140 lines)

Type-safe composite key that prevents string confusion:

```go
key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
fmt.Println(key.String()) // "agent:my-agent"
```

**Key features:**
- Factory functions: `NewResourceKey()` with validation, `MustResourceKey()` for tests
- String parsing: `ParseResourceKey("agent:my-agent")` 
- Validation: Rejects empty slugs and unsupported kinds
- Implements `fmt.Stringer` and is comparable (usable as map key)
- Supported kinds: agent, workflow, mcp_server, skill

### DesiredState (`desired_state.go` - 197 lines)

Immutable representation of "what should exist" from Project.Spec:

```go
desired := NewDesiredState(
    map[string]*agentv1.Agent{"my-agent": agent},
    map[string]*workflowv1.Workflow{"pipeline": workflow},
    nil, nil,
)
```

**Key features:**
- Defensive copying on construction and getters using `maps.Clone()`
- Nil-safe: nil maps become empty maps
- Singleton `EmptyDesiredState()` for efficiency
- Deterministic `AllResourceKeys()` - sorted by kind, then alphabetically by slug
- O(1) lookups via `HasResource(key)`
- Getters return defensive copies: `Agents()`, `Workflows()`, etc.

### ActualState (`actual_state.go` - 232 lines)

Immutable representation of "what currently exists" from repositories:

```go
actual := NewActualState(
    agentRepo.FindByProjectID(projectID),
    workflowRepo.FindByProjectID(projectID),
    // ...
)
```

**Key features:**
- Same immutability pattern as DesiredState
- `GetResource(key)` returns `proto.Message` for generic diff handling
- Fixed Go interface nil gotcha: explicit nil checks before interface return
- `GetResourceID(key)` extracts `metadata.id` for update operations
- Type-safe getters: `GetAgent()`, `GetWorkflow()`, `GetMcpServer()`, `GetSkill()`

### Test Coverage (27 test functions, 82 test runs)

**resource_key_test.go** (10 tests):
- Valid key creation for all supported kinds
- Empty slug rejection
- Unsupported kind rejection
- String formatting and parsing
- Equality and map key usage

**desired_state_test.go** (8 tests):
- Empty state singleton
- Resource creation and counting
- Nil map handling
- Defensive copy verification
- Deterministic key ordering
- Resource existence checks

**actual_state_test.go** (9 tests):
- Empty state singleton
- Defensive copy verification
- Generic resource retrieval
- Resource ID extraction
- Type-safe getter methods

### Build Configuration

Created `BUILD.bazel` with proper dependencies:
- Proto stubs for all resource types
- ApiResourceKind enums
- Google protobuf for proto.Message interface
- Test configuration with embed pattern

## Architecture Decisions

### 1. ResourceKey as Dedicated Type (vs Static Methods)

Unlike Java (which uses static methods on DesiredState), Go benefits from a dedicated type:
- Type safety prevents passing regular strings
- Methods attach naturally: `key.Kind()`, `key.Slug()`, `key.String()`
- Comparable: Can be used as map keys directly
- Validation at construction (fail-fast)

### 2. Defensive Copying Strategy

All value objects use `maps.Clone()` for shallow copies:
- Input maps cloned in constructors
- Output maps cloned in getters
- Prevents external mutation of internal state
- Proto message pointers are shared (proto messages are immutable)

### 3. Singleton Empty States

`EmptyDesiredState()` and `EmptyActualState()` return singleton instances:
- More efficient than creating new empty states
- Common in reconciliation (empty initial state)
- Safe because states are immutable

### 4. Deterministic Ordering

`AllResourceKeys()` returns keys in deterministic order:
- By kind: agents → workflows → mcp_servers → skills
- Alphabetically by slug within each kind
- Critical for reproducible tests and predictable reconciliation

### 5. Go Interface Nil Gotcha Fix

`ActualState.GetResource()` explicitly checks for nil before returning:
```go
if agent := s.agents[key.Slug()]; agent != nil {
    return agent
}
return nil
```
Without this, a nil pointer wrapped in an interface is not equal to nil.

## Benefits

**Type Safety**:
- ResourceKey prevents accidental string misuse
- Compile-time checking for resource kind operations
- Clear intent in function signatures

**Immutability**:
- Thread-safe by design
- No accidental mutation during reconciliation
- Can be safely passed between goroutines

**Performance**:
- O(1) lookups via map keys
- Efficient singleton empty states
- Minimal allocations with defensive copying

**Testability**:
- Deterministic ordering enables reproducible tests
- `MustResourceKey()` simplifies test construction
- Clear factory functions for test fixtures

**Developer Experience**:
- Clear, self-documenting APIs
- Comprehensive godoc comments
- Usage examples in README

## Impact

**Immediate**:
- Enables Phase A (remaining value objects)
- Establishes immutability patterns for entire reconcile package
- Provides foundation for dependency graph and diff algorithm

**Future**:
- Pattern will be reused in ChangeType, ResourceChange, ReconciliationPlan
- Type-safe keys prevent entire class of bugs in reconciliation logic
- Deterministic ordering makes debugging easier

**Code Quality**:
- All functions under 50 lines
- All files under 300 lines
- Zero linter errors
- 100% test pass rate
- Comprehensive godoc

## Files Created

```
backend/services/stigmer-server/pkg/domain/project/reconcile/
├── resource_key.go          # 140 lines - Type-safe composite key
├── resource_key_test.go     # 209 lines - 10 test functions
├── desired_state.go         # 197 lines - Desired state value object
├── desired_state_test.go    # 247 lines - 8 test functions
├── actual_state.go          # 232 lines - Actual state value object
├── actual_state_test.go     # 285 lines - 9 test functions
├── BUILD.bazel              # 37 lines - Bazel build configuration
└── README.md                # 167 lines - Package documentation
```

**Total**: 8 files, ~1,514 lines (including tests and docs)

## Verification

✅ `bazel build //backend/services/stigmer-server/pkg/domain/project/reconcile:reconcile`  
✅ `bazel test //backend/services/stigmer-server/pkg/domain/project/reconcile:reconcile_test`  
✅ All 82 test runs pass (27 test functions with subtests)  
✅ `go vet ./...` clean  
✅ `gofmt -l .` clean  
✅ No linter errors

## Related Work

**Upstream Reference**:
- Java DesiredState: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/project/reconcile/DesiredState.java`
- Java ActualState: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/project/reconcile/ActualState.java`

**Port Plan**:
- Follows plan: `_projects/2026-01/20260131.02.cli-agent-yaml-first/plans/project_entity_backend_port_c1003d86.plan.md`
- Phase A2 of the Project Entity Backend Port

**Next Steps**:
- A3: Reconciliation Value Objects - Plan (ChangeType, ResourceChange, ReconciliationPlan, Result, Options)
- B1: Dependency Graph (TopologicalSort, ReverseSort, DetectCycle)
- B2: Dependency Discoverer (proto reflection)

## Notes

**Go Idiomatic Patterns**:
- Used `maps.Clone()` from Go 1.21+ standard library
- Followed Go naming conventions (exported factory functions)
- Comprehensive godoc comments with usage examples

**Immutability Achievement**:
- Unexported struct fields (lowercase)
- Factory functions only
- Defensive copying on input and output
- No setter methods anywhere

**Test Quality**:
- Table-driven tests with `t.Run()` for subtests
- Helper functions for proto fixture creation
- Descriptive test names explaining what's being tested
- Edge case coverage (nil maps, empty strings, unsupported kinds)

---

**Status**: ✅ Production Ready  
**Timeline**: ~2 hours (design + implementation + tests + verification)  
**Test Coverage**: 27 test functions, 82 test runs, 100% pass rate
