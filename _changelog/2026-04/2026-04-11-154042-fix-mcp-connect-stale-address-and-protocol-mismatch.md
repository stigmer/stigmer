# Fix MCP Connect: Stale Server Address and Protocol Mismatch

**Date**: April 11, 2026

## Summary

Fixed two independent failures in the MCP server connect flow: (1) a stale `STIGMER_SERVER_ADDRESS` (`stigmer-prod-api.planton.live`) being injected from the user's personal environment instead of the current `api.stigmer.ai:443`, and (2) an MCP protocol handshake failure caused by the Go MCP SDK (v1.3.0) having only partial support for the `2025-11-25` protocol version that the Python client (v1.25.0) negotiates.

## Problem Statement

After the OAuth connect flow completes, the agent-runner's `DiscoverMcpServerCapabilities` activity fails with:
- `STIGMER_SERVER_ADDRESS=stigmer-prod-api.planton.live` (pre-migration domain) in the MCP subprocess environment
- `McpError: Invalid request parameters` during the MCP `initialize` handshake

### Pain Points

- The React SDK connect hooks (`useMcpServerConnect`, `useMcpServerOAuthConnect`) sent no `runtimeEnv`, causing the Java backend to resolve env vars exclusively from the user's personal environment, which contained stale data from before the domain migration to `api.stigmer.ai`
- The Java `McpServerConnectHandler` treated `runtime_env` and personal env as mutually exclusive -- if one was present, the other was ignored entirely
- The agent-runner's `_inject_platform_env` skipped injection when the key already existed, so the stale value from the personal env was never overridden
- The agent-runner's `STIGMER_SERVER_ADDRESS` env var pointed at the internal K8s endpoint, which Daytona sandboxes (where MCP subprocesses run) cannot reach
- The Go MCP server SDK (v1.3.0) had only partial `2025-11-25` protocol support; full support landed in v1.4.0
- Daytona sessions may echo stdin to stdout, causing the Python MCP client to receive its own `initialize` request as a spurious server message

## Solution

Three-layer fix for the stale address (primary + fallback), SDK upgrade for the protocol mismatch, and echo filtering for the Daytona transport.

## Implementation Details

### Issue 1: Stale STIGMER_SERVER_ADDRESS (three layers)

**A. React SDK (primary fix)**: Both `useMcpServerConnect` and `useMcpServerOAuthConnect` now always resolve system env vars (`STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`) from the SDK context via `resolveSystemEnvVarValues()` and include them in `runtimeEnv`. Caller-provided values still win via spread ordering.

**B. Java merge (required for A)**: `McpServerConnectHandler.resolveEnvironmentVariables` now merges `runtimeEnv` ON TOP of the personal environment (instead of treating them as mutually exclusive). Personal env is the base; `runtimeEnv` overrides overlapping keys. `resolveFromPersonalEnvironment` accepts a `tolerateMissing` flag so keys expected from `runtimeEnv` don't throw.

**C. Agent-runner fallback (safety net for non-web flows)**: New `STIGMER_MCP_PUBLIC_ENDPOINT` env var on the agent-runner pod points to the public gRPC endpoint (`api.stigmer.ai:443`) via a new `prod.grpc-endpoint` entry in the `stigmer-api` variables group. `_inject_platform_env` now uses a `_PLATFORM_INJECTABLE_MAP` that maps target to source env vars and overrides instead of skipping.

### Issue 2: MCP Protocol Handshake

Upgraded `github.com/modelcontextprotocol/go-sdk` from v1.3.0 to v1.5.0 in `mcp-server/go.mod`. v1.5.0 (released Apr 7) has full `2025-11-25` protocol support, updates `latestProtocolVersion`, and includes security fixes.

### Issue 3: Daytona Stdin Echo

Added echo detection in `daytona_transport.py`. The `_on_stdout` handler now parses incoming JSON-RPC messages and drops any that have both `method` and `id` where the method is not in the known set of server-to-client MCP methods. This filters out echoed client requests that would otherwise confuse the MCP session.

### Ancillary

Aligned `mcp` package version: `requirements.txt` updated from `1.25.0` to `1.26.0` to match `poetry.lock`.

## Benefits

- MCP server connect flow works with the correct `api.stigmer.ai:443` endpoint
- OAuth connect flow (Slack, Figma, Salesforce) can complete tool discovery
- MCP `initialize` handshake succeeds with full 2025-11-25 protocol support
- Stale personal environment data cannot override platform infrastructure addresses
- Non-web flows (CLI, direct API) benefit from the agent-runner fallback injection
- Daytona stdin echo no longer disrupts MCP client sessions

## Impact

- **Users**: MCP server connect (both manual and OAuth) works end-to-end in production
- **SDK consumers**: System env vars are always injected -- no more silent failures from stale data
- **Agent execution**: The Java merge and agent-runner override benefit all flows (connect, sessions, agent runs)
- **MCP server module**: Go SDK upgrade brings security fixes and full protocol compliance

## Files Changed

### stigmer (OSS)
| File | Change |
|------|--------|
| `sdk/react/src/mcp-server/useMcpServerConnect.ts` | Inject system env vars into runtimeEnv |
| `sdk/react/src/mcp-server/useMcpServerOAuthConnect.ts` | Inject system env vars into connect call |
| `backend/services/agent-runner/worker/mcp/config_transformer.py` | `_PLATFORM_INJECTABLE_MAP`, override semantics |
| `backend/services/agent-runner/worker/mcp/daytona_transport.py` | Daytona stdin echo filter |
| `backend/services/agent-runner/_kustomize/overlays/prod/service.yaml` | Replace `STIGMER_SERVER_ADDRESS` with `STIGMER_MCP_PUBLIC_ENDPOINT` |
| `backend/services/agent-runner/requirements.txt` | `mcp` 1.25.0 -> 1.26.0 |
| `mcp-server/go.mod` | `go-sdk` v1.3.0 -> v1.5.0 |

### stigmer-cloud (private)
| File | Change |
|------|--------|
| `.../McpServerConnectHandler.java` | Merge runtimeEnv on top of personal env |
| `_ops/.../stigmer-api.yaml` | Add `prod.grpc-endpoint` entry |

## Related Work

- MCP OAuth Connect project: `_projects/2026-04/20260410.03.mcp-oauth-connect/`
- Domain migration changelog: `_changelog/2026-03/2026-03-31-201945-migrate-endpoints-to-stigmer-ai-domain.md`
- Daytona transport implementation: `_changelog/2026-04/2026-04-09-174800-daytona-stdio-relay-mcp-server-isolation.md`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
