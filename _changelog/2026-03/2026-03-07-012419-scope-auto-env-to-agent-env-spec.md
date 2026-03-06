# Scope Auto-Env Resolution to Agent env_spec

**Date**: March 7, 2026

## Summary

Auto-resolved well-known credentials (GITHUB_TOKEN, PLANTON_API_KEY, etc.) injected into agent execution `runtime_env` are now scoped to variables declared in the agent's `env_spec`. Previously, every execution received all resolvable credentials regardless of whether the agent needed them.

## Problem Statement

When a user runs `stigmer run agent` or `stigmer draft mcp-server`, the CLI auto-resolves credentials from local stores (gh CLI, Planton config, Stigmer config) and injects them into the execution's `runtime_env`. This was done unconditionally for a hardcoded list of "well-known" variables.

### Pain Points

- **Unnecessary secret injection**: An agent that only needs `STIGMER_SERVER_ADDRESS` still received `GITHUB_TOKEN`, `PLANTON_API_KEY`, and `PLANTON_CLOUD_ENVIRONMENT` — credentials the agent has no use for.
- **Security surface**: Passing credentials to executions that don't require them increases the blast radius if an execution is compromised or if secrets are inadvertently logged.
- **Confusing execution payloads**: Operators inspecting agent executions saw secrets they didn't expect, making it harder to understand what the agent actually needs.

## Solution

Moved auto-env resolution from the shared `prepareAgentExec` step (which runs before agent resolution) to after the agent is resolved, scoping it to the keys in the agent's `env_spec`. Workflows retain the unscoped behavior since they don't carry an `env_spec`.

## Implementation Details

### New scoped resolver in `env_resolver.go`

Added `ResolveWellKnownEnvScoped(cfg, requiredVars)` alongside the existing `ResolveWellKnownEnv(cfg)`. Both delegate to a shared `resolveWellKnownEnvFiltered` that accepts an optional filter set. When the filter is non-nil, only variables present in the filter are resolved.

### Auto-env removed from `prepareAgentExec`

`prepareAgentExec` in `run_agent_exec.go` previously called `resolveAndMergeAutoEnv` unconditionally. This call is removed — `prepareAgentExec` now only builds `RuntimeEnv` from user-provided `--env`/`--secret`/`--env-file`/`--secret-file` flags plus the `STIGMER_ORG_ID` injection.

### New `applyAutoEnvForAgent` helper

A new function in `run_agent_exec.go` extracts the agent's `env_spec` data keys into a `map[string]bool` and calls `resolveAndMergeAutoEnvScoped`. If the agent's `env_spec` is empty, no auto-resolution occurs.

### Caller updates

- **`routeRun` (agent branch)**: Calls `applyAutoEnvForAgent` after `resolveAgent`, before `executeResolvedAgent`.
- **`routeRun` (workflow branch)**: Calls the unscoped `resolveAndMergeAutoEnv` to preserve existing behavior.
- **`executeDraft`**: Calls `applyAutoEnvForAgent` after resolving the system agent.

### Precedence preserved

The merge priority is unchanged: auto-resolved values are the lowest priority source. User-provided `--env`/`--secret` flags always win.

## Benefits

- **Principle of least privilege**: Agents only receive credentials they declare they need.
- **Smaller attack surface**: No unnecessary secrets in execution payloads.
- **Clearer execution payloads**: `runtime_env` accurately reflects what the agent uses.
- **No breaking changes**: User-provided flags and workflow behavior are unaffected.

## Impact

- **Agent authors**: No action required. Agents with a correctly defined `env_spec` work exactly as before — they just stop receiving extras they never asked for.
- **Workflow users**: No change. Workflows retain the unscoped auto-env resolution.
- **CLI users**: `--env` and `--secret` flags continue to work regardless of `env_spec`, providing an escape hatch for any variable.

## Related Work

- Well-known env resolution introduced for MCP server discovery (`ResolveEnvForDiscovery` — already scoped to server `env_spec`)
- Agent `env_spec` proto field (`ai.stigmer.agentic.agent.v1.AgentSpec.env_spec`)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
