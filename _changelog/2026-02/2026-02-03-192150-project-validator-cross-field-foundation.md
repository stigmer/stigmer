# Project Validator: Cross-Field Business Logic Foundation

**Date**: February 3, 2026

## Summary

Implemented comprehensive cross-field validation for Project resources in the Stigmer CLI, completing Phase 4 Sub-task T04.3. The validator enforces runtime-entrypoint consistency, reserved namespace protection, and path security validation - business logic constraints that cannot be expressed in proto schema rules. This foundation enables safe project configuration with actionable error messages that guide users toward correct usage.

## Problem Statement

The Project loader (T04.2) handles YAML/JSON parsing and proto schema validation via protovalidate, but certain business rules require relationships between multiple fields to be validated:

### Pain Points

- **Runtime-EntryPoint Mismatch**: Users could specify `runtime: go` with `entry_point: main.py`, causing synthesis failures
- **Namespace Conflicts**: Project names like `system`, `admin`, or `stigmer` would collide with platform namespaces
- **Path Security Risks**: Absolute paths or directory traversal (`../`) in entry points could bypass security boundaries
- **Proto Limitations**: protovalidate cannot express "if runtime is X, then entry_point must end with Y" logic

## Solution

Created a dedicated validator that operates after proto schema validation, implementing three critical validation rules:

1. **Runtime-EntryPoint Consistency**: File extension must match runtime (`.go` for Go, `.py` for Python, `.js/.ts/.mjs/.mts` for Node)
2. **Reserved Name Detection**: Blocks platform-reserved names (`default`, `system`, `admin`, `root`, `stigmer`, `test`)
3. **Path Security Validation**: Rejects absolute paths and directory traversal attempts

Each validation error includes actionable guidance to help users fix the issue.

## Implementation Details

### Files Created

**1. validator.go (166 lines)**
- `Validate()` - orchestrates all cross-field validations
- `validateRuntimeEntryPoint()` - ensures extension matches runtime
- `validateReservedNames()` - prevents namespace collisions
- `validateEntryPointPath()` - blocks unsafe path patterns
- Helper functions: `getValidExtensions()`, `isReservedName()`, `containsDirectoryTraversal()`

**2. validator_test.go (439 lines)**
33 test functions covering:
- Edge cases (nil project, nil spec, empty entry_point)
- Runtime-entrypoint consistency for all combinations
- All 6 reserved names with case-insensitive checking
- Path security (absolute paths, directory traversal)
- Error message quality (actionable guidance)
- Helper function unit tests

**3. BUILD.bazel**
Updated to include validator source and test files with proper dependencies.

### Pattern Consistency

Follows the established validator patterns from:
- `workflow/validator.go` (210 lines) - DAG cycle detection, flow reference validation
- `agent/validator.go` (179 lines) - MCP server uniqueness, sub-agent tool subset validation

All three validators share the same structure:
```go
func Validate(resource) error {
    // Nil-safe entry point
    if resource == nil || resource.Spec == nil {
        return nil
    }
    
    // Chain of validation functions
    if err := validateRule1(resource); err != nil {
        return err
    }
    // ... more validations
    
    return nil
}
```

### Error Message Standards

Each error provides:
- **What failed**: Clear description of the validation error
- **Why it failed**: Context about the constraint being violated
- **How to fix**: Specific guidance on resolving the issue

Example:
```
entry point "main.py" has invalid extension for go runtime

Expected extensions: .go
Either change the entry_point or the runtime setting.
```

## Benefits

### Developer Experience
- **Early Detection**: Catches configuration errors at validation time, not during synthesis
- **Actionable Errors**: Clear fix guidance reduces debugging time
- **Type Safety**: Runtime-specific file extensions prevent common mistakes

### System Security
- **Namespace Protection**: Reserved names prevent conflicts with platform components
- **Path Security**: Blocks directory traversal and absolute path exploits
- **Explicit Defaults**: Empty entry_point is valid, defaults applied at apply-time (not validation)

### Code Quality
- **Pattern Consistency**: Matches workflow and agent validator patterns exactly
- **Comprehensive Testing**: 33 test cases with 100% coverage of validation rules
- **Engineering Standards**: All files under 250 lines, all functions under 50 lines

## Validation Rules Reference

