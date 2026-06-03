# Remote MCP Server OAuth Discovery (mcp.stigmer.ai)

**Date**: June 3, 2026

## Summary

The hosted Stigmer MCP server at `https://mcp.stigmer.ai` now advertises OAuth
2.0 discovery (RFC 9728 Protected Resource Metadata) so OAuth-only MCP clients —
notably Claude Desktop's and claude.ai's "Add custom connector" GUI — can sign
in without a manually-supplied header. The change is purely additive: the server
stays a stateless Bearer passthrough, so API keys (`stk_…`) and bring-your-own
IdP tokens keep working unchanged. The advertised authorization server is
Stigmer's primary Auth0 tenant.

## Problem Statement

The remote deployment (see
[`2026-06-03-110650-remote-mcp-server-deployment.md`](2026-06-03-110650-remote-mcp-server-deployment.md))
relied entirely on manual `Authorization: Bearer` headers. Claude Desktop's
connector GUI cannot accept a manual header — it requires the MCP authorization
flow (401 challenge → protected-resource metadata → authorization-server
discovery → client registration → OAuth 2.1 + PKCE). Non-technical users who
only have the desktop app's GUI therefore could not connect at all.

### Pain Points

- OAuth-only clients (Claude Desktop GUI) had no way to authenticate.
- The original deployment deferred OAuth out of concern it would "break
  bring-your-own-IdP orgs" — conflating Bearer passthrough (works for every IdP)
  with OAuth discovery (an additive capability). Adding discovery does not remove
  passthrough; clients that send a header never see the challenge.

## Solution

Advertise Auth0 directly as the authorization server via RFC 9728, and teach the
cloud token validator to accept the MCP server's audience. No OAuth server is
built in Stigmer — Auth0 owns the entire OAuth surface (discovery, client
registration, PKCE, token issuance) through its first-class "Auth for MCP"
support.

```
Claude → mcp.stigmer.ai (401 + WWW-Authenticate resource_metadata)
       → GET /.well-known/oauth-protected-resource → { authorization_servers: [Auth0] }
       → Auth0 discovery + registration (CIMD) + OAuth 2.1/PKCE (resource=https://mcp.stigmer.ai)
       → access token (aud = https://mcp.stigmer.ai)
       → mcp.stigmer.ai forwards token unchanged → stigmer-server validates
```

## Implementation Details

### OSS — `mcp-server` (issuer-agnostic, config-driven, default-off)

- **Config** (`mcp-server/internal/config/config.go`): new `OAuthMetadata` block
  from `STIGMER_MCP_OAUTH_ENABLED`, `STIGMER_MCP_OAUTH_RESOURCE`,
  `STIGMER_MCP_OAUTH_AUTHORIZATION_SERVERS`, `STIGMER_MCP_OAUTH_SCOPES_SUPPORTED`.
  Disabled by default; when enabled, requires a resource and ≥1 issuer. No Auth0
  strings in code.
- **HTTP layer** (`mcp-server/internal/server/http.go`): when enabled, serves
  `GET /.well-known/oauth-protected-resource` via the go-sdk
  `auth.ProtectedResourceMetadataHandler` (RFC 9728 + CORS) and adds a
  `WWW-Authenticate: Bearer …, resource_metadata="…"` challenge to the
  missing-token `401`. When disabled, behavior is byte-for-byte unchanged. The
  server never parses or validates tokens — passthrough is intact.
- **Tests**: config parsing/validation, PRM document, CORS preflight, challenge
  format, and a regression guard that a present Bearer token never triggers the
  challenge.
- **Prod overlay** (`mcp-server/_kustomize/overlays/prod/service.yaml`): sets
  `STIGMER_MCP_OAUTH_ENABLED=true`, resource `https://mcp.stigmer.ai`, issuer
  `https://stigmer-prod.us.auth0.com/`. Base overlay stays OAuth-off.
- **Docs**: CLI reference (`stigmer mcp-server`) and `mcp-server/README.md`
  document the OAuth connector path, the new env vars, that the manual-header
  path is unchanged, and the bring-your-own-IdP v1 limitation.

### Cloud — `stigmer-service` token validation (separate repo)

- `GrpcSecurityConfigBase.auth0JwtDecoder()` now builds the accepted-audience
  list from the primary API audience **plus** an optional MCP audience; the HTTP
  side-channel proxy reuses the same decoder, so it inherits the change.
- New `security.authentication.mcp-audience` (`AUTH0_MCP_AUDIENCE`), wired through
  `application-auth0.yaml`, the `stigmer-auth0-config` variables group
  (`prod.mcp-audience = https://mcp.stigmer.ai`), and the prod overlay.
- **Security integration test** (`test/integration-security/jwt_mcp_audience_test.go`):
  an Auth0 JWT with `aud = mcp.stigmer.ai` authenticates; an unrelated audience
  is rejected. The harness gained an `Auth0McpAudience` knob.

### Ops — Auth0 tenant (`stigmer-prod.us.auth0.com`, configured this session)

- Created API/resource server `https://mcp.stigmer.ai` (RS256, offline access,
  third-party `user: allow_all` / `client: deny_all`).
- Tenant: `resource_parameter_profile = compatibility` (honor RFC 8707
  `resource`), `client_id_metadata_document_supported = true` (CIMD).
- Promoted Google and Username-Password connections to domain level (required for
  third-party client login).
- Open Dynamic Client Registration left **off** — CIMD is the secure path and the
  endpoint-locking control (Tenant ACL) is Enterprise-only.

## Benefits

- OAuth-only clients (Claude Desktop, claude.ai) can connect via the GUI.
- Zero change for API-key and bring-your-own-IdP users — the manual-header path
  is untouched.
- The OSS server stays issuer-agnostic; all Auth0 specifics live in cloud
  deployment configuration, not code.

## Impact

- Once deployed, `mcp.stigmer.ai` serves discovery and accepts Auth0 MCP-audience
  tokens. A connecting user must already have a Stigmer identity account (identity
  resolves from the token `sub`).
- Bring-your-own-IdP orgs are unchanged: the advertised issuer is a single tenant,
  so those users continue with a manual header (or local STDIO) until per-org
  OAuth discovery is built.

## Related Work

- Builds on
  [`2026-06-03-110650-remote-mcp-server-deployment.md`](2026-06-03-110650-remote-mcp-server-deployment.md)
  (the hosted endpoint + Bearer passthrough).

## Remaining / Verification

- **Deploy** the OSS prod overlay and `stigmer-service` audience change via Planton.
- **Live connect test** from Claude Desktop; confirm the issued token's `aud` is
  exactly `https://mcp.stigmer.ai` (no trailing slash).
- If Claude cannot register via CIMD, revisit enabling open DCR.

---

**Status**: 🚧 In Progress — code complete and Auth0 configured; pending prod
deploy and a live end-to-end connect test.
