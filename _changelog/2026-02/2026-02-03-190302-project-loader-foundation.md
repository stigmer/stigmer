# Project Loader Foundation - Phase 4 Sub-task 2 Complete

**Date**: February 3, 2026

## Summary

Completed T04.2 (Project Loader Foundation) of Phase 4, implementing a production-ready loader for the Project entity following the battle-tested Agent/Workflow patterns exactly. The loader parses `stigmer.yaml` files with protovalidate as single source of truth, provides comprehensive error messages, and includes 17 tests (29 total with subtests) with 100% pass rate.

This is a critical foundation piece that enables the Project Track of ADR-005's Dual-Track Interface.

## Problem Statement

Phase 4 aims to implement the Project entity as the aggregate root for resource lifecycle management. Before we can build commands like `stigmer project info` and `stigmer project validate`, we need a robust loader that can:
- Parse `stigmer.yaml` files (both YAML and JSON formats)
- Validate against the Project proto schema using protovalidate
- Provide actionable error messages for users
- Follow established patterns for consistency across the codebase

### Pain Points

- No existing loader for Project resources
- Need consistent pattern matching Agent/Workflow loaders
- Must leverage protovalidate (no redundant Go validation)
- Must support both YAML and JSON formats
- Error messages must be helpful and include file paths

## Solution

Implemented a complete loader package following the exact pattern established by Agent and Workflow loaders:

1. **Package-level protovalidate validator** - Initialized once at package load time
2. **Clean API** - `LoadOptions` and `LoadResult` structs with explicit `FilePath`
3. **Format flexibility** - Auto-detects YAML/JSON by file extension
4. **Strict parsing** - `DiscardUnknown: false` catches typos and unknown fields
5. **Single source of truth** - Protovalidate handles all schema validation
6. **Comprehensive testing** - 17 test functions covering all paths and edge cases

## Implementation Details

### Files Created

1. **`client-apps/cli/internal/cli/project/BUILD.bazel`** (26 lines)
   - Bazel build configuration
   - Dependencies: Project proto, protovalidate, errors, yaml, protojson
   - Test target with testify assert/require

2. **`client-apps/cli/internal/cli/project/loader.go`** (156 lines)
   - Package-level `validator` initialized in `init()`
   - `Load()` function: resolves path → reads file → parses content → validates
   - `resolveFilePath()`: Validates file exists with helpful error message
   - `parseContent()`: YAML→JSON→proto pipeline with protovalidate
   - YAML conversion helpers: `yamlMapToJSON()`, `convertYAMLValue()`

3. **`client-apps/cli/internal/cli/project/loader_test.go`** (414 lines)
   - 17 test functions with 29 total test cases (including subtests)
   - Test helpers: `createTestFile()`, `minimalValidProjectYAML()`, etc.
   - Comprehensive coverage:
     - File resolution (4 tests)
     - Parsing (4 tests)
     - Protovalidate (5 subtests)
     - Success cases (6 tests with subtests)
     - Edge cases (6 tests with subtests)

### Pattern Consistency

The implementation is **indistinguishable in structure** from Agent/Workflow loaders:
- Same package-level validator initialization
- Same `LoadOptions` and `LoadResult` pattern
- Same error wrapping with `errors.Wrapf()` including file paths
- Same YAML→JSON→proto conversion pipeline
- Same test organization and coverage approach

### Key Technical Decisions

1. **Protovalidate as single source of truth**
   - No duplicate validation in Go code
   - Proto validation rules enforce:
     - `apiVersion: 'agentic.stigmer.ai/v1'` (const)
     - `kind: 'Project'` (const)
     - `metadata`: required
     - `spec`: required
     - `spec.runtime`: required, enum defined_only, not_in [0]

2. **Strict parsing mode**
   - `DiscardUnknown: false` catches typos and unknown fields early
   - Helps users discover issues during development

3. **Helpful error messages**
   - File path included in all errors
   - Usage hints when file path is missing
   - Validation errors wrapped with context

### Test Coverage

```
✅ TestLoad_ExplicitPath
✅ TestLoad_AnyFileName
✅ TestLoad_FileNotFound
✅ TestLoad_FilePathRequired
✅ TestLoad_ValidYAML
✅ TestLoad_ValidJSON
✅ TestLoad_InvalidYAMLSyntax
✅ TestLoad_UnknownFieldsRejected
✅ TestLoad_ProtovalidateErrors (5 subtests)
   - wrong apiVersion
   - wrong kind
   - missing metadata
   - missing spec
   - missing runtime in spec
✅ TestLoad_MinimalValidProject
✅ TestLoad_FullProject
✅ TestLoad_AllRuntimes (3 subtests: go, python, node)
✅ TestLoad_EmptyEntryPoint
✅ TestLoad_EmptyDescription
✅ TestLoad_YAMLSpecialCharacters
✅ TestLoad_MultiLineDescription
✅ TestLoad_DifferentFileExtensions (4 subtests)
```

**All 17 tests pass** (29 total with subtests) ✅

### Build Verification

```bash
# Build succeeds
bazel build //client-apps/cli/internal/cli/project:project
# INFO: Build completed successfully

# Tests pass
bazel test //client-apps/cli/internal/cli/project:project_test
# PASSED in 0.9s
# Executed 1 out of 1 test: 1 test passes

# Code formatting clean
gofmt -l client-apps/cli/internal/cli/project/*.go
# (no output - all files properly formatted)
```

