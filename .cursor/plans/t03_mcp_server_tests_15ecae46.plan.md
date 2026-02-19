---
name: T03 MCP Server Tests
overview: Write unit tests for config, auth, grpc/client, HTTP helpers, and search/parseKinds; then build integration test scaffolding with mock gRPC service implementations to test all four domain tool handlers end-to-end.
todos:
  - id: t03-1-config
    content: Unit tests for internal/config — LoadFromEnv, validation, defaults, env var edge cases
    status: completed
  - id: t03-2-auth
    content: Unit tests for internal/auth — context round-trip, empty key, TokenAuth metadata
    status: completed
  - id: t03-3-grpc
    content: Unit tests for internal/grpc/client — TLS vs insecure selection
    status: completed
  - id: t03-4-search-unit
    content: Unit tests for internal/domains/search — parseKinds pure function, Tool() metadata
    status: completed
  - id: t03-5-http
    content: Unit tests for internal/server/http — extractBearerToken, healthHandler, authMiddleware
    status: completed
  - id: t03-6-integration
    content: Integration tests for all 4 domain handlers with mock gRPC server scaffolding
    status: completed
  - id: t03-7-makefile
    content: Add mcp-server to root Makefile test-all-go target
    status: completed
isProject: false
---

# T03: MCP Server Testing

## Testing Conventions (matching the rest of the repo)

- Standard library `testing` only (no testify, no gomock)
- Table-driven subtests via `t.Run()`
- Race detection (`-race` flag, already wired in Makefile)
- Descriptive names: `TestFunctionName_scenario`
- Helper functions with `t.Helper()` for setup

## Packages to Test (6 test files)

### T03.1 — `internal/config/config_test.go`

Unit tests for `LoadFromEnv` and its validation logic. Strategy: use `t.Setenv` (Go 1.17+) to inject env vars per-subtest, avoiding global mutation.

Test cases:

- Defaults: unset everything except `STIGMER_API_KEY` -> confirm `localhost:9090`, `stdio`, `8080`, `HTTPAuthEnabled=true`
- Each env var overrides its default
- Valid transports: `stdio`, `http`, `both` (including uppercase normalization like `STDIO`)
- Invalid transport string -> error
- Missing API key in `stdio` mode -> error
- Missing API key in `both` mode -> error
- Missing API key in `http` mode -> **no error** (HTTP gets per-request keys)
- Empty `STIGMER_SERVER_ADDRESS` -> error
- `STIGMER_MCP_HTTP_AUTH_ENABLED=false` -> `HTTPAuthEnabled=false`

### T03.2 — `internal/auth/credentials_test.go`

Unit tests for context key propagation and `TokenAuth`.

Test cases:

- `WithAPIKey` / `GetAPIKey` round-trip returns the stored key
- `GetAPIKey` on a bare `context.Background()` -> error
- `GetAPIKey` after storing an empty string -> error (empty is treated as absent)
- `TokenAuth.GetRequestMetadata` returns `{"Authorization": "Bearer <token>"}`
- `TokenAuth.RequireTransportSecurity` returns `false`

### T03.3 — `internal/grpc/client_test.go`

Unit tests for `NewConnection`. `grpc.NewClient` is lazy (it doesn't dial immediately), so these tests verify option assembly, not actual connectivity.

Test cases:

- Endpoint ending in `:443` -> connection created without error (TLS path)
- Endpoint not ending in `:443` (e.g. `localhost:9090`) -> connection created without error (insecure path)
- Empty endpoint -> verify behavior (currently `grpc.NewClient` accepts it; worth documenting)

### T03.4 — `internal/domains/search/tools_test.go`

Unit tests for `parseKinds` (pure function) plus tool metadata.

Test cases:

- `parseKinds(nil)` -> `nil, nil`
- `parseKinds([]string{})` -> `nil, nil`
- Single valid kind (`"agent"`, `"skill"`, `"mcp_server"`, `"workflow"`) -> correct enum
- Multiple valid kinds -> correct enum slice in order
- Invalid kind (`"bogus"`) -> error with descriptive message
- Mixed valid + invalid -> error (fails on first invalid)
- `Tool()` returns correct name and non-empty description

### T03.5 — `internal/server/http_test.go`

Unit tests for HTTP helpers using `httptest`.

Test cases:

- `extractBearerToken`: valid `Authorization: Bearer xxx` -> `"xxx"`
- `extractBearerToken`: missing header -> `""`
- `extractBearerToken`: malformed `Basic xxx` -> `""`
- `extractBearerToken`: `Bearer`  with trailing whitespace -> trimmed
- `healthHandler`: returns 200, `Content-Type: application/json`, body contains `"ok"`
- `authMiddleware`: valid token -> request reaches next handler, API key in context
- `authMiddleware`: missing token -> 401 response, next handler never called

### T03.6 — Integration test scaffolding for domain tool handlers

This is the most architecturally significant piece. Here's the approach:

**Strategy: Real gRPC server with mock service implementations (zero production code changes)**

The generated protobuf stubs already provide:

- **Server interfaces**: `SearchServiceServer`, `AgentQueryControllerServer`, `SkillQueryControllerServer`, `WorkflowQueryControllerServer`
- **Unimplemented base structs**: `UnimplementedSearchServiceServer`, etc.

We create mock implementations that embed the `Unimplemented*Server`, override the methods we need, record the incoming request, and return a canned response. A shared test helper starts a `grpc.Server` on `localhost:0` (OS-assigned port) and returns the address. Each handler test:

1. Starts the mock gRPC server
2. Injects an API key into the context via `auth.WithAPIKey`
3. Calls the handler with the test server's address
4. Verifies the handler produced the correct JSON output
5. Verifies the mock received the correct gRPC request

**File structure:**

```
mcp-server/internal/domains/
  search/tools_test.go      -- parseKinds unit tests + search handler integration test
  agents/tools_test.go      -- get_agent handler integration test
  skills/tools_test.go      -- get_skill handler integration test
  workflows/tools_test.go   -- get_workflow handler integration test
```

Mock setup helpers will live alongside each test file (unexported, test-only). If significant duplication emerges across the four handler test files, we can extract a shared `internal/testutil/` package -- but I'll start without it and see how much actually overlaps.

**What each handler integration test verifies:**

- Correct gRPC request constructed from MCP input (org, slug, kinds, etc.)
- Response marshaled to valid JSON via protojson
- Missing API key in context -> error
- gRPC error propagation (mock returns `status.Error(codes.NotFound, ...)`)
- For search: pagination fields forwarded correctly, parseKinds integration

### T03.7 — Root Makefile fix

The `test-all-go` target (line 106-112 of the root Makefile) is missing `mcp-server` and `sdk/go`. Add them for consistency with the `test` and `coverage` targets.

## What's NOT in scope

- `**internal/domains/jsonutil.go`**: Thin wrapper over `protojson.Marshal`. Tested indirectly through handler integration tests. No dedicated test file.
- `**internal/server/server.go`**: `New()` and `registerTools()` are wiring code. `ServeStdio()` delegates to the SDK's `Run()`. Testing these would require mocking the MCP SDK itself, which is excessive. They'll be validated by end-to-end testing in a future task.
- `**cmd/mcp-server-stigmer/main.go`**: Entry point with signal handling. Not unit-testable in a meaningful way.

## Execution Order

T03.1 -> T03.2 -> T03.3 -> T03.4 -> T03.5 -> T03.6 -> T03.7

Start with the simplest, zero-dependency packages (config, auth) to build confidence and momentum, then move to the packages that require gRPC scaffolding.