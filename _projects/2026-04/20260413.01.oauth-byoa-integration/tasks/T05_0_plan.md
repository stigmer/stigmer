# Task T05: Backend — BYOA Handlers + Resolution Chain Integration

**Created**: 2026-04-13 11:03
**Status**: NOT STARTED
**Repo**: stigmer-cloud
**Estimated scope**: ~8-10 files (3 new handlers + 2 modified handlers)
**Depends on**: T04 (resolution service + repo)

## Objective

Implement the BYOA handler (composite create OAuthApp + override), wire existing OAuth connect and token refresh flows through the resolution chain, and add handlers for querying/deleting org OAuth app overrides.

## Context

T04 built the infrastructure (repo, resolution service, enricher). This task builds the handlers that expose that infrastructure via RPCs and integrates the resolution chain into the existing `initiateOAuthConnect` and `OAuthTokenRefreshService`.

## Deliverables

### 1. `McpServerSetOrgOAuthAppHandler`

New handler at `domain/agentic/mcpserver/request/handler/McpServerSetOrgOAuthAppHandler.java`.

This is a **composite operation** — a single RPC that:
1. Loads the MCP server (verify it exists, has `spec.auth.oauth_app_ref`)
2. Loads the platform OAuthApp (the template to clone from)
3. Creates a new OAuthApp for the org:
   - `metadata.org` = caller's org
   - `metadata.name` = "Custom: {platformApp.provider} ({mcpServerName})"
   - `metadata.slug` = auto-generated (e.g., `figma-oauth-custom-{orgSlug}`)
   - `spec.provider` = copied from platform OAuthApp
   - `spec.client_id` = from input
   - `spec.client_secret` = from input (encrypted by pipeline)
   - `spec.authorization_url` = copied from platform OAuthApp
   - `spec.token_url` = copied from platform OAuthApp
   - `spec.scopes` = copied from platform OAuthApp
   - `spec.scope_parameter_name` = copied from platform OAuthApp
   - `spec.userinfo_url` = copied from platform OAuthApp
   - `spec.vendor_approval_status` = `APPROVED` (org's own app is self-approved)
4. Creates OAuthAppOverride binding: `(mcpServerId, "mcp_server", org) → newOAuthApp.id`
5. Returns `SetOrgOAuthAppOutput { oauth_app_id, source: ORG_OVERRIDE }`

Pipeline:
1. `ValidateFieldConstraints`
2. `LoadMcpServerAndPlatformApp` — verify MCP server + load platform OAuthApp template
3. `Authorize` — FGA `can_connect` on MCP server + `can_create_oauth_app` on org
4. `CreateOrgOAuthApp` — create OAuthApp via command pipeline + create override
5. `TransformResponse` / `SendResponse`

### 2. `McpServerGetOrgOAuthAppHandler`

New handler. Looks up `OAuthAppOverrideRepo.find(resourceId, "mcp_server", org)` and returns override metadata (not secrets).

### 3. `McpServerDeleteOrgOAuthAppHandler`

New handler. Deletes the OAuthAppOverride binding. Optionally deletes the org's OAuthApp if no other overrides reference it.

Also deletes any existing OAuthGrant for this user + resource + org (since the credentials are changing), and the associated managed environment.

### 4. Modify `McpServerInitiateOAuthConnectHandler.ExecuteInitiate`

**Current:** Directly reads `auth.getOauthAppRef()` and loads OAuthApp by slug.

**Target:** Use `OAuthAppResolutionService.resolveForMcpServer(mcpServer, org)` to get the effective OAuthApp. The rest of the vendor OAuth path (build auth URL, create pending state) uses the resolved app.

```java
// Replace direct oauth_app_ref lookup with resolution chain
var resolved = oauthAppResolutionService.resolveForMcpServer(mcpServer, org);
if (resolved.source() == OAuthAppSource.OAUTH_APP_SOURCE_NONE) {
    // Fall through to DCR path or error
}
OAuthApp oauthApp = resolved.oauthApp();
// ... rest of vendor OAuth flow using oauthApp
```

The `org` comes from `context.getRequest().getOrg()` (already available on `InitiateOAuthConnectInput`).

### 5. Modify `OAuthTokenRefreshService.resolveClientSecret`

**Current:** `oauthAppRepo.findBySlug(slug)` — always platform OAuthApp.

**Target:** Use resolution chain. The grant's `orgId` tells us which org to resolve for:

```java
private String resolveClientSecret(McpServer mcpServer, String orgId) {
    var resolved = oauthAppResolutionService.resolveForMcpServer(mcpServer, orgId);
    if (resolved == null || resolved.oauthApp() == null) return "";
    String secret = resolved.oauthApp().getSpec().getClientSecret();
    return encryptionService.isEncrypted(secret) ? encryptionService.decrypt(secret) : secret;
}
```

The `refreshIfExpired` method already receives `org` from the caller. Pass it through to `resolveClientSecret`.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `McpServerSetOrgOAuthAppHandler.java` | Create | Composite BYOA handler |
| `McpServerGetOrgOAuthAppHandler.java` | Create | Query org override |
| `McpServerDeleteOrgOAuthAppHandler.java` | Create | Delete org override |
| `McpServerCommandController.java` (method enum) | Modify | Add 3 new methods |
| `McpServerGrpcAutoController.java` | Modify | Wire 3 new RPCs |
| `McpServerInitiateOAuthConnectHandler.java` | Modify | Use resolution service |
| `OAuthTokenRefreshService.java` | Modify | Use resolution service for client secret |

## Acceptance Criteria

- [ ] `setOrgOAuthApp` creates an OAuthApp cloned from platform template with user's credentials + creates override binding
- [ ] Cloned OAuthApp has `vendor_approval_status = APPROVED` (self-approved)
- [ ] `initiateOAuthConnect` resolves org override before falling back to platform
- [ ] Token refresh resolves correct client_secret from org override when applicable
- [ ] Existing users without overrides see zero behavior change
- [ ] Delete override also cleans up grant + managed env for that user

## Predecessor Tasks

T04 (resolution service + repo + enricher)

## Successor Tasks

T07 (frontend BYOA experience)
