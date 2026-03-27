# Resolve MCP Server Environment Variables from Personal Environment

**Date**: March 27, 2026

## Summary

Agent executions that use MCP servers (e.g. `mcp-server-stigmer`) now automatically resolve required credentials from the caller's personal environment. Previously, flows that bypassed the `SessionComposer` — such as the "Regenerate Policies" trigger on the MCP server detail page — failed with `FAILED_PRECONDITION` errors because `STIGMER_API_KEY` and `STIGMER_SERVER_ADDRESS` were never injected into the execution context, despite being present in the user's personal environment.

## Problem Statement

The MCP server detail page's "Regenerate Policies" button creates an agent execution using the `mcp-server-creator` agent. This flow used the agent's **default instance** (`agent.status.defaultInstanceId`) which has no `environment_refs` to the caller's personal environment. The backend's `CreateExecutionContextStep` only resolved personal environment values for `GITHUB_TOKEN` (workspace provisioning), not for MCP server required variables.

### Pain Points

- Users saw `MCP server 'mcp-server-stigmer' requires environment variable 'STIGMER_API_KEY' which is not provided` even though the key existed in their personal environment
- The MCP **discovery** path (`McpServerDiscoverCapabilitiesHandler`) resolved from personal environment correctly, but the **execution** path did not — inconsistent behavior
- Any flow using a default or shared agent instance (not a personal instance) would hit this gap
- The agent's `env_spec` whitelist (`filterByEnvSpec`) dropped MCP server env vars since they aren't declared in the agent template's own `env_spec`

## Solution

Two complementary fixes — defense-in-depth at the backend and pattern-consistency at the frontend.

## Implementation Details

### Backend: Generalized MCP env var resolution (stigmer-cloud)

**`McpEnvironmentValidator.java`** — Added `collectRequiredMcpVariables(Agent)`:
- Iterates the agent's `mcp_server_usages`, loads each `McpServer`, and collects required env var keys (those with no default value in `env_spec`)
- Returns `Map<String, Boolean>` where keys are variable names and values are `is_secret` flags
- When multiple MCP servers declare the same key, conservative `is_secret = true` wins via `Map.merge`

**`CreateExecutionContextStep.java`** — Added Step 6.8: `injectMcpEnvFromPersonalEnvironment`:
- Runs after `filterByEnvSpec` (Step 6) and existing personal env injection (Step 6.5), but before `McpEnvironmentValidator` (Step 7)
- Calls `collectRequiredMcpVariables` to determine which MCP env vars are needed
- For any missing from `filteredEnv`, queries the caller's personal environment via OBO gRPC (`environmentQueryGrpcRepo.listOnBehalfOf` + `getSecretValueOnBehalfOf`)
- Injects resolved values into the execution context
- Non-fatal: failures let the downstream validator produce clear error messages
- Follows the same post-filter injection pattern as `GITHUB_TOKEN` workspace provisioning

### Frontend: Personal instance for approval policy trigger (stigmer)

**`useTriggerApprovalPolicySession.ts`** — Replaced default instance with personal instance:
- Lists the caller's personal environment (`stigmer.ai/personal=true` label)
- Finds or creates a personal agent instance for `mcp-server-creator` with `environmentRefs: [personalEnvRef]`
- Falls back to the default instance only when no personal environment exists
- Reuses `buildPersonalInstanceInput` and the `findOrCreatePersonalInstance` race-narrowing pattern from `useAgentSetup`

## Benefits

- MCP server credentials now resolve consistently in **all** execution paths, not just `SessionComposer`-initiated sessions
- The backend fix is systemic: any future flow using default or shared agent instances automatically benefits
- The frontend fix ensures the approval policy flow follows the same personal-instance pattern as regular sessions
- No breaking changes to existing behavior — the fix is additive (fallback only when keys are missing)

## Impact

- **Users**: "Regenerate Policies" on MCP server detail pages now works without manual workarounds
- **Platform builders**: Embedded components that trigger agent executions with MCP servers get the same personal environment resolution
- **Backend consistency**: The agent execution path and MCP discovery path now resolve credentials from the same source using the same pattern

## Related Work

- MCP Discovery already resolved from personal env via `McpServerDiscoverCapabilitiesHandler.resolveFromPersonalEnvironment`
- `GITHUB_TOKEN` workspace provisioning injection (Step 6.5) established the post-filter injection pattern
- `useAgentSetup` / `buildPersonalInstanceInput` established the personal instance + personal env linkage pattern

---

**Status**: Production Ready
**Timeline**: Single session
