# Task T01: Proto Definitions (OAuthApp + McpServerAuth + OAuthGrant)

**Created**: 2026-04-10
**Status**: PENDING REVIEW (Final)
**Type**: Feature Development
**Repos**: stigmer (OSS)
**Estimated Effort**: 1.5-2 days

## Objective

Define all new proto types for the OAuth feature: the OAuthApp resource (iam bounded context), the McpServerAuth block on McpServerSpec, and the OAuthGrant infrastructure proto. Regenerate stubs in both repos.

## Key Design Decisions

1. **OAuthApp** -- first-class resource in `iam` context (like IdentityProvider). Holds vendor OAuth client credentials. Org-scoped, anyone with permissions can create.
2. **McpServerAuth** -- `oneof` with `mcp_oauth` (DCR, inline, no OAuthApp) and `vendor_oauth` (reference to OAuthApp). DCR stays inline because it's a server capability, not pre-existing configuration.
3. **OAuthGrant** -- infrastructure-only proto (not a public resource). Keyed by (user_id, mcp_server_id). Stores non-secret metadata (expiry, client_id, token_endpoint). 
4. **Tokens in personal environment** -- both access token and refresh token stored as secret env vars in the personal environment. OAuthGrant.refresh_token_env_var points to where the refresh token lives.
5. **Refresh token as primary mechanism** -- no mid-execution interrupt. Pre-flight check refreshes expired tokens before execution starts. If refresh token itself is expired, execution fails cleanly and user re-authenticates from Connect page.
6. **No EXECUTION_WAITING_FOR_REAUTH** -- dropped the interrupt-based re-auth. Refresh tokens handle 95% of cases. The interrupt approach can be added later if needed.

## Proto Changes

### 1. OAuthApp Resource (`apis/ai/stigmer/iam/oauthapp/v1/`)

New resource in the `iam` bounded context, alongside IdentityProvider.

**`api.proto`**:
```protobuf
message OAuthApp {
  string api_version = 1 [(buf.validate.field).string.const = 'iam.stigmer.ai/v1'];
  string kind = 2 [(buf.validate.field).string.const = 'OAuthApp'];
  ai.stigmer.commons.apiresource.ApiResourceMetadata metadata = 3 [(buf.validate.field).required = true];
  OAuthAppSpec spec = 4;
  ai.stigmer.commons.apiresource.ApiResourceAuditStatus status = 5;
}
```

**`spec.proto`**:
```protobuf
// OAuthAppSpec defines a registered OAuth application with an external vendor.
//
// @internal
// Represents Stigmer's (or a platform builder's) OAuth app registration
// with an external vendor like Slack, Salesforce, or Figma.
//
// Created by org admins or platform operators. Referenced by McpServer
// resources that need vendor OAuth authentication.
//
// Analogous to IdentityProvider (inbound auth trust), OAuthApp represents
// outbound auth -- how Stigmer authenticates with external services on
// behalf of users.
//
// Security:
// - client_secret is encrypted at rest and redacted in logs.
// - The resource should have visibility_private to prevent secret leakage.
message OAuthAppSpec {
  // Human-readable vendor name for UI display and logging.
  // Examples: "Slack", "Salesforce", "Figma"
  string provider = 1;

  // OAuth client identifier registered with the vendor.
  string client_id = 2 [(buf.validate.field).string.min_len = 1];

  // OAuth client secret registered with the vendor.
  // Encrypted at rest, redacted in logs.
  string client_secret = 3 [(buf.validate.field).string.min_len = 1];

  // Vendor's OAuth authorization endpoint.
  string authorization_url = 4 [(buf.validate.field).string.uri = true];

  // Vendor's OAuth token endpoint.
  string token_url = 5 [(buf.validate.field).string.uri = true];

  // OAuth scopes to request during the authorization flow.
  repeated string scopes = 6;

  // Redirect URI registered with the vendor.
  // Must exactly match what was configured in the vendor's app settings.
  string redirect_uri = 7;
}
```

**`io.proto`**: Standard `OAuthAppId` wrapper.

**`command.proto`**: Standard CRUD RPCs: `apply`, `create`, `update`, `delete`, `updateVisibility`.
Authorization: `can_edit` / `can_delete` on `oauth_app` resource kind.

**`query.proto`**: Standard read RPCs: `get`, `getByReference`, `list`.
Authorization: `can_view` on `oauth_app`.

### 2. McpServerAuth on McpServerSpec (`apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`)

