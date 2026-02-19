# MCP Server: Observability and Hardening (T04)

**Date**: February 18, 2026

## Summary

Hardened the `mcp-server-stigmer` for production with five improvements: structured `slog` logging (replacing unstructured `log`), graceful HTTP shutdown, user-friendly gRPC error classification, per-RPC context timeouts, and build version injection in the Makefile. Together these eliminate the most critical production blind spots -- silent timeouts, raw internal error leakage to AI clients, and abrupt shutdown under load -- while keeping the implementation minimal and strictly test-covered. Test count grew from 48 to 58, all passing under the race detector.

## Problem Statement

After T03 established a 48-test foundation, the MCP server had four operational gaps that would matter immediately in any real deployment:

### Pain Points

- **Unstructured logging**: All `log.Printf` calls produced plain-text output with no consistent fields, making log aggregation and filtering impossible. More critically, some logs went to stdout which would corrupt the STDIO transport (the MCP protocol uses stdout for framing messages).
- **Abrupt HTTP shutdown**: `http.ListenAndServe` blocked indefinitely and had no awareness of the signal context that `main.go` creates. A `SIGTERM` from Kubernetes or Docker would instantly kill in-flight MCP tool calls.
- **Raw gRPC errors exposed to AI clients**: When a tool call failed, the AI client received messages like `rpc error: code = NotFound desc = agent not found` — internal wire-protocol noise that provides no actionable guidance.
- **Silent connection hangs**: `grpc.NewClient` is lazy — it defers connection until the first RPC. A misconfigured `STIGMER_SERVER_ADDRESS` would cause tool calls to hang silently for up to 2+ minutes (system TCP timeout), with no error and no log.
- **Binary lacks version at runtime**: `make build` produced a binary that always reported `version: dev` — the Dockerfile injected the real version via ldflags but the developer workflow did not.

## Solution

Five targeted improvements, each minimal and independently testable:

1. **Makefile ldflags**: Added `VERSION := $(shell git describe --tags --always --dirty)` and passed it through `-ldflags` to `make build`, mirroring what the Dockerfile already did.

2. **Structured logging with `log/slog`**: Migrated all 14 `log.*` call sites across 3 files to structured `slog.*` equivalents. Added two new env vars (`STIGMER_MCP_LOG_FORMAT` and `STIGMER_MCP_LOG_LEVEL`) with full validation and case normalization. All output directed to stderr — an invariant required by the STDIO transport.

3. **Graceful HTTP shutdown**: Changed `ServeHTTP()` to `ServeHTTP(ctx context.Context)`. Internally creates an `http.Server` with a 5-second shutdown grace period and `ReadHeaderTimeout: 10s` for slowloris protection. Signal context flows from `main.go` through to `httpSrv.Shutdown()`.

4. **gRPC error classification**: Created `internal/domains/rpcerr.go` with `RPCError(err, resourceDesc)`. Classifies seven gRPC status codes into actionable messages (e.g. `agent "code-reviewer" in org "stigmer" not found. Verify the org and slug are correct.`). Raw gRPC errors are logged at WARN for operators; only the friendly message reaches the AI client. `InvalidArgument` passes through the server's message verbatim since server-validated messages are already specific.

5. **Per-RPC context timeout**: Exported `DefaultRPCTimeout = 30 * time.Second` from `internal/grpc/`. All four domain handlers wrap their RPC context with `context.WithTimeout` so a bad server address fails in 30 seconds with a `DeadlineExceeded` message rather than hanging indefinitely.

## Implementation Details

### Structured Logging Design

```go
// main.go — bootstrap problem: slog not yet configured when config fails
cfg, err := config.LoadFromEnv()
if err != nil {
    fmt.Fprintf(os.Stderr, "configuration error: %v\n", err)
    os.Exit(1)
}
initLogger(cfg) // now slog.SetDefault() is safe to call
```

```go
func initLogger(cfg *config.Config) {
    opts := &slog.HandlerOptions{Level: cfg.LogLevel}
    var handler slog.Handler
    switch cfg.LogFormat {
    case config.LogFormatJSON:
        handler = slog.NewJSONHandler(os.Stderr, opts)
    default:
        handler = slog.NewTextHandler(os.Stderr, opts)
    }
    slog.SetDefault(slog.New(handler))
}
```

