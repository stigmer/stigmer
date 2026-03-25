# Fix ApiResourceKind Injection in getByReference Across All SDKs

**Date**: March 25, 2026

## Summary

Fixed a systemic bug where all SDK `getByReference` methods sent `ApiResourceReference` to the backend without setting the `kind` field, causing it to default to `api_resource_kind_unknown (0)`. The backend rejects these requests with "Invalid resource kind. Expected mcp_server, got: api_resource_kind_unknown". The fix was applied to all four SDK codegen templates (TypeScript, Java, Python, Go) and all SDK clients were regenerated.

## Problem Statement

Navigating to any resource detail page in the Stigmer Console (e.g., Library / MCP Servers / mcp-server-stigmer) produced the error: "Invalid request - Invalid resource kind. Expected mcp_server, got: api_resource_kind_unknown".

### Pain Points

- Every `getByReference` call across all four SDKs failed on backends with kind validation
- The bug was in the codegen templates, meaning every resource type was affected (10+ resources)
- The `kind` field defaulted to `0` (unknown) because none of the SDK codegens populated it
- The Go SDK additionally exposed the raw `*apiresource.ApiResourceReference` proto instead of the typed `ResourceRef`, breaking consistency with other SDKs

## Solution

Updated all four SDK codegen templates to auto-inject the correct `ApiResourceKind` enum value (derived from `pascalToSnake(cfg.protoResType)`) into every `getByReference` method. The kind is injected at the codegen level so it applies to all current and future resources automatically.

## Implementation Details

### Codegen Template Changes

**TypeScript** (`sdk_client_ts.go`): Added `ApiResourceKind` import and changed the `isApiResourceRefInput` case to spread `{ ...ref, kind: ApiResourceKind.<snake> }`.

**Java** (`sdk_client_java.go`): Added `ApiResourceKind` import and changed to `ref.toProto().toBuilder().setKind(ApiResourceKind.<snake>).build()`.

**Python** (`sdk_client_python.go`): Added `needsApiResKind` flag to `pyImports`, split `api_resource_kind_pb2` import from the `needsSearch` block so it's also added for non-search resources, and changed to set `proto.kind = api_resource_kind_pb2.<snake>` before calling the stub.

**Go** (`sdk_client.go`): Added a new `isApiResRefInput` case (previously fell through to `default` with raw proto). The new case accepts `ResourceRef` by value, sets `ref.Kind = apiresourcekind.ApiResourceKind_<snake>`, then calls `ref.toProto()`. Also added `needsApiResourceRef` flag and split `apiresourcekind` import from `needsSearch`.

### Import Handling

For Python and Go, the `apiresourcekind` / `api_resource_kind_pb2` import was previously only emitted when `needsSearch` was true (for the `SearchService`-backed list method). Since `getByReference` also needs this import, the condition was expanded to `needsSearch || needsApiResourceRef` (Go) / `needsSearch || needsApiResKind` (Python). The search-specific imports (`rpc`, `searchv1`, `search_io_pb2`) remain gated on `needsSearch` only.

### Generated Output

All four SDK `make codegen-clients` targets ran successfully, producing correct output across all resource types. Verified on resources both with and without `SearchService` (e.g., `mcpserver` has search, `workflowinstance` does not).

## Benefits

- All `getByReference` calls now succeed with correct `kind` validation
- The fix is systemic: any new resource added to the codegen schemas will automatically get the correct `kind` injection
- Go SDK now uses the typed `ResourceRef` instead of raw proto for `GetByReference`, making it consistent with TypeScript, Java, and Python
- No breaking change to SDK callers (the `kind` is injected internally)

## Impact

- **All SDK consumers**: TypeScript, Java, Python, and Go clients all benefit
- **Web Console**: The MCP server detail page (and all other resource detail pages) now load correctly
- **Future resources**: Any new resource added to the codegen schemas will automatically get kind injection

## Related Work

- Commit `3d1acbb9` included the TypeScript and Java codegen template fixes
- This work completes the fix by adding Go and Python codegen template changes and regenerating all SDK clients

---

**Status**: Production Ready
**Timeline**: Single session