```protobuf
// Authentication configuration for automated credential acquisition.
//
// @internal
// Two methods:
// - mcp_oauth: Server implements MCP Authorization spec (DCR + PKCE).
//   Everything auto-discovered from server URL. No OAuthApp needed.
// - vendor_oauth: Server needs pre-registered OAuth app credentials.
//   References an OAuthApp resource created by the org admin.
//
// In both cases, the acquired access token is stored in the user's
// personal environment as target_env_var. A refresh token (if issued
// by the vendor) is stored alongside as {target_env_var}_REFRESH_TOKEN.
//
// Token lifecycle:
// - Pre-flight check before execution: if access token is expired,
//   backend uses the refresh token to obtain a new one automatically.
// - If refresh token is also expired: execution fails with a clear
//   error, user re-authenticates from the MCP server Connect page.
message McpServerAuth {
  oneof method {
    option (buf.validate.oneof).required = true;

    // MCP OAuth spec: DCR + PKCE, auto-discovered from server URL.
    McpOAuth mcp_oauth = 1;

    // Vendor-specific OAuth: references an OAuthApp with client credentials.
    McpServerVendorOAuth vendor_oauth = 2;
  }

  // The env var in env_spec.data where the acquired access token is stored.
  // The refresh token is stored as {target_env_var}_REFRESH_TOKEN by convention.
  // Both are stored in the user's personal environment.
  string target_env_var = 3 [(buf.validate.field).string.min_len = 1];

  // Informational hint about expected token lifetime for UI display.
  // Empty means unknown. Examples: "1h", "2h", "never", "90d".
  string token_lifetime_hint = 4;
}

// MCP OAuth spec authentication (DCR + PKCE).
//
// @internal
// The server implements the MCP Authorization specification:
// - RFC 8414: OAuth 2.0 Authorization Server Metadata (.well-known discovery)
// - RFC 7591: Dynamic Client Registration
// - OAuth 2.1 with PKCE (S256)
//
// Stigmer discovers everything from the server URL at connect time.
// No OAuthApp needed -- credentials obtained automatically via DCR.
message McpOAuth {
  // Optional scope hints for UI display before the OAuth flow starts.
  repeated string scope_hints = 1;
}

// Vendor-specific OAuth authentication.
//
// @internal
// References an OAuthApp resource that holds the vendor's client credentials.
// The OAuthApp is created by the org admin or platform operator who
// registered an OAuth app with the vendor (e.g., Slack, Salesforce).
message McpServerVendorOAuth {
  // Reference to the OAuthApp providing client credentials.
  ai.stigmer.commons.apiresource.ApiResourceReference oauth_app_ref = 1
    [(buf.validate.field).required = true];
}
```

Add field to McpServerSpec: `McpServerAuth auth = 14;`

### 3. OAuthGrant Internal Storage (`apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto`)

```protobuf
// OAuthGrant tracks OAuth metadata for a user's MCP server connection.
//
// @internal
// Infrastructure-only. Not a public API resource -- no kind, no apiVersion,
// no CRUD RPCs. Stored in the backend's database, keyed by
// (identity_account_id, mcp_server_id).
//
// Actual tokens (access + refresh) live in the user's personal environment
// as secret env vars. OAuthGrant only holds non-secret metadata needed
// by the refresh mechanism and pre-flight expiry checks.
//
// Storage split:
// - Personal env: access token (target_env_var), refresh token ({target_env_var}_REFRESH_TOKEN)
// - OAuthGrant: expiry, client_id, token_endpoint, env var names
message OAuthGrant {
  // Which user owns this grant.
  string identity_account_id = 1;

  // Which MCP server this grant is for.
  string mcp_server_id = 2;

  // When the current access token expires (Unix timestamp seconds).
  // 0 if the token does not expire (e.g., Notion, Slack user tokens).
  int64 access_token_expires_at = 3;

  // Client ID. From DCR registration or from the referenced OAuthApp.
  string client_id = 4;

  // Which auth method was used: "mcp_oauth" or "vendor_oauth".
  string auth_method = 5;

  // The token endpoint URL for refresh requests.
  // For mcp_oauth: discovered via .well-known.
  // For vendor_oauth: from OAuthApp.spec.token_url.
  string token_endpoint = 6;

  // Env var name where the access token is stored.
  // Matches McpServerAuth.target_env_var.
  string access_token_env_var = 7;

  // Env var name where the refresh token is stored.
  // Convention: {target_env_var}_REFRESH_TOKEN.
  string refresh_token_env_var = 8;

  // Which Environment resource holds the tokens.
  // The refresh mechanism reads/writes tokens in this environment.
  // Default: user's personal environment (stigmer.ai/personal=true).
  // Allows future flexibility to store tokens in team or project environments.
  string environment_id = 9;
}
```

## Stub Regeneration

- `stigmer`: Go stubs, TypeScript stubs
- `stigmer-cloud`: Java stubs

## Files Created/Modified

| File | Action |
|------|--------|
| `apis/ai/stigmer/iam/oauthapp/v1/api.proto` | New |
| `apis/ai/stigmer/iam/oauthapp/v1/spec.proto` | New |
| `apis/ai/stigmer/iam/oauthapp/v1/io.proto` | New |
| `apis/ai/stigmer/iam/oauthapp/v1/command.proto` | New |
| `apis/ai/stigmer/iam/oauthapp/v1/query.proto` | New |
| `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` | Add McpServerAuth, McpOAuth, McpServerVendorOAuth, auth field |
| `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto` | New (OAuthGrant) |

## Success Criteria

- `buf lint` and `buf build` pass
- Stubs regenerated in both repos
- No breaking changes to existing protos
