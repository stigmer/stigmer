# Secure MCP Discovery with ExecutionContext and Runtime Env Support

**Date**: March 27, 2026

## Summary

Replaced the over-privileged JIT credential resolution in MCP server discovery with the established ExecutionContext pattern. The Go/Java backend now creates an ephemeral, scoped ExecutionContext before starting the Temporal workflow, and the Python activity reads only from that context. Additionally, added `runtime_env` support to `DiscoverCapabilitiesInput`, enabling one-time (temporary) credential use alongside the existing save-to-personal-environment flow.

## Problem Statement

The previous implementation granted the Python agent-runner broad On-Behalf-Of (OBO) access to the environment service, allowing it to list environments and read any secret the user had access to. This violated the principle of least privilege — the runner should only have access to the specific environment variables the MCP server needs.

### Pain Points

- Python runner could read arbitrary secrets from any environment the user had access to via `list_environments` and `get_secret_value`
- No scoping mechanism — the runner's access surface was the entire environment service
- No option for temporary/one-time credential use — users were forced to persist credentials to their personal environment before discovery
- Inconsistent with the agent execution flow, which already used the ExecutionContext pattern for secure, scoped secret delivery

## Solution

Adopted the existing ExecutionContext pattern used by agent execution. The trusted Go/Java backend creates an ephemeral ExecutionContext containing only the MCP server's required environment variables, passes the context ID through Temporal, and the Python activity reads from this scoped context. The context is deleted immediately after discovery completes.

Added a `runtime_env` field to `DiscoverCapabilitiesInput` using `map<string, ExecutionValue>` — the same type used by `AgentExecution.spec.runtime_env` — giving callers the option to pass temporary credentials directly without persisting them.

## Implementation Details

### Proto (apis)

- Added `runtime_env` field to `DiscoverCapabilitiesInput` as `map<string, ExecutionValue>` with import from `executioncontext/v1`
- Regenerated stubs across all languages (Go, Java, Python, TypeScript, Dart)

### Python Activity (agent-runner)

- Added `execution_context_id` to `DiscoverMcpServerInput` dataclass
- New `_resolve_env_from_execution_context()` reads from the pre-created EC via `ExecutionContextClient.try_get_by_execution_id`
- New `_resolve_env_vars_for_discovery()` dispatcher: EC path (preferred) with JIT fallback for rolling deployment safety
- JIT fallback (`_resolve_env_vars_jit`) is explicitly marked as deprecated for cleanup

### Go Backend (stigmer-server)

- `McpServerController`: Added `environmentClient` and `executionCtxClient` fields; expanded `SetDiscoveryDependencies` to accept them
- `DiscoverCapabilities`: Full EC lifecycle — `createDiscoveryExecutionContext()` branches on `runtime_env` vs personal environment, `defer` cleans up the EC
- `resolveFromPersonalEnvironment()`: Lists personal env by org + label, decrypts secrets, builds `ExecutionValue` map with `is_secret` from env_spec
- `discoverWorkflowInput`: Now carries `ExecutionContextID`
- `StartBestEffortDiscovery`: Skips auto-discovery for MCP servers with `env_spec` (avoids EC lifecycle complexity in fire-and-forget goroutines)
- Wired `environmentClient` and `executionContextClient` into `SetDiscoveryDependencies` in `server.go`

### Java Backend (stigmer-service)

- `ExecuteDiscoveryWorkflow` step: Resolves env vars from `runtime_env` or personal environment, creates EC via `ExecutionContextRepo`, passes `execution_context_id` to workflow, deletes EC in `finally` block
- Personal environment lookup via `EnvironmentRepo.findByOrg` + label filter
- Secret decryption via `EnvironmentSecretService` for values stored encrypted

### React SDK

- `useDiscoverCapabilities`: `discover()` now accepts optional `runtimeEnv?: Record<string, EnvVarInput>`, constructs proper `DiscoverCapabilitiesInput` proto
- `McpServerDetailView`: Removed `hideSaveToggle` and `defaultSaveForFuture` from `EnvVarForm`, exposing the save preference toggle. `handleCredentialSubmit` branches on `saveForFuture`: save path persists to personal env then discovers; temporary path passes values as `runtimeEnv`

## Benefits

- **Least privilege**: Python runner can only read the specific env vars in its scoped ExecutionContext, not arbitrary secrets
- **Consistent security model**: Discovery now follows the same ExecutionContext pattern as agent execution and workflow execution
- **User choice**: UI now offers "Save for future runs" toggle — users can choose between persisting credentials or using them once
- **Deployment safety**: JIT fallback ensures zero-downtime rolling deployments (Python deploys first, Go/Java follows)
- **Automatic cleanup**: EC is deleted in `defer`/`finally` blocks; MongoDB TTL index provides safety net for orphaned contexts

## Impact

- **Security**: Eliminates the broad OBO access surface in the Python runner for discovery flows
- **UX**: Users who want to test an MCP server once can do so without polluting their personal environment
- **Architecture**: Aligns all execution flows (agent, workflow, discovery) on the same secret delivery mechanism
- **Files changed**: 46 files across proto, stubs, Go backend, Python activity, Java backend, React SDK, and TypeScript SDK

## Related Work

- [Fix Discovery Credential Security](2026-03-27-094850-fix-discovery-credential-security.md) — the previous partial fix that moved resolution to JIT in Python
- [MCP Server Discovery and Approval Policy Generation](2026-03-27-092434-mcp-server-discovery-and-approval-policy-generation.md) — the original discovery feature
- [Inject GitHub Token from Personal Environment](2026-03-26-123838-inject-github-token-from-personal-environment.md) — related personal environment pattern
- [Extract StripRuntimeEnv Pipeline Step](2026-03-25-141956-extract-strip-runtime-env-pipeline-step.md) — runtime_env pattern in agent execution

---

**Status**: ✅ Production Ready (JIT fallback will be removed in a cleanup PR after full deployment)
**Timeline**: ~3 hours
