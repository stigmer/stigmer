---
name: T04 Observability Hardening
overview: Migrate the MCP server from stdlib log to slog, add user-friendly gRPC error classification, implement graceful HTTP shutdown, add RPC timeouts for connection health, and inject build version via Makefile ldflags.
todos:
  - id: t04-5-build-version
    content: Add -ldflags to Makefile build target for buildVersion injection
    status: completed
  - id: t04-1-slog
    content: "Migrate from stdlib log to slog: add LogFormat/LogLevel config, initialize in main.go, replace all 14 log.* call sites, add request-ID in HTTP requestLogger"
    status: completed
  - id: t04-3-shutdown
    content: "Graceful HTTP shutdown: replace http.ListenAndServe with http.Server, accept context, add ReadHeaderTimeout, 5s shutdown grace"
    status: completed
  - id: t04-2-errors
    content: "gRPC error classification: create domains/rpcerr.go helper, map gRPC codes to user-friendly messages, update 4 domain handlers, add rpcerr_test.go"
    status: completed
  - id: t04-4-timeout
    content: "Connection health: add DefaultRPCTimeout constant, wrap RPC calls with context.WithTimeout in all 4 domain handlers"
    status: completed
  - id: t04-verify
    content: Run full test suite (go test -race ./...), go vet, verify all tests pass
    status: completed
isProject: false
---

# T04: Observability and Hardening -- MCP Server

## Scope

Five improvements to production-readiness, ordered by dependency (logging first because subsequent items use it):

1. **Build version in Makefile** (trivial, no dependencies)
2. **Structured logging with slog** (foundation for all others)
3. **Graceful HTTP shutdown** (changes server lifecycle)
4. **gRPC error classification** (uses slog, changes domain handlers)
5. **Connection health / RPC timeouts** (changes gRPC client + handlers)

---

## T04.5: Build Version in Makefile

**What**: The Dockerfile already injects `buildVersion` via `-ldflags`. Mirror this in the local `make build` target.

**File**: `[mcp-server/Makefile](mcp-server/Makefile)`

Change the `build` target from:

```makefile
build:
	go build -o bin/$(BINARY) $(CMD)
```

to:

```makefile
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

build:
	go build -ldflags="-X github.com/stigmer/stigmer/mcp-server/internal/server.buildVersion=$(VERSION)" -o bin/$(BINARY) $(CMD)
```

This is a one-liner with zero risk.

---

## T04.1: Structured Logging (slog)

### Design

- Use `log/slog` (stdlib since Go 1.21; go.mod declares 1.25.6).
- **All output to stderr** -- critical in STDIO mode where stdout carries the MCP protocol.
- Two new config options:
  - `STIGMER_MCP_LOG_FORMAT` -- `json` | `text` (default `text`)
  - `STIGMER_MCP_LOG_LEVEL` -- `debug` | `info` | `warn` | `error` (default `info`)
- Logger initialized in `main.go`, set as the default via `slog.SetDefault()`.
- HTTP request logger middleware enriches context with a generated request ID.

### Files changed


| File                                                                          | Change                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `[internal/config/config.go](mcp-server/internal/config/config.go)`           | Add `LogFormat`, `LogLevel` fields + validation                                                                  |
| `[cmd/mcp-server-stigmer/main.go](mcp-server/cmd/mcp-server-stigmer/main.go)` | Initialize slog, replace all `log.`* calls with `slog.*`                                                         |
| `[internal/server/server.go](mcp-server/internal/server/server.go)`           | Replace `log.Printf` with `slog.Info`                                                                            |
| `[internal/server/http.go](mcp-server/internal/server/http.go)`               | Replace `log.Printf` in `ServeHTTP` and `requestLogger`; add request-ID generation in `requestLogger` middleware |


### Key detail: Request-ID in HTTP middleware

The `requestLogger` middleware will generate a UUID-based request ID, attach it to the context via `slog.With("request_id", id)`, and log it with every request. This gives us per-request correlation in HTTP mode without touching the MCP SDK's internals.

### Migration scope

14 `log.*` call sites across 3 files. No new packages needed (slog is stdlib). Remove the `"log"` import from all 3 files once migrated.

---

## T04.3: Graceful HTTP Shutdown

### Problem

`[ServeHTTP()](mcp-server/internal/server/http.go)` calls `http.ListenAndServe(addr, handler)` which blocks forever and ignores the signal context that `main.go` creates. When `SIGTERM` arrives, in-flight HTTP requests are killed immediately.

### Design

- Change signature: `ServeHTTP()` becomes `ServeHTTP(ctx context.Context)`.
- Internally create an `http.Server` struct (also lets us set `ReadHeaderTimeout` for slowloris protection).
- Start `ListenAndServe` in a goroutine; select on context cancellation or serve error.
- On cancellation, call `httpSrv.Shutdown()` with a 5-second grace period.

### Files changed


| File                                                                          | Change                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `[internal/server/http.go](mcp-server/internal/server/http.go)`               | Replace `http.ListenAndServe` with `http.Server` + shutdown logic; add `ReadHeaderTimeout: 10s` |
| `[cmd/mcp-server-stigmer/main.go](mcp-server/cmd/mcp-server-stigmer/main.go)` | Pass `ctx` to `srv.ServeHTTP(ctx)` in both `TransportHTTP` and `TransportBoth` branches         |


