# Bootstrap MCP Server Integration

**Date**: February 23, 2026

## Summary

Extended the Stigmer server bootstrap process to automatically apply MCP server resources from the seedpack on startup. This completes the bridge between the seedpack MCP server definition (Phase 1) and the running server, ensuring the built-in Stigmer MCP server is registered as a first-class resource alongside system skills and agents.

## Problem Statement

Phase 1 added the `stigmer-mcp-server` YAML definition to the seedpack and the Go types to load it, but the bootstrap process had no knowledge of MCP servers. On server startup, skills and agents were applied from the seedpack, but MCP servers were silently ignored.

### Pain Points

- MCP servers defined in the seedpack were not applied on startup
- No idempotent create/update path for bootstrapped MCP servers
- The downstream mcpserver client was missing an `Apply` method (only had CRUD for the reconciliation engine)
- `NewBootstrapper` constructor had no way to receive an MCP server client

## Solution

Extended the bootstrap package following the exact patterns established for agents: interface, method, hash function, state tracking, and degraded-mode error handling. Combined with the server.go wiring (originally planned as a separate phase) since the constructor signature change made them naturally coupled.

## Implementation Details

### Downstream Client Gap

The mcpserver downstream client had `Create`, `Update`, `Delete` (for the reconciliation engine) but no `Apply`. The proto and controller both supported `apply` already. Added the `Apply` method to the client, completing the CRUD+Apply surface.

### Bootstrap Extension (5 files, ~420 lines changed)

- **`McpServerClient` interface** — Single-method interface (`Apply`) for dependency injection, matching `SkillClient` and `AgentClient`
- **`bootstrapMcpServer()` method** — Mirrors `bootstrapAgent()`: load YAML, compute content hash, check idempotency, set org, apply, record state
- **`calculateMcpServerHash()`** — Hashes name, description, transport config (command+args for stdio, URL for HTTP), and tags. Deliberately excludes system-populated fields to preserve idempotency across restarts
- **`Run()` loop** — MCP servers are bootstrapped after agents, with independent error tracking (`mcpServerErrors`)
- **State key** — `"mcpserver:<name>"` prefix in the bootstrap_state table

### Server Wiring

The `mcpServerClient` variable already existed in `server.go` (line 361). The only change was passing it as the 4th argument to `NewBootstrapper`.

### Test Coverage

- Updated all 7 existing tests for the new constructor signature
- Added `MockMcpServerClient` following the `MockAgentClient` pattern
- Added `TestBootstrapper_Run_DegradedMode_McpServerError` — verifies skill and agent bootstrap still proceed when MCP server fails
- Added `TestCalculateMcpServerHash` — verifies determinism and sensitivity to key field changes

## Benefits

- MCP servers are now bootstrapped alongside skills and agents on every server startup
- Idempotent: same seedpack version skips re-application; content hash detects YAML changes
- Degraded mode: MCP server bootstrap failure does not block server startup
- Clean extension of established patterns — no new abstractions or architectural changes

## Impact

- **Bootstrap process**: Now handles three resource types (skills, agents, MCP servers)
- **Downstream mcpserver client**: Now has full CRUD+Apply surface, consistent with the agent client
- **Server startup**: The built-in `stigmer-mcp-server` resource is automatically available after bootstrap
- **Future phases**: Phase 4 (daemon auto-start) can rely on the MCP server resource being present in the database

## Related Work

- Phase 1: Seedpack MCP Server Resource Type (2026-02-22) — added the YAML definition and Go types
- Phase 4 (upcoming): Daemon auto-start of the MCP server process
- [2026-02-22-174817-seedpack-mcp-server-resource-type.md](2026-02-22-174817-seedpack-mcp-server-resource-type.md) — Phase 1 changelog

---

**Status**: Production Ready
**Timeline**: ~1 hour implementation