## Benefits

### Immediate Benefits

1. **Foundation for Phase 4 commands**
   - Enables `stigmer project info` implementation (T04.6)
   - Enables `stigmer project validate` implementation (T04.6)
   - Required for track detection logic (T04.5)

2. **Pattern consistency**
   - Identical structure to Agent/Workflow loaders
   - Future developers can understand immediately
   - Maintenance burden minimized

3. **Developer experience**
   - Actionable error messages with file paths
   - Strict parsing catches mistakes early
   - Supports both YAML and JSON for flexibility

4. **Quality assurance**
   - Comprehensive test coverage (17 tests, 29 cases)
   - All edge cases covered (empty fields, special chars, etc.)
   - Validation happens at proto level (single source of truth)

### Long-term Benefits

1. **Scalability**
   - Adding new Project fields only requires proto changes
   - No Go validation code to maintain
   - Tests are easy to extend

2. **Reliability**
   - Protovalidate catches schema violations
   - Strict parsing prevents silent failures
   - Well-tested code paths

3. **Consistency**
   - All resource loaders follow same pattern
   - Easy to review and understand
   - Reduces cognitive load

## Engineering Standards Compliance

All engineering standards met:

| Standard | Requirement | Actual | Status |
|----------|-------------|--------|--------|
| File size | < 250 lines | loader.go: 156 lines | ✅ |
| Test file size | < 500 lines | loader_test.go: 414 lines | ✅ |
| Function size | < 50 lines | All functions < 50 lines | ✅ |
| Error handling | Wrap with context | All errors use `errors.Wrapf()` | ✅ |
| Package organization | Business logic in internal/ | internal/cli/project/ | ✅ |
| Test isolation | Use t.TempDir() | All tests use t.TempDir() | ✅ |
| Pattern consistency | Match Agent/Workflow | Indistinguishable structure | ✅ |
| Build success | No errors | bazel build succeeds | ✅ |
| Test success | All pass | 17/17 tests pass | ✅ |

## Impact

### Who is Affected

- **Phase 4 Implementation**: Unblocks T04.3-T04.7 (remaining Phase 4 sub-tasks)
- **Future Developers**: Can follow established loader pattern
- **End Users**: Will get clear error messages when stigmer.yaml has issues

### What is Enabled

1. **T04.3 (Project Validator)** - Can now add cross-field validation
2. **T04.4 (Project Display)** - Can display loaded Projects
3. **T04.5 (Track Detection)** - Can parse discovered stigmer.yaml files
4. **T04.6 (Project Commands)** - Can implement `project info` and `project validate`
5. **T04.7 (Integration)** - Can create end-to-end examples

### Technical Foundation

- Establishes the `internal/cli/project/` package
- Sets pattern for future Project functionality
- Proves Project proto schema is correct and usable
- Validates that protovalidate rules work as expected

## Related Work

### Prerequisites (Completed)

- **Phase 4 Sub-task T04.1**: Project Proto Schema Design
  - Created api.proto, spec.proto, status.proto, enum.proto, io.proto
  - Registered project = 60 in ApiResourceKind enum
  - Generated Go/Python stubs

### Enables (Next Steps)

- **Phase 4 Sub-task T04.3**: Project Validator (Cross-Field)
  - Will add runtime + entry_point extension consistency checks
  - Will validate resource glob patterns
  - Will check for reserved project names

### References

- **Agent Loader**: `client-apps/cli/internal/cli/agent/loader.go` (reference implementation)
- **Workflow Loader**: `client-apps/cli/internal/cli/workflow/loader.go` (pattern validation)
- **ADR-005**: Dual-Track Interface architecture
- **Phase 4 Plan**: `_projects/2026-01/20260131.02.cli-agent-yaml-first/plans/phase_4_project_entity_09146e51.plan.md`

## Files Changed

```
New files:
  client-apps/cli/internal/cli/project/BUILD.bazel       (26 lines)
  client-apps/cli/internal/cli/project/loader.go         (156 lines)
  client-apps/cli/internal/cli/project/loader_test.go    (414 lines)

Total: 3 files, 596 lines
```

## Next Steps

To continue Phase 4:

1. **Immediate**: Implement T04.3 (Project Validator) for cross-field validation
2. **Then**: Implement T04.4 (Project Display) for table/yaml/json output
3. **Then**: Implement T04.5 (Track Detection) for stigmer.yaml discovery
4. **Then**: Implement T04.6 (Project Commands) for CLI commands
5. **Finally**: Implement T04.7 (Integration & Documentation) for E2E testing

## Learnings

1. **Pattern consistency is powerful**: By following the Agent loader pattern exactly, implementation was straightforward and resulted in high-quality, maintainable code.

2. **Protovalidate is sufficient**: No Go-side validation was needed. The proto validation rules caught all schema violations.

3. **Comprehensive tests catch issues early**: 29 test cases covered all paths, edge cases, and error conditions. This gives confidence in the loader's reliability.

4. **File size discipline matters**: Keeping loader.go under 160 lines and functions under 50 lines made the code easy to read and understand.

5. **Error messages drive UX**: Including file paths and usage hints in error messages significantly improves developer experience.

---

**Status**: ✅ Complete and Production Ready

**Phase 4 Progress**: 2 of 7 sub-tasks complete (29%)

**Timeline**: ~90 minutes (including comprehensive testing and verification)