| Rule | Description | Error Behavior |
|------|-------------|----------------|
| **Runtime-EntryPoint** | GO→`.go`, Python→`.py`, Node→`.js/.ts/.mjs/.mts` | Rejects mismatched extensions |
| **Reserved Names** | Blocks: `default`, `system`, `admin`, `root`, `stigmer`, `test` | Case-insensitive rejection |
| **Path Security** | Must be relative, no `..` components | Rejects unsafe paths |

## Test Coverage

**Edge Cases (4 tests)**:
- Nil project, nil spec, nil metadata
- Empty entry_point valid for all runtimes

**Runtime-EntryPoint (12 tests)**:
- All runtime/extension combinations
- Subdirectory paths
- Case-insensitive extension matching

**Reserved Names (10 tests)**:
- All 6 reserved names
- Case-insensitive matching
- Valid names that are similar but not reserved

**Path Security (7 tests)**:
- Absolute path rejection
- Directory traversal patterns
- Valid relative paths

**Total: 33 validator tests (plus 18 loader tests from T04.2 = 51 total project tests)**

## Impact

### Phase 4 Progress
- ✅ T04.1: Project Proto Schema Design (Complete)
- ✅ T04.2: Project Loader Foundation (Complete)
- ✅ **T04.3: Project Validator (Complete)** ← This work
- ⏭️ T04.4: Project Display (Next)
- ⏭️ T04.5: Track Detection Logic
- ⏭️ T04.6: Project Command Group
- ⏭️ T04.7: Integration and Documentation

**Progress**: 3 of 7 sub-tasks complete (43%)

### Files Modified
```
client-apps/cli/internal/cli/project/
├── loader.go           (157 lines, from T04.2)
├── loader_test.go      (415 lines, from T04.2)
├── validator.go        (166 lines, NEW)
├── validator_test.go   (439 lines, NEW)
└── BUILD.bazel         (updated with new sources)
```

### Build & Test Results
```bash
bazel build //client-apps/cli/internal/cli/project:project
# ✅ Build successful

bazel test //client-apps/cli/internal/cli/project:project_test
# ✅ All 51 tests pass (18 loader + 33 validator)
```

## Engineering Standards Compliance

Per [coding-guidelines.mdc](/Users/suresh/scm/github.com/stigmer/stigmer/.cursor/rules/client-apps/cli/coding-guidelines.mdc):

- ✅ **File sizes**: validator.go (166 lines) < 250 limit
- ✅ **Function sizes**: All functions < 50 lines (largest: validateRuntimeEntryPoint at 20 lines)
- ✅ **Error handling**: All errors include specific, actionable context
- ✅ **Single responsibility**: One file for validation, one for tests
- ✅ **Pattern consistency**: Matches workflow/agent validator patterns exactly
- ✅ **Package organization**: Business logic in `internal/cli/project/`
- ✅ **Test coverage**: 33 test cases covering all validation rules and edge cases

## Related Work

**Previous Sub-tasks**:
- [T04.1: Project Proto Schema](../../_changelog/2026-02/2026-02-03-184319-project-proto-schema-foundation.md) - Proto definitions with ProjectRuntime enum
- [T04.2: Project Loader](../../.cursor/plans/project_loader_foundation_7bf49d17.plan.md) - YAML/JSON parsing with protovalidate

**Parallel Validators**:
- `workflow/validator.go` - Task uniqueness, flow references, DAG cycles
- `agent/validator.go` - MCP server uniqueness, sub-agent tool subsets

**Architecture**:
- [ADR-005: Unified Resource Management](../../_cursor/adr-doc.md) - Dual-Track Interface (Atomic + Project)
- [Phase 4 Plan](../../_projects/2026-01/20260131.02.cli-agent-yaml-first/plans/phase_4_project_entity_09146e51.plan.md) - Project Entity implementation roadmap

## Next Steps

**Immediate (T04.4 - Project Display)**:
- Create `display.go` with table/yaml/json output formats
- Implement `DisplayProjectInfo()` following agent/workflow patterns
- Consistent terminal output for project information

**Upcoming (T04.5-T04.7)**:
- Track detection logic (walk-up algorithm for stigmer.yaml)
- Project command group (`stigmer project info`, `stigmer project validate`)
- Integration testing and example projects

---

**Status**: ✅ Production Ready  
**Timeline**: ~60 minutes (estimated 60 min, actual ~60 min)  
**Phase**: Phase 4 Sub-task 3 of 7  
**Tests**: 33 tests, all passing
