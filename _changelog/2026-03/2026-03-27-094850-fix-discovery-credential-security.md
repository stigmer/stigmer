# Fix MCP Server Discovery Credential Security

**Date**: March 27, 2026

## Summary

Moved credential resolution out of the Go/Java backend handlers and into the Python Temporal activity for MCP server discovery. Secrets are now resolved just-in-time via on-behalf-of gRPC calls inside the activity, eliminating the security vulnerability where decrypted credentials were exposed in Temporal's durable workflow history.

## Problem Statement

The `discoverCapabilities` flow resolved secrets server-side in the Go and Java backend handlers and passed them as plaintext in the Temporal workflow input. Temporal persists all workflow inputs in its event history, making these secrets visible in the Temporal Web UI and stored in Temporal's persistence layer.

This violated the established slim-payload pattern documented in `workflow_input.go`:

> *"The full proto contained runtime_env (which may hold secrets)... By using a slim input, secrets are kept out of Temporal's durable workflow history."*

### Pain Points

- Decrypted secret values (API keys, tokens) stored permanently in Temporal event history
- Secrets visible in the Temporal Web UI to anyone with Temporal access
- Violated the slim-payload contract already established by the `execute_graphton` activity
- Go `StartBestEffortDiscovery` goroutine used the gRPC request context, creating a race condition where the context could be cancelled after the originating request returned

## Solution

Adopted the same just-in-time (JIT) credential resolution pattern used by the `execute_graphton` activity. The backend handlers now send only `mcp_server_id` (and `invoker_identity_account_id` in cloud) to the Temporal workflow. The Python activity resolves credentials at runtime via the on-behalf-of (OBO) gRPC impersonation flow.

## Implementation Details

### Python Environment Client — New Methods

Added `list_environments(org, labels)` and `get_secret_value(environment_id, key)` to `EnvironmentClient`. These mirror the Go downstream client's `List` and `GetSecretValue` methods, calling the existing `EnvironmentQueryController` gRPC stubs.

### Python Activity — JIT Resolution

Refactored `discover_mcp_server.py`:

- Removed `env_vars` as a required field from `DiscoverMcpServerInput` (retained as optional with `field(default_factory=dict)` for backward compatibility during rolling deployment)
- Added `_resolve_env_vars()` that:
  1. Reads the MCP server's `env_spec` from the already-fetched spec
  2. Calls `list_environments(org, labels={"stigmer.ai/personal": "true"})` via OBO channel
  3. Fetches each required secret key individually via `get_secret_value()`
  4. Returns the resolved `dict[str, str]` — secrets live only in activity process memory
- Error messages clearly identify missing credentials and direct the user to save them

### Go Handler — Simplified

Removed from `discover_capabilities.go`:

- The entire `resolveEnvVars` method (~70 lines)
- `EnvVars` field from `discoverWorkflowInput`
- `envClient` dependency from `McpServerController` struct
- `environmentclient` import and `personalEnvLabel` constant

Simplified `SetDiscoveryDependencies` to accept only `temporalClient` and `runnerQueue`. Updated `server.go` call site accordingly.

### Go Apply — Fixed Context Cancellation

Changed `StartBestEffortDiscovery` to use `context.Background()` internally instead of accepting the request context. After the `resolveEnvVars` removal, this method no longer makes gRPC calls — it only starts a Temporal workflow, so it no longer needs the request context at all.

### Java Handler — Simplified

Removed from `McpServerDiscoverCapabilitiesHandler.java`:

- The entire `ResolveCredentials` pipeline step class (~80 lines)
- `CTX_RESOLVED_ENV_VARS` context key
- `EnvironmentQueryControllerBlockingStub` dependency
- Environment-related proto imports

`ExecuteDiscoveryWorkflow` now sends only `mcp_server_id` + `invoker_identity_account_id`.

## Benefits

- **Security**: Secrets never appear in Temporal's durable workflow history
- **Consistency**: Discovery now follows the same slim-payload + JIT resolution pattern as agent execution
- **Simplification**: ~150 lines of server-side credential resolution code removed from Go and Java
- **Reliability**: Fixed the context cancellation race in `StartBestEffortDiscovery`
- **Maintainability**: One credential resolution path (Python activity) instead of three (Go + Java + Python)

## Impact

- **Backend services**: Go OSS server and Java cloud service both simplified
- **Python agent-runner**: Enhanced `EnvironmentClient` and refactored discovery activity
- **No frontend changes**: Proto, React hooks, and TypeScript SDK are unaffected
- **Deployment order matters**: Python activity must deploy first (backward-compatible), then Go/Java backends

## Related Work

- [MCP Server Discovery and Approval Policy Generation](2026-03-27-092434-mcp-server-discovery-and-approval-policy-generation.md) — the feature that introduced this flow
- [On-Behalf-Of gRPC Impersonation Infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — the OBO infrastructure this fix leverages
- [Wire OBO Impersonation into Runners and FGA Hardening](2026-03-25-140735-wire-obo-impersonation-into-runners-and-fga-hardening.md) — established the OBO channel pattern in the agent-runner
- [Modularize execute_graphton Activity](2026-03-26-204832-modularize-execute-graphton-activity.md) — the reference implementation for JIT secret resolution

---

**Status**: ✅ Production Ready
**Timeline**: Single session
