# Decouple MCP Server from CLI Binary to Enable `go install`

**Date**: March 26, 2026

## Summary

Resolved the `go install` failure for the MCP server caused by a `replace` directive in `mcp-server/go.mod`. The MCP server now generates protobuf stubs locally (mirroring the SDK pattern), and the CLI executes the standalone `mcp-server-stigmer` binary instead of embedding it as a Go import — eliminating a protobuf double-registration panic that blocked previous attempts at this fix.

## Problem Statement

The MCP server module's `go.mod` contained a `replace` directive pointing to `../apis/stubs/go`. Go's module system forbids `replace` directives when a module is fetched remotely (e.g. via `go install`), so users and MCP clients could not install the server with:

```
go install github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest
```

### Pain Points

- `go install` failed with: *"module providing named packages contains one or more replace directives"*
- The MCP server depended on `apis/stubs/go` via a local-only replace, making it uninstallable outside the monorepo workspace
- A previous attempt to fix this by generating local proto stubs was reverted because the CLI binary embedded the MCP server Go package, causing a protobuf runtime panic from duplicate `.proto` file registrations

## Solution

Two-pronged fix:

1. **Local proto stubs for the MCP server** — Created `apis/buf.gen.mcp-server.yaml` (mirroring the existing `buf.gen.sdk-go.yaml` pattern) that generates Go protobuf stubs into `mcp-server/proto/`. The `replace` directive for `apis/stubs/go` is no longer needed.

2. **Process-level decoupling of the CLI** — Rewrote the CLI's `stigmer mcp-server` subcommand to resolve and exec the standalone `mcp-server-stigmer` binary instead of importing the Go package. The CLI bridges its config file and flags into environment variables that the binary reads. This eliminates the shared-binary problem where `apis/stubs/go` and `mcp-server/proto` would register the same `.proto` files in one process.

## Implementation Details

### MCP Server Module (proto generation)

- **`apis/buf.gen.mcp-server.yaml`** — New buf template with `go_package_prefix` set to `github.com/stigmer/stigmer/mcp-server/proto`, outputs to `../mcp-server/proto/`
- **`mcp-server/Makefile`** — Added `codegen-stubs` target that runs `buf generate`, flattens the nested output, and wires into the `codegen` pipeline
- **`mcp-server/go.mod`** — Removed the `replace` directive for `apis/stubs/go` and the explicit require; module is now self-contained
- **`tools/codegen/generator/mcp.go`** — Updated `mcpProtoPrefix` constant to `github.com/stigmer/stigmer/mcp-server/proto`
- **All `mcp-server/internal/` Go files** — Mechanical import path migration from `apis/stubs/go/...` to `mcp-server/proto/...`
- **All `mcp-server/**/BUILD.bazel`** — Updated Bazel labels to `//mcp-server/proto`

### CLI Module (process decoupling)

- **`client-apps/cli/cmd/stigmer/root/mcp_server.go`** — Complete rewrite:
  - Removed the `mcp-server/pkg/mcpserver` import (the root cause of the double-registration panic)
  - Bridges `~/.stigmer/config.yaml` settings into env vars (`STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`)
  - Bridges CLI flags (`--transport`, `--port`, etc.) into the corresponding MCP server env vars
  - Resolves the binary: `~/.stigmer/bin/` → PATH → auto-download from GitHub releases
  - Uses `syscall.Exec` on Unix for seamless STDIO passthrough to MCP clients
- **`client-apps/cli/cmd/stigmer/root/mcp_server_test.go`** — 13 tests rewritten for the env-var bridging model
- **`client-apps/cli/internal/cli/daemon/download.go`** — Added `DownloadMCPServerBinary()` that queries the GitHub releases API, finds the latest release with `mcp-server-stigmer` assets, and installs to `~/.stigmer/bin/`
- **`client-apps/cli/go.mod`** — Removed the `replace` and `require` for `mcp-server`
- **`client-apps/cli/cmd/stigmer/root/BUILD.bazel`** — Removed `//mcp-server/pkg/mcpserver` from library and test deps

## Benefits

- **`go install` works** — The MCP server module is fully self-contained; no `replace` directives block remote installation
- **No proto registration panics** — The CLI and MCP server run in separate processes, each with their own proto registration namespace
- **Zero-config CLI experience** — `stigmer mcp-server` auto-downloads the binary on first use and bridges the CLI's existing config (backend type, cloud endpoint, API key) seamlessly
- **Clean architecture** — Each module owns its proto stubs independently, following the pattern already established by the SDK

## Impact

- **MCP server users** — Can now install via `go install` or GitHub releases without needing the full monorepo
- **CLI users** — `stigmer mcp-server` continues to work identically; the process boundary is invisible
- **MCP clients (Cursor, Claude Desktop, etc.)** — STDIO passthrough via `syscall.Exec` ensures the same behavior as spawning the binary directly
- **Monorepo builds** — `make check` passes; gen-cli-docs no longer panics

## Related Work

- This resolves the revert of the original local proto generation attempt (which was reverted due to the CLI embedding conflict)
- Follows the pattern established by `sdk/go/proto/` for the Go SDK's local proto stubs
- The GitHub release download follows the existing `downloadServerBinary` / `downloadAgentRunnerBinary` patterns in `daemon/download.go`

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (investigation, implementation, verification)
