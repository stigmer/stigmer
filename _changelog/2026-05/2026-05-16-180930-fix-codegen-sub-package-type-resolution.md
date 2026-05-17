# Fix SDK Codegen Sub-Package Type Resolution

**Date**: May 16, 2026

## Summary

Fixed the SDK code generator (`stigmer-codegen`) to correctly resolve proto types that live in sub-packages. The `ValidateSpec` RPC on workflows returns `ServerlessWorkflowValidation`, which lives in the `serverless` sub-package of `workflow.v1`. The codegen was mapping this type to the parent package alias, causing a Go compilation error that blocked the desktop app from starting.

## Problem Statement

Running `make desktop dev` failed with:

```
../../sdk/go/internal/gen/workflow.go:55:95: undefined: workflowv1.ServerlessWorkflowValidation
```

### Pain Points

- Desktop app could not start at all — complete development blocker
- The generated Go SDK code referenced `workflowv1.ServerlessWorkflowValidation`, but the type actually lives in `serverless.ServerlessWorkflowValidation` (a sub-package)
- The Python SDK had the same latent bug — it would import `validation_pb2` from the wrong package path
- The generated files are marked `DO NOT EDIT`, so the fix had to be in the codegen itself

## Solution

Updated the `resolveType` and import-tracking logic in both the Go and Python SDK generators to detect when a proto type lives in a sub-package of the schema's main package, and emit the correct import path and alias.

## Implementation Details

### Go SDK (`sdk_client.go`)

1. **`resolveType`** — After the prefix check matches, added a secondary check: if the suffix (everything after the schema package prefix) contains another dot before the type name, the type is in a sub-package. In that case, delegate to `protoTypeToPackageAlias` to derive the correct alias (e.g., `serverless`).

2. **`collectSubPackageImports`** (new function) — Scans all method input/output types across all services. For any type whose full name is in a sub-package of the schema package, it computes the Go import alias and path and returns them as a map.

3. **`generateResourceClient`** — Now calls `collectSubPackageImports` and emits those imports in the generated file's import block.

### Python SDK (`sdk_client_python.go`)

1. **`pyTrackMethodTypeImport`** — After tracking the `_pb2` module, added sub-package detection using the same suffix-dot heuristic. Records the sub-package path in a new `subPkgPb2Imports` map.

2. **`pyImports.subPkgPb2Imports`** (new field) — Maps module name to its sub-package dotted path (e.g., `"validation_pb2"` → `"ai.stigmer.agentic.workflow.v1.serverless"`).

3. **`emit()`** — When writing extra `_pb2` module imports, checks `subPkgPb2Imports` first. If the module has a sub-package entry, uses that path instead of `resourcePkg`.

### TypeScript and Java — No changes needed

- **TypeScript**: Already uses exact package comparison (`typePkg != schema.Package`), so sub-packages naturally route through the cross-package import logic.
- **Java**: Uses fully-qualified class names via `resolveJavaFQCN`, so sub-packages are unambiguous.

## Benefits

- Desktop app starts cleanly again via `make desktop dev`
- Go SDK compiles without errors
- Python SDK will generate correct imports for sub-package types
- Generic fix — any future sub-package types in any resource will be handled automatically

## Impact

- **Developers**: Unblocked from local development (desktop app wouldn't start)
- **CI/CD**: Go SDK compilation was failing
- **All SDKs**: Go and Python fixed; TypeScript and Java verified as already correct

## Related Work

- The `ValidateSpec` RPC and `ServerlessWorkflowValidation` type were introduced as part of the workflow validation pipeline (Phase 3 / bring-workflows-to-foreground initiative)
- The `serverless` sub-package houses the CNCF Serverless Workflow DSL validation types

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
