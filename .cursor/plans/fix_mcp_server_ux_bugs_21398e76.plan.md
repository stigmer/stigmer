---
name: Fix MCP server UX bugs
overview: "Fix three interconnected bugs that produce a broken first-run experience: seedpack not applied during `stigmer server`, stale FTS5 search index after resource creation, and discovery incorrectly skipping the stigmer MCP server on local backend."
todos:
  - id: bug1-export-seedpack
    content: Export `ensureSeedpackBootstrapped` as `EnsureSeedpackBootstrapped` in daemon.go and call it from `handleServerStart()` in server.go between daemon start and bootstrap discovery
    status: completed
  - id: bug2-index-step
    content: Create `IndexSearchStep` pipeline step in `backend/libs/go/grpc/request/pipeline/steps/index_search.go` that calls `store.UpsertSearchIndex()` using the appropriate extractor
    status: completed
  - id: bug2-delete-index-step
    content: Create `DeleteSearchIndexStep` pipeline step that calls `store.DeleteSearchIndex()` for resource deletion pipelines
    status: completed
  - id: bug2-wire-pipelines
    content: Add `IndexSearchStep` after `PersistStep` in create/update/apply pipelines for all searchable resource kinds (agent, skill, mcp_server, workflow, project); add `DeleteSearchIndexStep` to delete pipelines
    status: completed
  - id: bug3-api-key-resolution
    content: Change `resolveStigmerAPIKey` to return `(string, bool)` and treat local backend as resolved-to-empty; update `resolveKnownVar` and `ResolveEnvForDiscovery` to pass empty-but-resolved values as overrides
    status: completed
isProject: false
---

# Fix MCP Server First-Run UX: Seedpack Timing, Search Index, Discovery

## Problem Summary

Running `stigmer server` then `stigmer list mcp-server` produces a broken experience:

1. Seedpack runs during `list` instead of during `server` start
2. List returns "No MCP Server found" even after seedpack creates the server
3. Discovery skips stigmer-mcp-server because STIGMER_API_KEY is empty on local backend

These are three distinct bugs with independent root causes.

---

## Bug 1: Seedpack Not Applied During `stigmer server`

**Root cause:** `handleServerStart()` in [server.go](client-apps/cli/cmd/stigmer/root/server.go) calls `daemon.StartWithOptions()` (line 159) which does NOT call `ensureSeedpackBootstrapped()`. It then immediately calls `runBootstrapDiscovery()` (line 188) against an empty database. The seedpack is deferred to the first `EnsureRunning()` call from any other CLI command.

**Correct sequence should be:**

```mermaid
flowchart LR
    A[StartWithOptions] --> B[ensureSeedpackBootstrapped]
    B --> C[runBootstrapDiscovery]
    C --> D["Ready!"]
```



**Fix:** In `handleServerStart()`, call `daemon.EnsureSeedpackBootstrapped(dataDir)` after `StartWithOptions()` succeeds and before `runBootstrapDiscovery()`.

- File: [client-apps/cli/cmd/stigmer/root/server.go](client-apps/cli/cmd/stigmer/root/server.go) (between lines 182 and 187)
- File: [client-apps/cli/internal/cli/daemon/daemon.go](client-apps/cli/internal/cli/daemon/daemon.go) -- export `ensureSeedpackBootstrapped` as `EnsureSeedpackBootstrapped` so `server.go` can call it

This means `stigmer server` becomes the canonical place where seedpack is applied, and `EnsureRunning()` handles it as a safety net for the case where someone didn't use `stigmer server` explicitly.

---

## Bug 2: Search Index Not Updated on Resource Mutation

**Root cause:** The FTS5 search index is rebuilt only at server startup (`server.go:373` via `RebuildIndex()`). The `PersistStep` pipeline step ([persist.go](backend/libs/go/grpc/request/pipeline/steps/persist.go)) only calls `store.SaveResource()` -- it never calls `store.UpsertSearchIndex()`. So resources created after startup (including by seedpack) are invisible to list/search until a daemon restart.

