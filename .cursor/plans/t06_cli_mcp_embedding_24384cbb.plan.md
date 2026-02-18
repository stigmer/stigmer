---
name: T06 CLI MCP Embedding
overview: Embed the MCP server into the Stigmer CLI as `stigmer mcp-server`, creating a public API surface in `mcp-server/pkg/mcpserver/` and a Cobra command in the CLI. This eliminates the need for a separate binary while keeping both entry points functional.
todos:
  - id: t06-1-public-api
    content: Create mcp-server/pkg/mcpserver/ with Config, DefaultConfig(), and Run() — the public API surface
    status: completed
  - id: t06-2-refactor-main
    content: Refactor mcp-server/cmd/mcp-server-stigmer/main.go to use the new public API (validates completeness)
    status: completed
  - id: t06-3-cli-command
    content: Create Cobra command in client-apps/cli/cmd/stigmer/root/mcp_server.go with flag overrides
    status: completed
  - id: t06-4-register
    content: Register NewMCPServerCommand in root.go and run go mod tidy
    status: completed
  - id: t06-5-tests
    content: Write unit tests for public API (config, run validation) and CLI command (flags, help)
    status: completed
  - id: t06-6-verify
    content: Run full test suites in both mcp-server/ and client-apps/cli/ under -race
    status: completed
  - id: t06-7-docs
    content: Update mcp-server/README.md with CLI usage section and Cursor mcp.json example
    status: completed
isProject: false
---

# T06: CLI Embedding for the MCP Server

## What We Are Building

A `stigmer mcp-server` CLI command that starts the MCP server as a foreground process. Users and MCP clients (Cursor, Claude Desktop) can launch the server via the `stigmer` binary instead of the standalone `mcp-server-stigmer` binary.

**End-user experience:**

```bash
# Foreground STDIO mode (default — what MCP clients spawn)
stigmer mcp-server

# Foreground HTTP mode
stigmer mcp-server --transport http --port 8080

# MCP client config (Cursor mcp.json):
# { "command": "stigmer", "args": ["mcp-server"] }
```

## Design Decision: Public API Surface

The MCP server's code is currently all in `internal/`. The CLI is a separate Go module that cannot import `internal` packages. We need a public API.

**Approach:** Create `mcp-server/pkg/mcpserver/` with a minimal, well-defined public contract:

- `Config` struct — public version of the internal config, plain types only
- `DefaultConfig() (*Config, error)` — populates from env vars (same behavior as standalone binary)
- `Run(ctx context.Context, cfg *Config) error` — starts the server, blocks until ctx is cancelled

This keeps internal packages internal. The public surface is narrow — just config + run.

**Key files:**

- [mcp-server/internal/server/server.go](mcp-server/internal/server/server.go) — existing `New()` and `ServeStdio()`/`ServeHTTP()`
- [mcp-server/internal/config/config.go](mcp-server/internal/config/config.go) — existing `LoadFromEnv()`
- [mcp-server/cmd/mcp-server-stigmer/main.go](mcp-server/cmd/mcp-server-stigmer/main.go) — existing entry point (will become a thin wrapper)
- [client-apps/cli/cmd/stigmer/root.go](client-apps/cli/cmd/stigmer/root.go) — command registration
- [client-apps/cli/cmd/stigmer/root/internal.go](client-apps/cli/cmd/stigmer/root/internal.go) — BusyBox pattern precedent

## Design Decision: Command Structure

`stigmer mcp-server` will be a **single top-level command, not a command group**. No subcommands (start/stop/status).

Rationale: The MCP server is a stateless foreground process. In STDIO mode it runs until the MCP client disconnects. In HTTP mode it runs until interrupted. There is no daemon lifecycle to manage — unlike `stigmer server` which manages a background daemon with start/stop/status/logs.

## Design Decision: Authentication

The MCP server will continue to read its own env vars (`STIGMER_API_KEY`, `STIGMER_SERVER_ADDRESS`). We will **not** bridge auth from `~/.stigmer/config.yaml` in this task.

Rationale: Bridging two auth systems adds coupling and complexity. MCP clients already pass env vars when spawning the process. We can add config bridging as a separate enhancement later if there is user demand.

## Design Decision: Visibility

This will be a **visible** command (not hidden like `internal-server`). The MCP server is a user-facing feature, not a daemon implementation detail.

## Implementation

### Step 1: Create `mcp-server/pkg/mcpserver/` (public API)

**New file: `mcp-server/pkg/mcpserver/config.go`**

```go
package mcpserver

type Config struct {
    StigmerServerAddress string
    APIKey               string
    Transport            string // "stdio", "http", "both"
    HTTPPort             string
    HTTPAuthEnabled      bool
    LogFormat            string // "text", "json"
    LogLevel             string // "debug", "info", "warn", "error"
}

func DefaultConfig() (*Config, error) {
    // Delegates to internal/config.LoadFromEnv(), maps to public Config
}
```

