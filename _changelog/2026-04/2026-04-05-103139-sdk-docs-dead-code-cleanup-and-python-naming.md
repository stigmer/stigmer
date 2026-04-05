# SDK Docs Generator: Dead Code Cleanup and Python Variable Naming Fix

**Date**: April 5, 2026

## Summary

Cleaned up 8 dead functions from the SDK docs generator left behind by the commons refactoring, and corrected Python code examples across all 17 SDK reference pages to use PEP 8-compliant snake_case variable names instead of camelCase. The generator is now ~200 lines leaner with zero behavioral drift risk from stale code paths.

## Problem Statement

Two independent quality issues had accumulated in `tools/codegen/generator/sdk_docs.go`:

### Pain Points

- **Dead code**: The commons refactoring routed all live code through `*WithCommons` function variants, but the original non-commons functions were never removed. These 8 functions (~200 lines) were unreachable from the single entry point `runSDKDocsGeneration`, creating maintenance confusion and drift risk.
- **Python naming**: `docVarName` produced lowerCamelCase variable names (`agentExecution`) for all four SDK languages. Python tabs received names that violate PEP 8, while the client accessor (`names.py`) and method names (`pyName`) were already correct snake_case.
- **Minor quality**: An unused variable suppressed with `_ = lower`, a dead switch branch with identical cases, and a stale comment referencing a removed function.

## Solution

**Dead code**: Removed all 8 unreachable functions after confirming via full call-graph analysis from the single entry point. Promoted the comments from the deleted wrapper functions to their `*WithCommons` counterparts so documentation was not lost.

**Python naming**: Added `docPyVarName` that reuses the existing `pascalToSnake` helper, and applied it in the 3 functions that emit Python code tabs. No function signature changes were needed since all required data (`cfg.protoResType`, `m.OutputType`) was already available.

## Implementation Details

### Dead code removed

5 section-level functions replaced by their `*WithCommons` counterparts:
- `docWriteTypes` / `docWriteTypesWithCommons`
- `docWriteNestedType` / `docWriteNestedTypeWithCommons`
- `docWriteMethodTypes` / `docWriteMethodTypesWithCommons`
- `docWriteResourceAndStatusTypes` / `docWriteResourceAndStatusTypesWithCommons`
- `docWriteStatusNestedTypes` / `docWriteStatusNestedTypesWithCommons`

3 thin wrappers with no remaining callers:
- `docWriteTypeField` (delegated to `docWriteTypeFieldWithCommons(..., nil)`)
- `docWriteResponseTypeField` (delegated to `docWriteResponseTypeFieldWithCommons(..., nil)`)
- `docFieldTypeLink` (zero call sites anywhere in the repo)

### Python variable naming

New function:
```go
func docPyVarName(typeName string) string {
    if typeName == "" || strings.HasSuffix(typeName, "List") {
        return "result"
    }
    return pascalToSnake(typeName)
}
```

Applied in 3 locations:
- `docWriteClientAccess` — client access examples
- `docWriteMethodSigs` — method return variables
- `docWriteStreamingSigs` — streaming loop variables

### Minor fixes

- Removed unused `lower` variable and `_ = lower` suppression in `docOverviewSummary`
- Simplified `docQuote` by removing a dead `case "python"` branch identical to `default`
- Updated stale comment in `docCollectNestedTypeNames` to reference `docWriteNestedTypeWithCommons`

## Benefits

- **~200 fewer lines** of dead code that could confuse maintainers or drift from live implementations
- **Correct Python examples** across all 12 multi-word resource pages and 2 streaming pages
- **Zero risk of accidental usage** of the old non-commons code paths
- **Cleaner signal** from go vet and static analysis (no more `_ = lower` suppression)

## Impact

- **SDK docs generator** (`sdk_docs.go`): Net reduction of 197 lines
- **12 MDX reference pages**: Python code examples updated from camelCase to snake_case
- **2 streaming examples**: Loop variables corrected (`for agent_execution in ...` instead of `for agentExecution in ...`)
- **No behavioral change** from dead code removal (verified via before/after MDX diff)

## Related Work

- [SDK Docs Auto-Generation POC](_changelog/2026-04/2026-04-03-185754-sdk-docs-auto-generation-poc.md)
- [Fix SDK Docs Python/Java Accessor Names](_changelog/2026-04/2026-04-05-100148-fix-sdk-docs-python-java-accessor-names.md)
- [SDK Docs Enums, Commons, and Cross-Page Links](_changelog/2026-04/2026-04-04-110432-sdk-docs-enums-commons-and-cross-page-links.md)

---

**Status**: Production Ready
**Timeline**: Single session
