# Fix MCP Connect 401 and Delete Handler Pipeline Gaps

**Date**: April 11, 2026

## Summary

Fixed three bugs preventing the MCP Connect flow from working for OAuth-authenticated servers: (1) the OAuth grant lookup in `McpServerConnectHandler` used a hardcoded empty `identityAccountId`, (2) 10 delete handlers were missing the `extractResourceId` pipeline step, and (3) the React SDK blanket-injected platform env vars into every connect call regardless of whether the target server declared them.

## Problem Statement

Clicking "Connect" on the Slack MCP server (OAuth-authenticated) in the web UI resulted in a `401 Unauthorized` from `mcp.slack.com`. The OAuth token had been successfully acquired and stored in the managed environment, but the connect flow never retrieved it.

### Pain Points

- The `SLACK_ACCESS_TOKEN` was absent from the execution context despite existing in the managed environment
- The 401 error was cryptic — it appeared as a remote Slack rejection rather than a local credential resolution failure
- Post-connect cleanup of the ephemeral execution context also failed, leaving orphaned documents in MongoDB
- The SDK's blanket injection of platform vars masked the missing-credential error by keeping `tolerateMissing=true`

## Solution

Three targeted fixes across stigmer (React SDK) and stigmer-cloud (Java backend):

1. **Pass caller identity to OAuth grant lookup** — `resolveEnvironmentVariables()` now receives the caller's `identityAccountId` from the pipeline context instead of using a hardcoded empty string.

2. **Add `extractResourceId` to 10 delete handlers** — Every `DeleteOperationHandlerV2` that overrides the pipeline now includes `commonSteps.extractResourceId` before `deleteSteps.loadExisting`, matching the 6 handlers that already had it.

3. **Filter system env vars by server declarations** — The React SDK connect hooks now only include `STIGMER_SERVER_ADDRESS` / `STIGMER_API_KEY` in `runtime_env` when the target MCP server declares those keys in `spec.env`. A new `resolveDeclaredSystemEnvVars()` utility handles the filtering.

## Implementation Details

### Bug 1: OAuth Grant Lookup (stigmer-cloud)

`McpServerConnectHandler.ExecuteConnectWorkflow.resolveEnvironmentVariables()` had `String identityAccountId = ""` on line 321. The `execute()` method already computed the correct identity as `invokerIdentityAccountId` from `context.getCaller()`, but never passed it through. The `RefreshOAuthToken` pipeline step (which runs earlier) correctly used the caller identity — only the environment resolution step was broken.

**Fix**: Added `identityAccountId` as a method parameter, removed the hardcoded empty string, updated the call site to pass `invokerIdentityAccountId`.

### Bug 2: Delete Handler Pipelines (stigmer-cloud)

`ExtractResourceIdStepV2` is the only mechanism that populates `DeleteContextV2.resourceId`. The authorize step extracts the ID for FGA internally but does not set it on the context. The default pipeline template includes `extractResourceId`, but 10 custom handler pipelines omitted it.

**Affected handlers**: `ExecutionContextDeleteHandler`, `AgentDeleteHandler`, `AgentExecutionDeleteHandler`, `AgentInstanceDeleteHandler`, `EnvironmentDeleteHandler`, `IdentityProviderDeleteHandler`, `ProjectDeleteHandler`, `SessionDeleteHandler`, `SkillDeleteHandler`, `WorkflowInstanceDeleteHandler`

### Bug 3: SDK Platform Var Injection (stigmer)

`useMcpServerConnect` and `useMcpServerOAuthConnect` unconditionally called `resolveSystemEnvVarValues()` and merged the result into `runtime_env`. For servers that don't declare these platform vars (all servers except `mcp-server-stigmer`), this caused `hasRuntimeEnv=true` in the Java handler, which set `tolerateMissing=true` in `resolveFromPersonalEnvironment`, silently suppressing missing credential errors.

**Fix**: Added `resolveDeclaredSystemEnvVars()` in `systemEnvVars.ts` that filters system vars against the target server's `spec.env` declarations. Updated both hooks and all call sites in `McpServerDetailView.tsx` to pass `declaredEnvKeys`.

## Benefits

- OAuth-authenticated MCP servers (Slack, GitHub, etc.) can now be connected via the web UI
- Missing credential errors surface immediately as clear pre-flight failures instead of cryptic 401s from remote servers
- All resource types can now be deleted via their gRPC delete RPC
- Orphaned execution context documents are properly cleaned up after connect workflows

## Impact

- **MCP Connect**: OAuth-based connect flows are unblocked for all 13 OAuth-capable MCP servers
- **Delete RPCs**: 10 resource types that were silently broken for direct delete are now functional
- **Error clarity**: Missing credentials produce actionable error messages instead of downstream 401s

## Related Work

- `20260410.03.mcp-oauth-connect` — Implemented the OAuth connect/refresh flow that this fix unblocks
- `20260411.01.mcp-oauth-managed-credentials` — Separated OAuth tokens into managed environments
- `20260411.02.mcp-connect-retry-and-env-declaration` — Added retry policies and `EnvVarDeclaration` proto

---

**Status**: ✅ Production Ready
**Repositories**: stigmer (6 files), stigmer-cloud (11 files)
