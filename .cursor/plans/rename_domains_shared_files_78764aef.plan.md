---
name: Rename domains shared files
overview: Rename 5 files in the `domains` package to replace "helper" and "util" suffixes with names that express each file's actual responsibility. Add a `doc.go` with proper package documentation. No code changes, no import changes -- purely a naming correction.
todos:
  - id: rename-marshal
    content: git mv jsonutil.go -> marshal.go and jsonutil_test.go -> marshal_test.go
    status: completed
  - id: rename-uri
    content: git mv uriutil.go -> resourceuri.go and uriutil_test.go -> resourceuri_test.go
    status: completed
  - id: rename-conn
    content: git mv grpchelper.go -> conn.go and grpchelper_test.go -> conn_test.go
    status: completed
  - id: rename-tool
    content: git mv toolhelper.go -> toolresult.go and toolhelper_test.go -> toolresult_test.go
    status: completed
  - id: rename-resource
    content: git mv resourcehelper.go -> resourcehandler.go and resourcehelper_test.go -> resourcehandler_test.go
    status: completed
  - id: create-doc
    content: Create doc.go with package documentation, remove package doc from marshal.go
    status: completed
  - id: verify-tests
    content: Run full test suite to confirm no regressions
    status: completed
isProject: false
---

# Rename domains shared files: Replace "helper"/"util" with responsibility-expressing names

## Rationale

"Helper" and "util" are non-names -- they tell you a file assists something but not what it owns. Each file in `domains/` has a clear single responsibility; the file name should state that responsibility directly.

## The Renames

All files live in [mcp-server/internal/domains/](mcp-server/internal/domains/).

- `jsonutil.go` --> `marshal.go` -- This file marshals and unmarshals proto messages to JSON. "marshal" names the action, not the format.
- `jsonutil_test.go` --> `marshal_test.go`
- `uriutil.go` --> `resourceuri.go` -- This file implements the `stigmer://` resource URI scheme (parsing, building, kind-to-authority mapping). The URI scheme is a domain concept, not a utility.
- `uriutil_test.go` --> `resourceuri_test.go`
- `grpchelper.go` --> `conn.go` -- This file manages authenticated gRPC connection lifecycle (`WithConnection`). Precedent: `crypto/tls/conn.go`, `net/http` connection files.
- `grpchelper_test.go` --> `conn_test.go`
- `toolhelper.go` --> `toolresult.go` -- This file constructs MCP `CallToolResult` values. Named for the artifact it produces.
- `toolhelper_test.go` --> `toolresult_test.go`
- `resourcehelper.go` --> `resourcehandler.go` -- This file constructs MCP `ResourceHandler` values. Named for the artifact it produces.
- `resourcehelper_test.go` --> `resourcehandler_test.go`

**No rename needed:** `rpcerr.go` / `rpcerr_test.go` -- already well-named (describes the concept: RPC errors).

## New file: `doc.go`

Replace the package doc currently living in `jsonutil.go` with a proper `doc.go`:

```go
// Package domains provides the shared infrastructure for all MCP domain
// implementations (agents, workflows, skills, mcpservers).
//
// It includes:
//   - Authenticated gRPC connection lifecycle (conn.go)
//   - Proto/JSON serialization for MCP wire format (marshal.go)
//   - gRPC-to-user error translation (rpcerr.go)
//   - The stigmer:// resource URI scheme (resourceuri.go)
//   - MCP tool result construction (toolresult.go)
//   - MCP resource handler factories (resourcehandler.go)
//
// Domain subdirectories (agents/, workflows/, etc.) import this package
// for shared infrastructure and implement the domain-specific tool logic,
// resource templates, and RPC calls.
package domains
```

## After state

```
mcp-server/internal/domains/
  doc.go                   -- package documentation
  conn.go                  -- WithConnection (gRPC connection lifecycle)
  marshal.go               -- MarshalJSON, UnmarshalJSON (proto/JSON serialization)
  rpcerr.go                -- RPCError (gRPC error translation)
  resourceuri.go           -- ParseResourceURI, BuildResourceURI (stigmer:// scheme)
  toolresult.go            -- TextResult, CallFetch, CallApply (MCP tool results)
  resourcehandler.go       -- NewResourceHandler, ResourceResult (MCP resource handlers)
  *_test.go                -- corresponding test files
  agents/                  -- agent domain
  mcpservers/              -- MCP server domain
  skills/                  -- skill domain
  workflows/               -- workflow domain
  search/                  -- cross-domain search
```

## What stays the same

- Package name: `domains` (correct boundary -- shared kernel for all domain packages)
- All exported function and type names (no API changes)
- All imports in consumer packages (no path changes)
- All code within each file (no logic changes)

## Execution

Use `git mv` for each rename so git tracks the history. Remove the package-level comment from `marshal.go` (it moves to `doc.go`).
