# Bootstrap MCP Discovery Integration

**Date**: February 25, 2026

## Summary

Integrated automatic MCP server capability discovery into the Stigmer CLI daemon startup flow. After the daemon boots and seedpack MCP servers are applied, the CLI now synchronously discovers each server's tools and resource templates and pushes them to the backend. A shared discovery library was extracted to enable reuse across the CLI's manual `discover` command and the new bootstrap path.

## Problem Statement

After Phases 1–4 delivered the proto foundation, RPC handlers, and a manual `stigmer discover mcp-server` command, discovery still required explicit user invocation. MCP server capabilities weren't available to agents until someone ran the command.

### Pain Points

- Agents couldn't see available MCP tools until a user manually ran `stigmer discover mcp-server`
- No automatic discovery during daemon startup meant a gap between "server running" and "tools available"
- Discovery logic was tightly coupled to the CLI command, making it hard to reuse in the bootstrap path
- MCP servers that need credentials (e.g., `STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`) had no automatic resolution mechanism

## Solution

Three-part integration: (1) extract a shared MCP discovery library, (2) add credential resolution and a `DiscoverAll` batch function in the CLI, (3) wire it into the daemon startup flow so discovery runs automatically and synchronously.

## Implementation Details

### Shared Library: `backend/libs/go/mcpdiscovery/`

Extracted core MCP discovery logic into a reusable Go package with three files:

- **`transport.go`** — `CreateTransport(spec, envOverrides)` builds stdio or HTTP transports. For stdio, `mergeEnv` overlays caller-provided env vars on top of `os.Environ()` so credentials can be injected without mutating the process environment.
- **`convert.go`** — `ConvertTools` and `ConvertResourceTemplates` map MCP SDK types (`mcp.Tool`, `mcp.ResourceTemplate`) to Stigmer proto types (`DiscoveredTool`, `DiscoveredResourceTemplate`), including robust `InputSchema` handling via `structpb.Struct`.
- **`discover.go`** — `Discover(ctx, spec, envOverrides, source)` orchestrates the full flow: create transport → initialize MCP client → list tools/templates with pagination → convert → stamp timestamp → return `DiscoveredCapabilities`.

### CLI Refactoring

- Deleted `discover_transport.go` and `discover_convert.go` from the CLI package (moved to shared library)
- `discover.go` now calls `mcpdiscovery.Discover()` instead of inlining the logic
- Added `DiscoverServer()` convenience function for the bootstrap flow (takes a pre-fetched `McpServer` proto)

### Credential Resolution: `env_resolver.go`

`ResolveEnvForDiscovery(server, cfg)` generates `KEY=VALUE` env overrides for each MCP server:

- Reads the server's `env_spec` map to know which variables are expected
- Checks `os.Getenv()` first — user's shell env always wins
- Falls back to CLI config for known variables: `STIGMER_SERVER_ADDRESS` (localhost for local, cloud endpoint for cloud) and `STIGMER_API_KEY` (stored auth token for cloud)
- Extensible: adding a new credential source (e.g., `GITHUB_TOKEN` from `~/.config/gh/hosts.yml`) means adding a case to `resolveKnownVar`

### Auto-Discovery: `discover_all.go`

`DiscoverAll(ctx, opts)` is the batch discovery entry point:

- Uses the search API (`ApiResourceKind_mcp_server`) to enumerate all MCP servers
- Fetches full proto for each via `GetByReference`
- Filters to stdio transport (HTTP servers are typically remote and don't need bootstrap discovery)
- Resolves env, discovers, pushes via `UpdateDiscoveredCapabilities` RPC
- Best-effort: logs warnings per server on failure, doesn't abort the batch

### Bootstrap Wiring: `server.go`

`runBootstrapDiscovery(cfg)` is called synchronously after `daemon.StartWithOptions()` returns (daemon is ready) and before the "Ready!" message. It establishes a gRPC connection, resolves the org ID, calls `DiscoverAll`, and prints a summary.

## Benefits

- **Zero-touch discovery**: MCP tools and resource templates are automatically available to agents as soon as `stigmer server` starts
- **Reusable core**: Shared library in `backend/libs/go/mcpdiscovery/` can serve future server-side discovery if needed
- **Clean credential injection**: Env overrides are merged immutably via `mergeEnv` — no global state mutation
- **Best-effort resilience**: Individual MCP server failures don't block startup or other servers
- **Extensible credential resolution**: Adding support for new MCP servers (GitHub, AWS) requires only adding a case to the resolver

## Impact

- **CLI users**: `stigmer server` now automatically discovers MCP server capabilities — no manual `discover` command needed for bootstrapped servers
- **Agent system**: Agents can query available tools immediately after startup
- **Developers**: Discovery logic is centralized in one shared library instead of being duplicated

## Related Work

- [MCP Server Discovery Proto Foundation](2026-02-25-163052-mcp-server-discovery-proto-foundation.md) — Phase 1
- [MCP Server UpdateDiscoveredCapabilities RPC Handlers](2026-02-25-170634-mcp-server-updateDiscoveredCapabilities-rpc-handlers.md) — Phase 3
- [CLI Discover MCP Server Command](2026-02-25-173506-cli-discover-mcp-server-command.md) — Phase 4

---

**Status**: ✅ Production Ready
**Timeline**: Phase 5 of the MCP Tool Discovery project
