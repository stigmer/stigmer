# Fix Codegen Cross-Package Type Resolution

**Date**: April 11, 2026

## Summary

Fixed two code generation bugs that caused build failures when proto message types lived in a different package than the resource being generated. The MCP codegen was missing the `oauth_app` enum mapping, and the SDK client codegen was hardcoding the resource's own package alias for map value types instead of resolving the correct cross-package alias.

## Problem Statement

After `EnvVarDeclaration` was moved from individual resource packages (`agent/v1`, `mcpserver/v1`, `workflow/v1`) into the shared `environment/v1` package, the codegen produced invalid Go code that failed to compile.

### Pain Points

- `make check` failed with `undefined: apiresourcekind.ApiResourceKind_ApiResourceKind` in the MCP server generated code
- `make check` failed with `undefined: agentv1.EnvVarDeclaration`, `mcpserverv1.EnvVarDeclaration`, and `workflowv1.EnvVarDeclaration` in the SDK client generated code
- Both errors were in generated files, meaning every regeneration would reproduce them

## Solution

Fixed the two root causes in the codegen tool (`tools/codegen/generator/`) so that regenerated output is correct.

## Implementation Details

### 1. MCP Codegen — Missing `oauth_app` Enum Mapping (`mcp.go`)

The `apiResourceKindEnumNames` map was missing the entry for `oauth_app` (value 22). When `OauthAppRefInput` referenced kind value 22, the fallback path in `genRefToProto` produced `ApiResourceKind(22)` as the enum name, which was then formatted as `apiresourcekind.ApiResourceKind_ApiResourceKind(22)` — an invalid Go identifier. Added `22: "oauth_app"` to the map.

### 2. SDK Client Codegen — Hardcoded Package Alias for Map Values (`sdk_client.go`)

The `emitToProtoField` function's map-of-messages default branch used the resource's own proto alias (e.g., `agentv1`) for all map value types. When the map value type (`EnvVarDeclaration`) actually lives in a different package (`environmentv1`), this produced invalid references.

**Changes:**
- Moved `typeMap` construction before the import-scanning closure so it's available during field scanning
- Enhanced the import scanner to detect when a map value type resolves to `environmentv1` via its `ProtoType`, ensuring the import is emitted
- Updated the map default branch to look up the value type's `ProtoType` in `typeMap` and derive the correct package alias via `protoTypeToPackageAlias`, rather than blindly using the resource alias

## Benefits

- `make check` passes cleanly on the Stigmer OSS repo
- The fix is generic: any future cross-package map value type will be resolved correctly, not just `EnvVarDeclaration`
- No manual edits to generated files required — regeneration produces correct output

## Impact

- **Codegen tool** (`tools/codegen/generator/`): 2 files changed
- **Generated output** (4 files): automatically corrected by regeneration
- **All existing tests pass**: Go, TypeScript, Python (1499+ tests)

## Related Work

- Proto refactoring that moved `EnvVarDeclaration` to `environment/v1`
- MCP OAuth authentication feature (`OauthAppRef` reference kind)

---

**Status**: ✅ Production Ready
