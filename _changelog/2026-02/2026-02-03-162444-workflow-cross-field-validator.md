# Workflow Cross-Field Validator Implementation

**Date**: February 3, 2026

## Summary

Implemented Phase 3 Sub-task T03.2: Workflow Cross-Field Validator, a comprehensive validation system for workflow configurations that ensures task name uniqueness, valid flow control references, and DAG acyclicity. This establishes the foundation for YAML-first workflow management, mirroring the agent validator pattern and maintaining consistency across the Stigmer CLI.

## Problem Statement

The workflow loader (implemented in T03.1) handles schema validation via protovalidate, but cross-field business logic validations cannot be expressed in proto rules. Without these validations, users could create invalid workflows with duplicate task names, invalid flow control references, or circular dependencies that would fail at runtime.

### Pain Points

- Duplicate task names cause ambiguous flow control references
- Invalid `flow.then` references create broken execution paths
- Circular dependencies in flow control lead to infinite loops
- Error messages need to be actionable and guide users to fixes
- Validation must be consistent with agent validator pattern

## Solution

Created a comprehensive cross-field validator in `client-apps/cli/internal/cli/workflow/validator.go` that validates three critical aspects:

1. **Task Name Uniqueness**: Ensures no duplicate task names exist within the workflow
2. **Flow Control References**: Validates that `flow.then` values reference existing tasks or "end"
3. **DAG Acyclicity**: Detects circular dependencies using DFS with path tracking

The validator follows the established agent validator pattern exactly, ensuring consistency across all Stigmer CLI resource types.

## Implementation Details

### Files Created

**validator.go (210 lines)**
- `Validate(workflow)` - Main orchestration function
- `validateUniqueTaskNames(tasks)` - Uniqueness validation
- `validateFlowControlReferences(tasks, taskNames)` - Reference validation
- `validateNoCycles(tasks, taskNames)` - DAG cycle detection using DFS
- Helper functions: `collectTaskNames()`, `buildFlowGraph()`, `reconstructCyclePath()`, `formatAvailableTaskNames()`

**validator_test.go (458 lines, 36 tests)**
- Test helpers: `newWorkflowTask()`, `newWorkflowTaskWithFlow()`, `newWorkflow()`
- Edge cases: nil workflow, nil spec, empty spec, empty tasks
- Valid flows: sequential, explicit jumps, end termination, complex flows
- Uniqueness tests: duplicate detection with clear error messages
- Reference tests: valid refs, invalid refs, "end" literal, case sensitivity
- Cycle tests: self-loop, simple cycles, complex cycles, converging paths
- Error message quality: actionable guidance, available task names, fix suggestions
- Helper function tests: collectTaskNames, formatAvailableTaskNames, buildFlowGraph, reconstructCyclePath

### Key Design Decisions

**DFS-Based Cycle Detection**: Implemented classic DFS with path tracking to detect cycles in the flow control graph. The algorithm maintains a visited set and a path set, detecting back edges that indicate cycles.

**Actionable Error Messages**: Every error includes:
- Field path (e.g., `tasks[2].flow.then`)
- Clear problem description
- Actionable guidance (e.g., "Available task names: taskA, taskB")
- Fix suggestions

**Pattern Consistency**: Mirrored the agent validator pattern exactly:
- Same function signatures and organization
- Same error handling approach
- Same test organization (helpers, edge cases, valid cases, invalid cases, error messages)
- Same build configuration style

**Validation Scope**: Focused on top-level task validation since workflow semantics indicate that nested tasks in fork/for/try have their own execution scope and flow.then only references top-level tasks.

## Benefits

**Prevents Runtime Failures**: Catches configuration errors at YAML load time rather than during workflow execution, providing immediate feedback to users.

**Developer Experience**: Clear, actionable error messages guide users to fix issues quickly without trial-and-error debugging.

**Type Safety**: Cross-field validations complement proto schema validation, ensuring workflows are both structurally and semantically valid.

**Pattern Consistency**: Following the agent validator pattern means:
- Developers can learn once, apply everywhere
- Maintenance is easier with consistent patterns
- Future resource types can follow the same approach

**Test Coverage**: 36 comprehensive tests covering:
- All validation rules
- Edge cases and boundary conditions
- Error message quality
- Helper functions

## Build Verification

```bash
./bazelw build //client-apps/cli/internal/cli/workflow:workflow  ✓
./bazelw test //client-apps/cli/internal/cli/workflow:workflow_test  ✓
```

All tests pass successfully with comprehensive coverage of validation scenarios.

## Impact

**Users**: Can now create workflow YAML files with confidence, receiving immediate, actionable feedback on configuration errors before attempting to apply workflows.

**Developers**: Have a clear pattern to follow for adding new validation rules or implementing validators for other resource types.

**Platform**: Establishes the foundation for YAML-first workflow management (Phase 3), completing the Atomic Track consistency across all Stigmer CLI resources (Agent, MCP Server, Skill, Workflow).

## Coding Guidelines Compliance

All engineering standards met:
- validator.go: 210 lines (under 250 limit) ✓
- validator_test.go: 458 lines ✓
- All functions under 50 lines ✓
- Single responsibility per function ✓
- Errors wrapped with specific context ✓
- Actionable error messages with guidance ✓

## Related Work

- **Phase 3 T03.1**: Workflow YAML Loader (completed in previous session)
- **Phase 1**: Agent YAML-First Foundation (validator pattern established)
- **ADR-005**: Unified Resource Management & Dual-Track Interface
- **Next**: T03.3 - Workflow Applier (uses validator for apply operations)

## Phase 3 Progress

Sub-tasks completed:
- ✅ T03.1: Workflow YAML Loader
- ✅ T03.2: Workflow Cross-Field Validator (this session)

Remaining sub-tasks:
- T03.3: Workflow Applier
- T03.4: Workflow Apply Command
- T03.5: Workflow Validate Command
- T03.6: Integration Testing and Documentation

---

**Status**: ✅ Production Ready  
**Timeline**: Completed in single session (2026-02-03)  
**Test Coverage**: 36 tests, all passing  
**Lines of Code**: 668 total (210 implementation + 458 tests)