### Sketch

```go
func (s *Server) ServeHTTP(ctx context.Context) error {
    // ... setup mux, middleware ...
    httpSrv := &http.Server{
        Addr:              addr,
        Handler:           requestLogger(mux),
        ReadHeaderTimeout: 10 * time.Second,
    }

    errCh := make(chan error, 1)
    go func() {
        if err := httpSrv.ListenAndServe(); err != http.ErrServerClosed {
            errCh <- err
        }
        close(errCh)
    }()

    select {
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        return httpSrv.Shutdown(shutdownCtx)
    case err := <-errCh:
        return err
    }
}
```

---

## T04.2: gRPC Error Classification

### Problem

Domain handlers expose raw gRPC errors to the AI client:
`"get_agent RPC: rpc error: code = NotFound desc = agent not found"`

### Design

Create a shared helper in `[internal/domains/](mcp-server/internal/domains/)` that:

1. Extracts the gRPC status code from the error.
2. Maps it to a user-friendly message using context provided by the caller.
3. Returns a clean `error` for the SDK to wrap into `CallToolResult.IsError=true`.
4. The original gRPC error is logged via `slog.Warn` for debugging.

### New file: `internal/domains/rpcerr.go`

```go
func RPCError(err error, resourceDesc string) error
```

Mapping:


| gRPC Code          | User-facing message                                                             |
| ------------------ | ------------------------------------------------------------------------------- |
| `NotFound`         | `"{resourceDesc} not found. Verify the org and slug are correct."`              |
| `PermissionDenied` | `"Permission denied for {resourceDesc}. Check your API key permissions."`       |
| `Unauthenticated`  | `"Authentication failed. Check your API key."`                                  |
| `Unavailable`      | `"Stigmer server is unavailable. Ensure it is running and reachable."`          |
| `DeadlineExceeded` | `"Request timed out contacting stigmer-server."`                                |
| `InvalidArgument`  | Pass through the gRPC status message (server-validated, already user-friendly). |
| default            | `"Unexpected error: {original message}"`                                        |


### Handler change pattern (4 files)

Before:

```go
if err != nil {
    return nil, nil, fmt.Errorf("get_agent RPC: %w", err)
}
```

After:

```go
if err != nil {
    return nil, nil, domains.RPCError(err, fmt.Sprintf("agent %q in org %q", input.Slug, input.Org))
}
```

### Files changed


| File                                                                                    | Change                                   |
| --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `internal/domains/rpcerr.go` (new)                                                      | Shared error classification helper       |
| `internal/domains/rpcerr_test.go` (new)                                                 | Tests for all code mappings              |
| `[internal/domains/agents/tools.go](mcp-server/internal/domains/agents/tools.go)`       | Use `domains.RPCError` for the RPC error |
| `[internal/domains/skills/tools.go](mcp-server/internal/domains/skills/tools.go)`       | Same                                     |
| `[internal/domains/workflows/tools.go](mcp-server/internal/domains/workflows/tools.go)` | Same                                     |
| `[internal/domains/search/tools.go](mcp-server/internal/domains/search/tools.go)`       | Same                                     |


---

## T04.4: Connection Health / RPC Timeouts

### Problem

`grpc.NewClient` is lazy -- it doesn't actually connect until the first RPC. If the server address is wrong, the call hangs until the system-level TCP timeout (often 2+ minutes).

### Design

Add a per-RPC context timeout so calls fail fast. Use a package-level constant in `internal/grpc/client.go`:

```go
const DefaultRPCTimeout = 30 * time.Second
```

Each domain handler wraps its context before making the RPC:

```go
rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
defer cancel()
agent, err := client.GetByReference(rpcCtx, ...)
```

30 seconds is generous for both local (milliseconds) and remote (seconds) servers. If this proves too long or too short, it can be made configurable later.

### Files changed


| File                                                                                    | Change                              |
| --------------------------------------------------------------------------------------- | ----------------------------------- |
| `[internal/grpc/client.go](mcp-server/internal/grpc/client.go)`                         | Export `DefaultRPCTimeout` constant |
| `[internal/domains/agents/tools.go](mcp-server/internal/domains/agents/tools.go)`       | Add timeout to RPC call context     |
| `[internal/domains/skills/tools.go](mcp-server/internal/domains/skills/tools.go)`       | Same                                |
| `[internal/domains/workflows/tools.go](mcp-server/internal/domains/workflows/tools.go)` | Same                                |
| `[internal/domains/search/tools.go](mcp-server/internal/domains/search/tools.go)`       | Same                                |


---

## Test plan

- All new code gets tests: `rpcerr_test.go` for error classification, config tests for new log options.
- `http_test.go` gets a test for graceful shutdown behavior.
- Run full suite: `go test -v -race -timeout 30s ./...` -- must remain at 48+ tests, all green.
- `go vet ./...` clean.

## Out of scope

- Configurable RPC timeout via env var (can add later if needed).
- Log rotation / external log shipping (container infrastructure concern).
- Metrics / tracing (future task, likely T05).