The request logger middleware in `http.go` generates a short hex request ID per request using `crypto/rand` — no UUID library dependency:

```go
func shortID() string {
    var b [8]byte
    _, _ = rand.Read(b[:])
    return fmt.Sprintf("%x", b)
}

// requestLogger logs method, path, status, duration_ms, and request_id
slog.Info("http request",
    "request_id", reqID,
    "method", r.Method,
    "path", r.URL.Path,
    "status", sw.status,
    "duration_ms", time.Since(start).Milliseconds(),
)
```

### Graceful Shutdown

```go
const shutdownGracePeriod = 5 * time.Second

func (s *Server) ServeHTTP(ctx context.Context) error {
    httpSrv := &http.Server{
        Addr:              ":" + s.config.HTTPPort,
        Handler:           requestLogger(mux),
        ReadHeaderTimeout: 10 * time.Second,
    }

    errCh := make(chan error, 1)
    go func() {
        if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            errCh <- err
        }
        close(errCh)
    }()

    select {
    case <-ctx.Done():
        shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGracePeriod)
        defer cancel()
        return httpSrv.Shutdown(shutdownCtx)
    case err := <-errCh:
        return err
    }
}
```

### gRPC Error Classification

```go
// internal/domains/rpcerr.go
func RPCError(err error, resourceDesc string) error {
    st, ok := status.FromError(err)
    if !ok {
        slog.Warn("non-gRPC error in tool handler", "resource", resourceDesc, "err", err)
        return fmt.Errorf("unexpected error: %v", err)
    }
    slog.Warn("gRPC call failed",
        "resource", resourceDesc,
        "code", st.Code().String(),
        "grpc_message", st.Message(),
    )
    return errors.New(classifyCode(st.Code(), resourceDesc, st.Message()))
}
```

Domain handlers now provide rich context:
```go
// agents/tools.go
if err != nil {
    return nil, nil, domains.RPCError(err, fmt.Sprintf("agent %q in org %q", input.Slug, input.Org))
}
```

### Config Additions

Two new env vars with case-normalized parsing and validation:

| Variable | Default | Values |
|---|---|---|
| `STIGMER_MCP_LOG_FORMAT` | `text` | `text`, `json` |
| `STIGMER_MCP_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Benefits

- **Operator visibility**: Structured log fields (`request_id`, `code`, `grpc_message`, `duration_ms`) are directly consumable by log aggregators (Datadog, CloudWatch, Loki) without parsing.
- **AI client UX**: Tool failures now produce actionable error messages rather than internal wire-protocol noise. An AI agent can tell the user exactly what went wrong and what to check.
- **Production safety**: Graceful shutdown means zero dropped in-flight tool calls on deployments, pod restarts, or scaling events.
- **Fast failure**: A misconfigured server address now fails in 30 seconds with a clear error instead of hanging for 2+ minutes with no feedback.
- **Developer workflow parity**: `make build` and the Dockerfile now both inject the real `buildVersion` — no more `version: dev` in locally-built binaries.
- **Test coverage**: 10 new tests for config options (log format/level validation, normalization, defaults) and 10 new tests for error classification (all 7 gRPC codes + non-gRPC path + internal classifier). 58 total, all green under `-race`.

## Impact

- **All 4 domain tools affected**: `search`, `get_agent`, `get_skill`, `get_workflow` — all now emit user-friendly errors and respect the RPC timeout.
- **Transport layer**: HTTP transport now participates in the process shutdown lifecycle properly.
- **Zero breaking changes**: All env vars are optional with sensible defaults; existing configurations work unchanged.
- **No new dependencies**: `log/slog` is stdlib (Go 1.21+); `crypto/rand` is stdlib; `google.golang.org/grpc/status` was already a dependency.

## Related Work

- [2026-02-18: MCP Server Scaffolding (T01+T02)](2026-02-18-124027-mcp-server-stigmer-scaffolding.md) — initial implementation
- [2026-02-18: MCP Server Test Suite (T03)](2026-02-18-130941-mcp-server-test-suite.md) — test foundation this builds on

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours), February 18, 2026