**New file: `mcp-server/pkg/mcpserver/run.go`**

```go
package mcpserver

func Run(ctx context.Context, cfg *Config) error {
    // 1. Convert public Config -> internal config.Config
    // 2. Initialize slog (stderr, respects LogFormat/LogLevel)
    // 3. Create server via server.New(internalCfg)
    // 4. Route to transport (stdio/http/both) — same logic as main.go today
}
```

This extracts the orchestration logic from `main.go` into a reusable function. The logging initialization and transport routing move here.

### Step 2: Refactor `main.go` to use the public API

The standalone binary becomes a thin wrapper:

```go
func main() {
    cfg, err := mcpserver.DefaultConfig()
    if err != nil { /* stderr + exit 1 */ }

    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    if err := mcpserver.Run(ctx, cfg); err != nil { /* log + exit 1 */ }
}
```

This validates that the public API is complete — if `main.go` can be reduced to this, any caller can use the same contract.

### Step 3: Add the CLI command

**New file: `client-apps/cli/cmd/stigmer/root/mcp_server.go`**

```go
func NewMCPServerCommand() *cobra.Command {
    cmd := &cobra.Command{
        Use:   "mcp-server",
        Short: "Start the Stigmer MCP server",
        Long:  `Start the MCP server that exposes Stigmer resources to AI coding assistants...`,
        RunE: func(cmd *cobra.Command, args []string) error {
            cfg, err := mcpserver.DefaultConfig()
            if err != nil { return err }
            // Apply flag overrides (non-empty values only)
            applyFlagOverrides(cmd, cfg)
            ctx, cancel := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
            defer cancel()
            return mcpserver.Run(ctx, cfg)
        },
    }
    // Flags: --transport, --port, --server-address, --api-key, --log-format, --log-level
    return cmd
}
```

Flag values override env var defaults. Unset flags fall through to env var values.

### Step 4: Register in `root.go`

Add `rootCmd.AddCommand(root.NewMCPServerCommand())` in the appropriate section of [client-apps/cli/cmd/stigmer/root.go](client-apps/cli/cmd/stigmer/root.go).

### Step 5: Module dependency

The `go.work` file already includes `./mcp-server`, so the CLI can import from it without explicit `replace` directives (same pattern as `internal-server` importing from `stigmer-server`). After adding the import, run `go mod tidy` in the CLI module to update `go.mod` and `go.sum`.

### Step 6: Tests

- `**mcp-server/pkg/mcpserver/run_test.go**`: Verify `DefaultConfig()` reads env vars correctly. Verify `Run()` fails fast with invalid config (bad transport value, missing API key for stdio).
- `**client-apps/cli/cmd/stigmer/root/mcp_server_test.go**`: Verify command registration, flag parsing, help text.
- Run existing MCP server tests (`go test -race ./...` in `mcp-server/`) to confirm no regressions.

### Step 7: Update documentation

- Update [mcp-server/README.md](mcp-server/README.md): add "Running via CLI" section showing `stigmer mcp-server` alongside the standalone binary instructions.
- Include Cursor `mcp.json` example using the `stigmer` binary.

## Files Changed (Summary)


| File                                                  | Action                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `mcp-server/pkg/mcpserver/config.go`                  | **New** — public Config + DefaultConfig()        |
| `mcp-server/pkg/mcpserver/run.go`                     | **New** — public Run() entry point               |
| `mcp-server/pkg/mcpserver/run_test.go`                | **New** — unit tests                             |
| `mcp-server/cmd/mcp-server-stigmer/main.go`           | **Modified** — thin wrapper around mcpserver.Run |
| `client-apps/cli/cmd/stigmer/root/mcp_server.go`      | **New** — Cobra command                          |
| `client-apps/cli/cmd/stigmer/root/mcp_server_test.go` | **New** — command tests                          |
| `client-apps/cli/cmd/stigmer/root.go`                 | **Modified** — register NewMCPServerCommand      |
| `client-apps/cli/go.mod` + `go.sum`                   | **Modified** — via `go mod tidy`                 |
| `mcp-server/README.md`                                | **Modified** — CLI usage docs                    |


## Risks and Notes

- **Binary size**: The MCP SDK (`go-sdk v1.3.0`) becomes a transitive dependency of the CLI binary. This is a lightweight library so the impact should be negligible.
- **gRPC version**: MCP server uses gRPC v1.79.1, CLI uses v1.78.0. Go's MVS will resolve to v1.79.1 for the CLI build. This is a minor semver bump and should be backward compatible, but we should verify the build succeeds.
- **Logging isolation**: The MCP server initializes `slog` globally. The CLI uses `zerolog`. We need to ensure the MCP server's `slog.SetDefault()` call doesn't conflict. Since the MCP server runs as a blocking foreground command (not returning control to the CLI), this should be fine — by the time `Run()` is called, no more CLI logging happens.

