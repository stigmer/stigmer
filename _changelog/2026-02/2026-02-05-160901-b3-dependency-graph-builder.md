# B3: Dependency Graph Builder Implementation

**Date**: February 5, 2026

## Summary

Implemented the Dependency Graph Builder (B3), a critical component that constructs immutable dependency graphs from DesiredState by discovering resource dependencies via proto reflection. This bridges the dependency discovery (B2) and graph traversal (B1) components, enabling correct reconciliation ordering for Project entity resources.

## Problem Statement

The Project reconciliation engine needs to create, update, and delete resources (agents, workflows, skills, MCP servers) in the correct order based on their dependencies. Without a dependency graph builder, the system cannot determine which resources must be created before others or which dependents must be deleted first.

### Pain Points

- No mechanism to convert DesiredState resources into a traversable dependency graph
- Risk of creating resources before their dependencies exist (order violations)
- Risk of deleting resources while dependents still reference them
- Need to filter external dependencies from internal project resources
- Must handle edge cases gracefully (nil states, invalid references)

## Solution

Created a focused, single-function API that:
1. Iterates through all resources in a DesiredState
2. Uses the existing DependencyDiscoverer to find ApiResourceReference fields via proto reflection
3. Filters to only internal dependencies (resources within the DesiredState)
4. Builds an immutable DependencyGraph using the existing DependencyGraphBuilder
5. Handles edge cases gracefully (nil states, invalid refs, external dependencies)

## Implementation Details

### Core Function: BuildDependencyGraph

```go
func BuildDependencyGraph(desired *DesiredState) *DependencyGraph
```

Simple, deterministic API with no configuration required. Returns `EmptyGraph()` for nil or empty states.

### Implementation Pattern

- **Single responsibility**: Only builds graphs from DesiredState
- **Leverages existing primitives**: Uses `DiscoverDependencies()` and `DependencyGraphBuilder`
- **Internal-only tracking**: External references filtered out automatically
- **Graceful degradation**: Invalid references silently skipped

### File Structure

**Production Code** (`graph_builder.go` - 85 lines):
- `BuildDependencyGraph()` - Main entry point
- `addDependenciesToBuilder()` - Helper to process individual resources

**Test Coverage** (`graph_builder_test.go` - 20 tests):
1. Basic Functionality (4 tests) - nil/empty handling, immutability
2. Single Resource Type (4 tests) - agents with skills, MCP servers, mixed deps
3. Dependency Filtering (4 tests) - external refs, invalid refs, deduplication
4. Multiple Resources (4 tests) - shared deps, independent chains
5. Real-World Scenarios (4 tests) - typical projects, sub-agents, complex topologies, topological sort integration

### Key Design Decisions

1. **Only track internal dependencies**: References to resources outside DesiredState are ignored, ensuring the graph only contains resources being reconciled

2. **No configuration needed**: Single function with deterministic behavior - simplicity over flexibility

3. **Reuse existing components**: DependencyDiscoverer (B2) and DependencyGraphBuilder (B1) handle the heavy lifting

4. **Graceful edge case handling**: Nil states return EmptyGraph, invalid references skipped silently

## Benefits

**Correctness**: Resources created in proper dependency order, preventing reference errors

**Safety**: Resources deleted in reverse dependency order, preventing orphaned references

**Simplicity**: Single-function API with no configuration complexity

**Testability**: 20 comprehensive tests covering all scenarios including edge cases

**Maintainability**: Minimal code (85 lines) leveraging existing, tested primitives

**Performance**: O(n) iteration through resources with O(1) lookups for internal validation

## Impact

**Reconciliation Engine**: Enables correct execution order for create/update/delete operations

**Project Controller**: Foundation for implementing the Apply handler that reconciles desired vs actual state

**Developer Experience**: Clear, simple API with predictable behavior and comprehensive test coverage

**Code Quality**: Maintains existing patterns (immutable value objects, defensive copying, comprehensive testing)

## Integration Points

**Consumes**:
- `DesiredState` - Input containing all resources to reconcile
- `DependencyDiscoverer` (B2) - Proto reflection to find dependencies
- `DependencyGraphBuilder` (B1) - Constructs immutable graph

**Produces**:
- `DependencyGraph` - Immutable graph supporting topological sort for reconciliation ordering

**Used By** (upcoming):
- Reconciliation Service (E1) - Will use to order resource operations
- Diff Algorithm (C1) - Will use to ensure dependency-aware change ordering

## Related Work

- **B1: DependencyGraph** - Provides the immutable graph data structure with topological sort
- **B2: DependencyDiscoverer** - Provides proto reflection to find ApiResourceReference fields
- **A2: DesiredState** - Provides the input state containing resources to graph
- **C1: Diff Algorithm** (next) - Will use this graph to order changes correctly

## Build Verification

All quality checks passed:
- ✅ Bazel build successful
- ✅ All 20 tests passing (0.9s)
- ✅ `go vet` clean
- ✅ `gofmt` compliant
- ✅ BUILD.bazel updated correctly

---

**Status**: ✅ Production Ready  
**Timeline**: Single session implementation (~1.5 hours)  
**Test Coverage**: 20 comprehensive tests covering all scenarios  
**Lines of Code**: 85 production, ~700 test
