# MCP server: single protobuf source via apis/stubs/go

**Date**: March 21, 2026

## Summary

The MCP server no longer vendors a second copy of generated Go protobuf code under
`mcp-server/proto/`. All MCP packages and generated `mcp-server/gen` code now import
`github.com/stigmer/stigmer/apis/stubs/go`, matching the backend and CLI. This removes
duplicate `protoregistry` registration and restores `make check` (including CLI tests
that link both `mcp-server` and `apis/stubs/go`).

## Problem Statement

`make check` failed in `client-apps/cli/cmd/stigmer/root` with a runtime panic during
test init:

- The same logical `.proto` file (e.g. `ai/stigmer/commons/rpc/pagination.proto`) was
  registered twice: once from `apis/stubs/go` and once from `mcp-server/proto`.

Go’s protobuf runtime rejects duplicate file paths in the global registry, so any
binary importing both module paths for the same descriptors panics at startup.

### Pain Points

- **CI / local `make check` broken** for the CLI root test package.
- **Two sources of truth** for API stubs in the MCP module (buf template +
  `mcp-server/proto` vs. canonical `apis` build).
- **Fragile linking** whenever a process combines MCP with other packages that use
  `apis/stubs/go`.

## Solution

Treat **`apis/stubs/go` as the only Go protobuf surface** for API messages used by
MCP:

1. Point MCP codegen (`mcpProtoPrefix`) at `apis/stubs/go`.
2. Add a `replace` + `require` in `mcp-server/go.mod` for that module (Docker already
   copies `apis/stubs/go` in the MCP image build).
3. Stop running `codegen-stubs` into `mcp-server/proto`; document that stubs come from
   `make -C apis build`.
4. Remove `apis/buf.gen.mcp-server.yaml` (only served the duplicate-stub pipeline).
5. Update imports and Bazel `deps` from `//mcp-server/proto/...` to
   `//apis/stubs/go/...`; regenerate `mcp-server/gen`.
6. Delete the `mcp-server/proto/` tree.

## Implementation Details

- **`tools/codegen/generator/mcp.go`**: `mcpProtoPrefix` →
  `github.com/stigmer/stigmer/apis/stubs/go`.
- **`tools/codegen/generator/main_test.go`**: Expected import path for MCP session
  proto updated.
- **`mcp-server/go.mod`**: `replace` and `require` for `apis/stubs/go`.
- **`mcp-server/Makefile`**: `codegen` = `codegen-schemas` + `codegen-mcp` only;
  removed `codegen-stubs` target and buf generation into `mcp-server/proto`.
- **`mcp-server/internal/**`, `mcp-server/gen/**`**: Go imports and BUILD.bazel deps
  switched to apis stubs; regenerated `gen` via the generator.
- **Deleted**: `apis/buf.gen.mcp-server.yaml`, entire `mcp-server/proto/` directory.

## Benefits

- **Single registration** of each API file descriptor in processes that use MCP + CLI
  (or any other `apis/stubs/go` consumer).
- **`make check` green** without special-casing tests.
- **Less duplication**; no drift between `mcp-server/proto` and `apis/stubs/go`.

## Impact

- **Developers**: Run `make -C apis build` (or the repo’s usual codegen) when protos
  change; MCP `make codegen` no longer regenerates local stubs.
- **MCP Docker build**: Unchanged requirement to include `apis/stubs/go` in context
  (already documented in `mcp-server/Dockerfile`).

## Related Work

- Supersedes the approach described in
  `_changelog/2026-03/2026-03-21-112326-mcp-server-local-proto-stubs.md` (local stubs
  under `mcp-server/proto/`).

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (investigation + implementation + `make check` verify)
