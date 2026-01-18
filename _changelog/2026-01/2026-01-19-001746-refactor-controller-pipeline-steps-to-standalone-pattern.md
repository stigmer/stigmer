# Refactor Controller Pipeline Steps to Standalone Pattern

**Date**: 2026-01-19  
**Type**: Refactoring  
**Scope**: Backend Controllers (Agent, AgentExecution, AgentInstance)  
**Impact**: Internal code quality improvement

## Summary

Refactored all controller pipeline steps across agent, agentexecution, and agentinstance controllers to use the **standalone step pattern** instead of the **CDOT (Controller Dot) pattern**. This improves testability, maintainability, and follows dependency injection best practices.

## Problem

Pipeline steps were using the CDOT pattern where:
- Steps held a reference to the entire controller
- Factory methods were controller methods (`c.newStepName()`)
- Steps accessed dependencies through the controller (`s.controller.store`)

This created tight coupling between steps and controllers, making:
- Steps difficult to test in isolation
- Dependencies unclear (hidden in controller)
- Code harder to maintain and understand

## Solution

Converted all steps to the standalone pattern where:
- Steps hold only their required dependencies (e.g., `store *badger.Store`)
- Factory functions are standalone (`newStepName(deps...)`)
- Dependencies are explicitly injected through constructors

### Pattern Comparison

**Before (CDOT Pattern)**:
```go
// Step held controller reference
type validateListRequestStep struct {
    controller *AgentExecutionController
}

// Factory was a controller method
func (c *AgentExecutionController) newValidateListRequestStep() *validateListRequestStep {
    return &validateListRequestStep{controller: c}
}

// Usage accessed controller fields
data, err := s.controller.store.ListResources(...)
```

**After (Standalone Pattern)**:
```go
// Step holds only required dependencies
type queryAllExecutionsStep struct {
    store *badger.Store
}

// Factory is a standalone function
func newQueryAllExecutionsStep(store *badger.Store) *queryAllExecutionsStep {
    return &queryAllExecutionsStep{store: store}
}

// Usage uses injected dependencies
data, err := s.store.ListResources(...)
```

## Files Changed

### Agent Controller (2 steps refactored)

**`backend/services/stigmer-server/pkg/controllers/agent/create.go`**:
- `createDefaultInstanceStep` - Now takes `*agentinstance.Client` directly
- `updateAgentStatusWithDefaultInstanceStep` - Now takes `*badger.Store` directly

### AgentExecution Controller (11 steps refactored)

**`backend/services/stigmer-server/pkg/controllers/agentexecution/create.go`**:
- `validateSessionOrAgentStep` - No dependencies (standalone)
- `createDefaultInstanceIfNeededStep` - Now takes `*agent.Client`, `*agentinstance.Client`
- `createSessionIfNeededStep` - Now takes `*agent.Client`, `*session.Client`
- `setInitialPhaseStep` - No dependencies (standalone)

**`backend/services/stigmer-server/pkg/controllers/agentexecution/list.go`**:
- `validateListRequestStep` - No dependencies (standalone)
- `queryAllExecutionsStep` - Now takes `*badger.Store` directly
- `applyPhaseFilterStep` - No dependencies (standalone)
- `buildListExecutionListResponseStep` - No dependencies (standalone)

**`backend/services/stigmer-server/pkg/controllers/agentexecution/list_by_session.go`**:
- `validateListBySessionRequestStep` - No dependencies (standalone)
- `queryExecutionsBySessionStep` - Now takes `*badger.Store` directly
- `buildListBySessionExecutionListResponseStep` - No dependencies (standalone)

### AgentInstance Controller (1 step refactored)

**`backend/services/stigmer-server/pkg/controllers/agentinstance/get_by_agent.go`**:
- `loadByAgentStep` - Now takes `*badger.Store` directly

## Technical Details

### Dependency Types

Steps now use the correct dependency types:

1. **Badger Store**: Steps that need database access inject `*badger.Store`
2. **Downstream Clients**: Steps that call other services inject wrapper clients:
   - `*agent.Client` (for agent operations)
   - `*agentinstance.Client` (for agent instance operations)
   - `*session.Client` (for session operations)

These wrapper clients provide helper methods like `CreateAsSystem()` and ensure proper gRPC interceptor chains.

### Import Changes

Added necessary imports for:
- `github.com/stigmer/stigmer/backend/libs/go/badger` (for steps using store)
- `github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agent`
- `github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/agentinstance`
- `github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/session`

### Pipeline Build Changes

Updated pipeline builders to pass dependencies explicitly:

```go
// Before
AddStep(c.newQueryAllExecutionsStep())

// After
AddStep(newQueryAllExecutionsStep(c.store))
```

## Benefits

### 1. Explicit Dependencies
Each step declares exactly what it needs in its type definition. No more hunting through controller fields to understand dependencies.

### 2. Better Testability
Steps can be tested in isolation by injecting mock dependencies. No need to mock the entire controller structure.

### 3. Clearer Separation of Concerns
Steps are independent units with focused responsibilities. The controller is no longer a "god object" that everything depends on.

### 4. Improved Maintainability
When a step's dependencies change, it's immediately visible in:
- The step struct definition
- The factory function signature
- The pipeline builder call

### 5. Follows Dependency Injection Best Practices
Dependencies are injected through constructors rather than pulled from a parent object, making the code more modular and composable.

## Migration Notes

This is an internal refactoring with:
- **No API changes**: All controller methods have the same signature
- **No behavior changes**: Pipeline execution logic is identical
- **No configuration changes**: Controllers are initialized the same way

The refactoring only affects the internal structure of pipeline steps.

## Verification

All refactored files:
- ✅ Compile successfully with no errors
- ✅ Pass linter checks
- ✅ Maintain existing behavior
- ✅ Follow the standalone step pattern consistently

## Impact

### Code Quality
- **Before**: 14 steps using CDOT pattern across 3 controllers
- **After**: 14 steps using standalone pattern with explicit dependencies
- **Improvement**: 100% conversion to better pattern

### Test Coverage
Steps are now easier to unit test due to:
- Explicit dependency injection
- No controller coupling
- Clear interfaces

### Future Work
This pattern should be applied to:
- Any new pipeline steps created
- Any existing steps that still use CDOT pattern (if any remain)

## Related Work

This refactoring aligns with the existing standalone pattern already used in:
- `agent/apply.go`, `agent/delete.go`, `agent/get.go`, `agent/update.go`
- `agentexecution/delete.go`, `agentexecution/get.go`, `agentexecution/update.go`, `agentexecution/update_status.go`
- `agentinstance/apply.go`, `agentinstance/create.go`, `agentinstance/delete.go`, `agentinstance/get.go`, `agentinstance/update.go`

Now all pipeline steps across all controllers follow the same consistent pattern.

## References

- Pattern identified during review of `list.go` vs `update_status.go`
- Standalone pattern is the recommended approach for pipeline steps
- CDOT pattern should be avoided in new code

---

**Conclusion**: This refactoring improves code quality, testability, and maintainability without changing any external behavior. All controller pipeline steps now follow a consistent, best-practice pattern with explicit dependency injection.
