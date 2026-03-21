# MCP Server Local Proto Stubs

**Date**: March 21, 2026

## Summary

The MCP server now generates its own local proto stubs into `mcp-server/proto/`, eliminating the dependency on the externally-versioned `apis/stubs/go` module. This mirrors the existing SDK Go pattern and resolves `go mod tidy` failures that occurred when proto stubs were regenerated but not yet tagged/published.

## Problem Statement

The MCP server depended on `github.com/stigmer/stigmer/apis/stubs/go` as a remote Go module for proto-generated types. This created a chicken-and-egg problem during development.

### Pain Points

- `go mod tidy` failed when proto definitions changed because the stubs module hadn't been tagged yet
- The codegen tool (`--target=mcp`) was inconsistently generating imports: domain types pointed to `sdk/go/proto/` while commons types pointed to `apis/stubs/go/`, causing compilation failures
- The MCP server couldn't be built independently without first publishing the stubs module
- Proto3 `optional` scalar fields (like `GitRepoSource.Depth`) caused compilation errors because the codegen didn't handle pointer type assignments for synthetic oneofs

## Solution

Replicated the SDK Go's self-contained proto pattern for the MCP server:
1. New `buf.gen.mcp-server.yaml` generates proto stubs directly into `mcp-server/proto/`
2. The codegen tool's import path prefix is now target-specific (no CLI flag needed)
3. All 34 hand-written and 17 generated Go files updated to use local proto imports

## Implementation Details

### Build Pipeline

- **New file**: `apis/buf.gen.mcp-server.yaml` — buf generate template with `go_package_prefix: github.com/stigmer/stigmer/mcp-server/proto`
- **`mcp-server/Makefile`**: Added `codegen-stubs` target; `codegen` now runs `codegen-stubs` before `codegen-schemas` and `codegen-mcp`
- **Root `Makefile`**: Added `$(MAKE) -C mcp-server codegen` to the `protos` target

### Codegen Tool

- **`tools/codegen/generator/main.go`**: Parameterized `protoTypeToGoImportPath(protoType, prefix string)` — the transformation logic is shared, but each target passes its own prefix constant
- **`tools/codegen/generator/mcp.go`**: Added `mcpProtoPrefix` constant; updated all import generation to use it; fixed proto3 optional scalar field handling (synthetic oneofs like `_depth` now generate proper pointer assignments via new `scalarZeroValue` helper)
- **Design decision**: The prefix is a fixed property of each target, not a CLI flag. This prevents misconfiguration and keeps the Makefile decoupled from codegen internals.

### Import Migration

All Go files in `mcp-server/` changed from:
```
github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/...
```
to:
```
github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/...
```

### Bug Fix

Fixed a latent codegen bug where proto3 `optional` scalar fields (e.g., `Depth *int32` on `GitRepoSource`) generated invalid direct assignments instead of pointer conversions.

## Benefits

- MCP server builds independently — no dependency on external module versioning
- `go mod tidy` no longer fails during development cycles
- Consistent import paths across all 51 Go files (17 generated + 34 hand-written)
- Codegen correctly handles proto3 optional scalars going forward

## Impact

- **MCP server module**: Fully self-contained; `apis/stubs/go` removed from `go.mod`
- **Build pipeline**: `make protos` now includes MCP server codegen
- **Codegen tool**: Shared `protoTypeToGoImportPath` is now parameterized for all targets
- **83 files changed** across the repository

## Related Work

- Follows the pattern established by `apis/buf.gen.sdk-go.yaml` for the Go SDK
- The same approach could be applied to other Go modules that depend on `apis/stubs/go`

---

**Status**: Production Ready
**Timeline**: Single session
