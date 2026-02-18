# MCP Server CLI Embedding: `stigmer mcp-server`

**Date**: February 19, 2026

## Summary

The Stigmer MCP server is now available as a built-in subcommand of the Stigmer CLI — `stigmer mcp-server`. MCP clients like Cursor and Claude Desktop can point directly at the `stigmer` binary they already have installed, eliminating the need to install and manage a separate `mcp-server-stigmer` binary. The standalone binary is preserved and also simplified to a thin wrapper over the new public API.

## Problem Statement

Until this change, using the Stigmer MCP server required installing and configuring two separate binaries: `stigmer` (the CLI) and `mcp-server-stigmer` (the MCP server). This created unnecessary friction for users who had already installed `stigmer`, and complicated MCP client configuration with paths to a binary that users might not know how to find or keep updated.

### Pain Points

- Users had to install `mcp-server-stigmer` separately from `stigmer`, even though it connects to the same backend
- MCP client configuration (Cursor `mcp.json`, Claude Desktop config) required an absolute path to a binary the user may not have added to `PATH`
- The standalone binary's `main.go` embedded ~120 lines of orchestration logic (logger init, transport routing, signal handling) that was not reusable
- `client-apps/cli/go.mod` was missing `replace` directives for all workspace-local modules, causing `go mod tidy` to fail silently (masked by `go.work` at build time)

## Solution

Introduced a narrow public API package at `mcp-server/pkg/mcpserver/` with three exported symbols:

- `Config` — plain-type struct (all `string`/`bool` fields, no internal type leakage)
- `DefaultConfig() (*Config, error)` — reads from env vars with the same defaults as the standalone binary
- `Run(ctx context.Context, cfg *Config) error` — starts the server, blocks until ctx is cancelled

The Cobra command `stigmer mcp-server` calls `DefaultConfig()`, applies any CLI flag overrides, then calls `Run()`. The standalone binary's `main.go` does the same. Both share the exact same code path.

## Implementation Details

### New Public API (`mcp-server/pkg/mcpserver/`)

```
pkg/mcpserver/
├── config.go        Config struct, DefaultConfig(), toInternal(), fromInternal()
├── config_test.go   10 unit tests (env loading, round-trip, case normalization, validation)
├── run.go           Run(), initLogger(), serveBoth()
└── run_test.go      4 validation error tests (bad transport, bad log level, missing key, empty address)
```

The public `Config` uses plain `string` types for `Transport` and `LogFormat` instead of the internal named types. Conversion happens inside `toInternal()`, which delegates validation to `internal/config.Validate()` and `internal/config.ParseLogLevel()` — both exported (lowercase → uppercase) in this change to make the delegation clean without duplicating logic.

### Standalone Binary Refactoring

`mcp-server/cmd/mcp-server-stigmer/main.go` went from ~120 lines to ~50 lines:

```go
func main() {
    cfg, err := mcpserver.DefaultConfig()
    if err != nil {
        fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
        os.Exit(1)
    }
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()
    if err := mcpserver.Run(ctx, cfg); err != nil {
        os.Exit(1)
    }
}
```

The binary is now a proof that the public API is complete — if `main.go` can be reduced to this, any caller can use the same contract.

### CLI Command (`client-apps/cli/cmd/stigmer/root/mcp_server.go`)

The Cobra command exposes 6 flags that mirror the corresponding env vars:

| Flag | Env var | Description |
|------|---------|-------------|
| `--transport` | `STIGMER_MCP_TRANSPORT` | `stdio`, `http`, or `both` |
| `--port` | `STIGMER_MCP_HTTP_PORT` | HTTP listen port |
| `--server-address` | `STIGMER_SERVER_ADDRESS` | gRPC target for stigmer-server |
| `--api-key` | `STIGMER_API_KEY` | API key (required for stdio/both) |
| `--log-format` | `STIGMER_MCP_LOG_FORMAT` | `text` or `json` |
| `--log-level` | `STIGMER_MCP_LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |

Flags only override the env-var default when explicitly set (`""` counts as unset). Unset flags fall through to env-var values. This is consistent with the flag behavior of the rest of the Stigmer CLI.

### go.mod Fix (Incidental)

`client-apps/cli/go.mod` was missing `replace` directives for workspace-local modules (`stigmer-server`, `workflow-runner`, `backend/libs/go`, `mcp-server`). These were added so `go mod tidy` can resolve all imports without the `go.work` crutch. This was a pre-existing gap exposed by adding the new `mcp-server` dependency.

## Benefits

- **Single binary for MCP users**: `stigmer mcp-server` works out of the box for any user who has `stigmer` installed
- **Simpler Cursor / Claude Desktop configuration**: `{ "command": "stigmer", "args": ["mcp-server"] }` — no absolute path required
- **Clean public API**: Any future Go program can embed the MCP server with three lines of code
- **Standalone binary simplified**: `main.go` is now a 50-line thin wrapper; easier to read and reason about
- **`go mod tidy` restored**: The CLI module is now self-consistent without depending on `go.work` for resolution
- **18 new tests**: Public API validation tests + CLI command tests bring the MCP server suite to 84 tests across 11 packages

## Impact

**End users**: Can now configure Cursor/Claude Desktop with `stigmer mcp-server` instead of a separate binary path.

**Developers**: The `pkg/mcpserver` public API is the sanctioned extension point for future embedding scenarios (e.g., running the MCP server inside an integration test harness, or embedding it in a future agent runner).

**CLI**: Gains the `mcp-server` command, visible in `stigmer --help`.

**mcp-server module**: `internal/config.Validate()` and `internal/config.ParseLogLevel()` are now exported. This is intentional — they are utility functions that other callers within the module may reasonably need.

## Related Work

- [2026-02-18: MCP Server Scaffolding](_changelog/2026-02/2026-02-18-124027-mcp-server-stigmer-scaffolding.md)
- [2026-02-18: MCP Server Test Suite](_changelog/2026-02/2026-02-18-130941-mcp-server-test-suite.md)
- [2026-02-18: MCP Server Observability Hardening](_changelog/2026-02/2026-02-18-145040-mcp-server-observability-hardening.md)
- [2026-02-18: MCP Server README and Resource Templates](_changelog/2026-02/2026-02-18-160901-mcp-server-readme-and-resource-templates.md)

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (Session 5 of project 20260217.01.stigmer-mcp-server)
