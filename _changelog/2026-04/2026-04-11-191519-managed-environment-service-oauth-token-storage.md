# ManagedEnvironmentService: System-Controlled OAuth Token Storage

**Date**: April 11, 2026

## Summary

Introduced `ManagedEnvironmentService` in both Go (stigmer) and Java (stigmer-cloud) to create and manage system-controlled environments for OAuth token storage. Rewired `CompleteOAuthConnect` to store tokens in managed environments instead of personal environments, with re-connect reuse logic to prevent orphaned environments.

## Problem Statement

OAuth tokens (access + refresh) were stored in the user's personal environment alongside user-managed credentials like API keys. This created collision risk and mixed concerns — system-controlled secrets coexisted with user-editable values in the same environment.

### Pain Points

- Personal environments contained both user-managed credentials and system-managed OAuth tokens
- No clean separation between what users control and what the system manages
- Re-authentication could overwrite personal env keys or create confusion
- No way for the frontend to distinguish OAuth-provided credentials from manually set ones

## Solution

Created a thin `ManagedEnvironmentService` that uses the established downstream gRPC layer to create dedicated environments labeled `stigmer.ai/managed=true`. Each managed environment is scoped to a single (user, resource, org) tuple. The `CompleteOAuthConnect` handler in both Go and Java now stores tokens in these managed environments and records the environment ID in the OAuthGrant.

## Implementation Details

### ManagedEnvironmentService (Go + Java)

Both implementations are thin services over the existing downstream layer:

- **Go**: `pkg/domain/mcpserver/oauth/managed_env.go` — backed by `*environment.Client` (in-process gRPC)
- **Java**: `domain/agentic/mcpserver/oauth/ManagedEnvironmentService.java` — Spring `@Service` backed by `EnvironmentCommandGrpcRepo` + `EnvironmentQueryGrpcRepo`

Three methods in each:
- `CreateManagedEnvironment` — creates environment with `stigmer.ai/managed=true` label
- `UpdateSecrets` — writes plaintext token vars (pipeline encrypts)
- `ReadSecretValue` — reads decrypted secret value

### CompleteOAuthConnect Rewiring

Both Go and Java handlers now:
1. Exchange the authorization code for tokens (unchanged)
2. Check for an existing grant with a managed environment ID (re-connect reuse)
3. If found, reuse that environment; if not, create a new managed environment named `"OAuth: {mcpServerName}"`
4. Write tokens via `ManagedEnvironmentService.UpdateSecrets`
5. Record the managed environment ID in the OAuthGrant

### Design Decisions

- **Downstream layer for everything**: No direct repo access. FGA tuples, encryption, validation, and audit come for free from the pipeline.
- **No backend mutation guard**: Deferred to frontend-only protection in a later task. Managed environments are system-created and not surfaced in the UI.
- **Re-connect reuse**: Existing managed environment is reused on re-authentication to prevent orphaned environments.
- **Dropped `FindManagedEnvironment`**: Callers use `grant.environmentId` directly — it's the authoritative token locator.

## Benefits

- Clean separation between user-managed credentials and system-managed OAuth tokens
- Personal environments now contain only what users explicitly set
- Managed environments can be filtered from UI views (frontend task)
- Re-connect is safe — no orphaned environments or personal env pollution
- Foundation for T03 (refresh + connect + session injection via managed env)

## Impact

- **OAuth connect flow**: Tokens now stored in dedicated managed environments
- **OAuthGrant**: `environmentId` field now points to a managed environment (was personal env)
- **Personal environments**: No longer polluted with OAuth tokens after this change
- **Existing refresh/connect flows**: Still read from personal env (will be migrated in T03)

## Related Work

- Predecessor: [Generalize OAuthGrant to resource-agnostic data model](2026-04-11-174556-generalize-oauth-grant-resource-agnostic.md)
- Next: T03 will update connect, refresh, and session injection to read from managed environments via `grant.environmentId`

---

**Status**: ✅ Production Ready
**Repos**: stigmer (Go), stigmer-cloud (Java)
