# Inject GITHUB_TOKEN from Personal Environment into Agent Execution Context

**Date**: March 26, 2026

## Summary

When a session has `git_repo` workspace entries, the agent-runner needs `GITHUB_TOKEN` to clone private repositories. The token is stored in the user's personal environment (via GitHub OAuth) but was never included in the 3-layer environment merge. This change adds a fallback that queries the caller's personal environment via gRPC and injects the decrypted token into the execution context.

## Problem Statement

Private GitHub repository clones failed silently during workspace provisioning. The `GITHUB_TOKEN` lives in the user's personal environment (labeled `stigmer.ai/personal: "true"`), but the standard 3-layer merge (agent env_spec → environment_refs → runtime_env) never includes the personal environment. The existing `injectWorkspaceProvisioningKeys` function could only re-inject keys already present in the merged map — it could not source keys from new locations.

### Pain Points

- Agent executions with `git_repo` workspace entries failed with empty stderr on private repo clones
- Auto-created agent instances have no `environment_refs` pointing to the personal environment
- The frontend doesn't pass `GITHUB_TOKEN` via `runtime_env` (it stores it server-side via OAuth)
- No mechanism existed to bridge the personal environment into the execution context

## Solution

Added a new `injectFromPersonalEnvironment` function to the agent execution `CreateExecutionContextStep` that:

1. Checks if the session has `git_repo` workspace entries (gating condition)
2. Identifies workspace-provisioning keys still missing after the merged-map re-injection
3. Queries the caller's personal environment via gRPC `List` (org + `stigmer.ai/personal=true` label)
4. Retrieves the decrypted secret value via gRPC `GetSecretValue`
5. Injects the value into the filtered environment map as `ExecutionValue{value, is_secret: true}`

All failures are non-fatal — if the personal environment doesn't exist, lacks the key, or the gRPC call fails, execution continues without the token.

## Implementation Details

### Go Environment Downstream Client

Extended `backend/services/stigmer-server/pkg/downstream/environment/client.go` with two new methods:

- **`List`** — calls `EnvironmentQueryController.List` RPC for org + labels filtering
- **`GetSecretValue`** — calls `EnvironmentQueryController.GetSecretValue` RPC for single-key decryption

Both methods follow the identical pattern of the existing `GetByReference`, using the same `queryClient` field.

### Go Agent Execution CreateExecutionContextStep

In `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create_execution_context_step.go`:

- Added `injectFromPersonalEnvironment` function gated on session having `git_repo` workspace entries
- Called after the existing `injectWorkspaceProvisioningKeys` (which re-injects from the merged map)
- Uses copy-on-write pattern for the filtered map to avoid mutating the original
- Logs at INFO level when a key is injected, WARN on non-fatal failures, DEBUG when no personal env found

### Architecture Decision

Per project direction: **no direct store access**. The personal environment lookup uses gRPC downstream calls through the existing in-process channel, maintaining clean domain boundaries and microservice readiness.

## Benefits

- Private GitHub repo clones now work for agent executions with git_repo workspace entries
- No frontend or SDK changes required — the OAuth token storage continues working as-is
- Backward compatible — existing executions with GITHUB_TOKEN in runtime_env or environment_refs are unaffected
- Follows established downstream client patterns for future microservice migration

## Impact

- **Agent executions**: Sessions with `git_repo` workspace entries will now automatically have `GITHUB_TOKEN` injected from the caller's personal environment when it's not already in the merge chain
- **Workflow executions**: Not affected — workspaces are a session/agent-runner concept; child agent executions handle their own token injection

## Related Work

- Java (stigmer-cloud) has parallel changes: new `EnvironmentQueryGrpcRepo` downstream client and updated `CreateExecutionContextStep` for agent execution
- The existing `injectWorkspaceProvisioningKeys` (re-inject from merged) remains unchanged

---

**Status**: ✅ Production Ready
