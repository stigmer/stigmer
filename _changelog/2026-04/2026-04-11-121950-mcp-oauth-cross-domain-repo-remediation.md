# MCP OAuth Cross-Domain Repository Access Remediation

**Date**: April 11, 2026

## Summary

Audited and remediated cross-domain repository boundary violations in the MCP server OAuth package (stigmer-cloud). Replaced direct `EnvironmentRepo` access with downstream gRPC repos (`EnvironmentQueryGrpcRepo` + new `EnvironmentCommandGrpcRepo`), eliminated double-encryption of tokens, and documented the deliberate `OAuthAppRepo` boundary exception for client secret access.

## Problem Statement

The MCP OAuth package (`ai.stigmer.domain.agentic.mcpserver.oauth`) was directly importing and calling repositories from other bounded contexts -- specifically `EnvironmentRepo` (owned by the environment domain) and `OAuthAppRepo` (owned by the IAM oauthapp domain). This violated the platform's established cross-domain access pattern where all inter-domain communication goes through in-process gRPC downstream repos.

### Pain Points

- Direct `EnvironmentRepo.save()` bypassed the gRPC handler pipeline, skipping FGA authorization checks, secret encryption, and audit trail updates
- Direct `EnvironmentRepo.findByOrg()` bypassed FGA visibility filtering
- Pre-encryption of tokens in OAuth code duplicated logic already present in the `EnvironmentUpdateVariablesHandler` pipeline
- No audit fields (`updatedBy`) were set on environment mutations from OAuth flows
- Architecture not microservice-ready: direct repo imports create hard coupling between domains

## Solution

Created a new `EnvironmentCommandGrpcRepo` downstream interface (matching the existing `EnvironmentQueryGrpcRepo` pattern) and refactored all OAuth-related environment access to go through gRPC. For `OAuthAppRepo`, documented a deliberate boundary exception since the gRPC query pipeline applies `RedactClientSecret` and the OAuth flow requires unredacted secrets.

## Implementation Details

### New Downstream Repo: EnvironmentCommandGrpcRepo

- **Interface**: `EnvironmentCommandGrpcRepo` with `updateVariablesOnBehalfOf(environmentId, variables, identityAccountId)`
- **Implementation**: `EnvironmentCommandGrpcRepoImpl` using `ImpersonatedChannelFactory` (OBO channel) and `EnvironmentCommandControllerGrpc` blocking stub
- Wraps the existing `updateVariables` gRPC RPC which does server-side merge, encryption, FGA authorization, and audit trail

### Refactored: OAuthTokenRefreshService

- Replaced `EnvironmentRepo` with `EnvironmentQueryGrpcRepo` (list with personal label filter) + `EnvironmentCommandGrpcRepo` (update token variables)
- Replaced `EnvironmentSecretService.decrypt()` with `getSecretValueOnBehalfOf()` -- the gRPC query handler returns decrypted values
- Removed all `secretService.encrypt()` calls -- the `updateVariables` handler pipeline encrypts on write
- Error handling now catches `StatusRuntimeException` following the established downstream repo pattern

### Refactored: McpServerCompleteOAuthConnectHandler

- `ExchangeAndStore` step: replaced `EnvironmentRepo` + `EnvironmentSecretService` with the two downstream gRPC repos
- Tokens passed as plaintext with `isSecret=true` to `updateVariablesOnBehalfOf`
- Personal environment lookup via `listOnBehalfOf` (only needs env ID, not secret values)

### Documented: OAuthAppRepo Exception

- Both `OAuthTokenRefreshService` and `McpServerInitiateOAuthConnectHandler` retain direct `OAuthAppRepo` access
- Reason: gRPC `getByReference` handler applies `RedactClientSecret` pipeline step, but these callers need unredacted `client_secret` for external OAuth provider calls
- Documented at class-level javadoc and field-level comments in both files

## Benefits

- **Proper authorization**: Environment mutations now go through FGA `can_edit` checks via the handler pipeline
- **Correct audit trail**: `updatedBy` is set to the impersonated user on every token write
- **No double encryption**: Tokens are encrypted exactly once by the handler pipeline, not pre-encrypted by OAuth code
- **Clean domain boundaries**: MCP server domain no longer imports environment domain internals
- **Microservice-ready**: When domains are split into separate services, the downstream repo switches from in-process to network channel with no code changes

## Impact

- **Files created**: 2 (EnvironmentCommandGrpcRepo interface + impl)
- **Files modified**: 3 (OAuthTokenRefreshService, McpServerCompleteOAuthConnectHandler, McpServerInitiateOAuthConnectHandler)
- **Dependencies removed**: `EnvironmentRepo` and `EnvironmentSecretService` from the MCP OAuth package
- **Zero functional change**: Token storage, refresh, and OAuth connect flows work identically from the user's perspective

## Related Work

- Downstream gRPC repo pattern established in `EnvironmentQueryGrpcRepo`, `McpServerGrpcRepo`, `ExecutionContextGrpcRepo`
- `EnvironmentUpdateVariablesHandler` (the server-side merge RPC) was built specifically to avoid the read-modify-write secret destruction problem
- OAuth connect flow: `_changelog/2026-04/2026-04-11-101803-t03-backend-oauth-connect-flow-token-refresh.md`

---

**Status**: Production Ready
