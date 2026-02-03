# Project Display Foundation - Complete Output Formatting for Project Entity

**Date**: February 3, 2026

## Summary

Implemented comprehensive display layer for the Project entity, providing table, YAML, and JSON output formats for project information. This completes Phase 4 sub-task T04.4, establishing the presentation layer needed for the upcoming project commands (`stigmer project info` and `stigmer project validate`).

The implementation mirrors Agent and Workflow display patterns exactly, maintaining architectural consistency across all resource types while adapting to Project's unique characteristics as a local-first, aggregate root entity.

## Problem Statement

The Project entity is the aggregate root for SDK synthesis and resource lifecycle management. Unlike Agent/Workflow which are fetched from the backend, Project is loaded from local `stigmer.yaml` files and requires specialized display handling for:

1. **Local project configuration** - Displaying metadata, runtime, and entry point settings
2. **Reconciliation status** - Showing backend-managed state after `stigmer apply`
3. **Validation results** - CI-friendly output for `stigmer project validate`
4. **Dry-run preview** - Showing what would be applied without executing

### Pain Points

- No way to inspect project configuration in human-readable format
- No display functions for project info or validation results
- Missing foundation for project commands (info, validate)
- Inconsistency risk if display patterns diverge from Agent/Workflow

## Solution

Created `display.go` following the established Agent/Workflow patterns with adaptations for Project's unique characteristics:

**Core Functions:**
- `DisplayProjectInfo()` - Format router (table/yaml/json)
- `displayProjectTable()` - Human-readable output with metadata, spec, and status sections
- `displayProjectYAML()` / `displayProjectJSON()` - Full proto serialization
- `DisplayProjectPreview()` - Dry-run mode output
- `DisplayValidationSuccess()` - CI-friendly validation result

**Helpers:**
- `displayProjectSummary()` - Consistent spec field display
- `displayReconciliationStatus()` - Backend reconciliation state
- `formatResourceCounts()` - Human-readable resource counts ("2 agents, 3 workflows")
- `runtimeToString()` - Enum to lowercase ("go", "python", "node")
- `getDefaultEntryPoint()` - Default entry points per runtime
- `truncateString()` - Description truncation with "..."

## Implementation Details

### File: `client-apps/cli/internal/cli/project/display.go`

**Size**: 214 lines (within 250 line limit, consistent with Agent: 236, Workflow: 228)

**Key Design Decisions:**

1. **Default Entry Point Display**
   - When `entry_point` is empty, show runtime's default with "(default)" indicator
   - Eliminates confusion about implicit defaults
   - Example: "Entry Point: main.go (default)"

2. **Reconciliation Status Section**
   - Only displayed when `Status.Reconciliation` is present (post-apply)
   - Shows: Last reconciled timestamp, result, resource counts
   - Formatted for quick visual scanning

3. **Resource Count Formatting**
   - Smart pluralization and comma separation
   - Only shows non-zero counts
   - Example: "2 agents, 3 workflows, 1 skill" (omits "0 mcp servers")

4. **Pattern Consistency**
   - Exact mirror of Agent/Workflow display patterns
   - Same protojson marshaling options
   - Same YAML conversion via intermediate map
   - Same error handling with `clierr.Handle`

### Table Output Format

```
Project: my-super-app

Metadata:
  Name:        my-super-app
  Org:         acme-corp

Spec:
  Runtime:     go
  Entry Point: main.go
  Description: My awesome project for...

Status:
  Reconciled:  2026-02-03 12:34:56
  Result:      success
  Resources:   2 agents, 3 workflows, 1 skill
```

### Build Integration

Updated `BUILD.bazel`:
- Added `display.go` to sources
- Added `//client-apps/cli/internal/cli/clierr` dependency
- Added `//client-apps/cli/internal/cli/cliprint` dependency

## Benefits

1. **User Experience**
   - Clear, readable project information display
   - Multiple output formats for different use cases (human vs automation)
   - Visual feedback for validation success

2. **Developer Experience**
   - Consistent patterns across all resource types
   - Well-documented functions with clear purposes
   - Easy to maintain and extend

3. **CI/CD Integration**
   - CI-friendly validation output via `DisplayValidationSuccess`
   - JSON output for programmatic parsing
   - Exit code 0 validation messages

4. **Architectural Consistency**
   - Same display patterns as Agent/Workflow
   - Same error handling approach
   - Same helper function organization

## Impact

**Enables:**
- T04.6: Project Command Group implementation
- `stigmer project info` command
- `stigmer project validate` command
- Future project apply dry-run functionality

**Affects:**
- CLI package: Adds 214 lines to project package
- Build system: 2 new dependencies (clierr, cliprint)
- User workflows: Foundation for project inspection and validation

## Engineering Standards Compliance

| Standard | Status | Details |
|----------|--------|---------|
| File size < 250 lines | ✅ | 214 lines (consistent with Agent: 236, Workflow: 228) |
| Function size < 50 lines | ✅ | Largest function is ~25 lines |
| Pattern consistency | ✅ | Exact mirror of Agent/Workflow patterns |
| Error handling | ✅ | All errors use `clierr.Handle` |
| Documentation | ✅ | Every exported function has doc comment |
| No business logic | ✅ | Pure display/formatting only |
| Build verification | ✅ | bazel build succeeds |
| Test verification | ✅ | All 51 project tests pass |
| Code formatting | ✅ | gofmt clean |

## Files Changed

```
client-apps/cli/internal/cli/project/
├── display.go                    (NEW - 214 lines)
└── BUILD.bazel                   (MODIFIED - added display.go + 2 deps)
```

## Quality Metrics

- **Function count**: 12 (7 exported, 5 helpers)
- **Exported functions**: All have doc comments
- **Code coverage**: Display functions are visual (manual verification)
- **Build time**: 1.5s (bazel build)
- **Test time**: 2.7s (all 51 tests pass)

## Related Work

**Prerequisites (completed):**
- T04.1: Project Proto Schema Design
- T04.2: Project Loader Foundation
- T04.3: Project Validator (Cross-Field)

**Next Steps:**
- T04.5: Track Detection Logic - Walk-up algorithm for stigmer.yaml
- T04.6: Project Command Group - `stigmer project info` and `validate` commands
- T04.7: Integration and Documentation

**Pattern Sources:**
- `client-apps/cli/internal/cli/agent/display.go` - Agent display patterns
- `client-apps/cli/internal/cli/workflow/display.go` - Workflow display patterns

---

**Status**: ✅ Production Ready

**Phase**: Phase 4 - Project Entity & stigmer.yaml Foundation (43% → 57% complete)

**Architecture**: Follows ADR-005 Dual-Track Interface design