**Fix:** Create a new `IndexSearchStep` pipeline step and add it after `PersistStep` in every create/update/apply pipeline for searchable resource kinds (agent, skill, mcp_server, workflow, project).

### New file: `backend/libs/go/grpc/request/pipeline/steps/index_search.go`

This step will:

1. Accept the store and the appropriate `Extractor` as constructor parameters
2. In `Execute()`: extract search fields from `ctx.NewState()` via the extractor, then call `store.UpsertSearchIndex()`

### Pipeline updates required (add `IndexSearchStep` after `PersistStep`):

- [backend/services/stigmer-server/pkg/domain/mcpserver/controller/create.go](backend/services/stigmer-server/pkg/domain/mcpserver/controller/create.go)
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/apply.go`
- `backend/services/stigmer-server/pkg/domain/mcpserver/controller/update.go`
- Equivalent create/update/apply in `agent/`, `skill/`, `workflow/`, `project/` controllers
- Delete pipelines: call `store.DeleteSearchIndex()` after delete

### Also needed for `DeleteStep`:

Create a corresponding `DeleteSearchIndexStep` that calls `store.DeleteSearchIndex()`, added after the delete persist step in delete pipelines.

**Note:** The `McpServerController` struct will need the `store.Store` reference (it already has it) plus access to the appropriate extractor. The extractor can be instantiated directly (e.g., `extractor.NewMcpServerExtractor()`) since each domain knows its own type.

---

## Bug 3: Discovery Incorrectly Skips stigmer-mcp-server on Local Backend

**Root cause:** In [env_resolver.go](client-apps/cli/internal/cli/mcpserver/env_resolver.go) lines 126-131:

```go
case "STIGMER_API_KEY":
    val := resolveStigmerAPIKey(cfg)
    if val == "" {
        return "", false  // marked as "unresolved" -> discovery skipped
    }
```

For local backend, `resolveStigmerAPIKey()` returns `""` (line 170) because local doesn't need auth. But the caller treats empty as "unresolved", which skips discovery entirely.

**The user's guidance is correct:** attempt discovery with whatever values are available. Let the MCP server process itself reject if credentials are truly required. The CLI should not pre-emptively gatekeep.

**Fix (two parts):**

### Part A: Allow empty-but-resolved values

Change `resolveKnownVar` for `STIGMER_API_KEY` to distinguish "resolved to empty" (local backend, intentionally no auth) from "cannot resolve" (cloud backend, no token configured):

```go
case "STIGMER_API_KEY":
    val, resolved := resolveStigmerAPIKey(cfg)
    if !resolved {
        return "", false
    }
    return val, true
```

Update `resolveStigmerAPIKey` to return `(string, bool)`:

- Local backend: `return "", true` (resolved, intentionally empty)
- Cloud backend with token: `return token, true`
- Cloud backend without token: `return "", false` (genuinely unresolved)

### Part B: Pass empty-but-resolved values as overrides

In `ResolveEnvForDiscovery`, when `resolveKnownVar` returns `("", true)`, still add it to `Overrides` as `STIGMER_API_KEY=` (empty value). This passes the env var to the MCP server process which can then decide what to do.

---

## Verification

After all three fixes, the expected first-run flow becomes:

```
$ stigmer server
  Starting Stigmer server...
  [daemon starts]
  Applying system resources (seedpack)...     <-- seedpack now runs here
  [agents, skills, MCP servers created]
  [search index updated via IndexSearchStep]
  Discovering MCP server capabilities...
  [stigmer-mcp-server discovery ATTEMPTED]    <-- no longer skipped
  Ready!

$ stigmer list mcp-server
  [no seedpack triggered]
  stigmer-mcp-server   Built-in MCP server...  <-- appears in results
```

