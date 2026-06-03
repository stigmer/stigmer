# MCP Server OAuth Discovery Config Propagation Fix

**Date**: June 3, 2026

## Summary

The hosted MCP server's OAuth 2.0 discovery (RFC 9728) was correctly configured
in prod — the right env vars, the right image, valid config — yet
`mcp.stigmer.ai` never advertised it, so Claude Desktop's GUI connector could
not authenticate. The root cause was a silent config-drop in the public
`mcpserver.Config` wrapper: it had no OAuth fields, so the
`LoadFromEnv → fromInternal → toInternal` round-trip the real binary uses reset
`OAuth.Enabled` to `false` at every startup. This change adds the OAuth fields
to the public config and maps them in both directions, plus regression tests
that exercise the full startup path the unit suite previously skipped.

## Problem Statement

The OAuth discovery feature (see
[`2026-06-03-134217-remote-mcp-server-oauth-discovery.md`](2026-06-03-134217-remote-mcp-server-oauth-discovery.md))
shipped, the prod overlay set `STIGMER_MCP_OAUTH_ENABLED=true`, and the deployed
image contained the OAuth code — but live probes showed discovery was never
served:

- `GET /.well-known/oauth-protected-resource` → `401` (no metadata document).
- `POST /mcp` with no token → `401` with **no** `WWW-Authenticate` challenge.

Both are the byte-for-byte "OAuth disabled" behavior, even though every input
said it should be enabled. Claude Desktop, unable to discover the authorization
server, fell back to probing `/.well-known/oauth-authorization-server` and
`/register` (both `401`) and surfaced "Couldn't register with Stigmer's sign-in
service."

### Pain Points

- OAuth-only clients (Claude Desktop GUI) still could not connect despite the
  feature being "deployed."
- The failure was invisible: env, image, and validation were all correct, so the
  bug only manifested at runtime in the assembled HTTP routes.
- The existing unit tests passed because they never exercised the binary's real
  startup path.

## Solution

The standalone binary loads config as
`DefaultConfig() → LoadFromEnv() → fromInternal()` (producing the public
`mcpserver.Config`) and then runs it via `Run() → cfg.toInternal()`. The public
`mcpserver.Config` struct had **no OAuth fields**, so:

1. `fromInternal` dropped the OAuth block when mapping internal → public.
2. `toInternal` rebuilt the internal config with a zero-value `OAuth`
   (`Enabled: false`).
3. `ServeHTTP` saw `OAuth.Enabled == false` and never registered the
   well-known route or the `WWW-Authenticate` challenge.

The fix threads OAuth through the public config so the round-trip is lossless.

## Implementation Details

### `mcp-server/pkg/mcpserver/config.go`

- Added `OAuthEnabled`, `OAuthResource`, `OAuthAuthorizationServers`, and
  `OAuthScopesSupported` to the public `Config` (plain Go types, consistent with
  the existing flat surface).
- `fromInternal` now copies `ic.OAuth.*` into the new fields.
- `toInternal` now reconstructs `config.OAuthMetadata{...}` from them before
  validation, so the internal config the server runs on carries OAuth intact.

### `mcp-server/pkg/mcpserver/config_test.go`

- `clearEnv` neutralizes the four `STIGMER_MCP_OAUTH_*` vars so ambient
  environment cannot mask the bug.
- `TestDefaultConfig_propagatesOAuth` asserts OAuth survives the full
  `DefaultConfig → toInternal` path (the exact prod path that was broken).
- `TestConfig_toInternal_roundTrip` gained OAuth assertions in both directions
  as a regression guard.

### Verification

- `go build ./...`, `go vet`, and `gofmt` clean.
- Full `mcp-server` module test suite passes.

### Ops (this session, Auth0 tenant `stigmer-prod.us.auth0.com`)

- Enabled **Open Dynamic Client Registration** (`enable_dynamic_client_registration`)
  via the Management API. Claude Desktop's connector registers via DCR (not
  CIMD), and the endpoint had been rejecting registration with "dynamic client
  registration is disabled." Confirmed live: `POST /oidc/register` now mints a
  third-party client. (`resource_parameter_profile=compatibility` and CIMD
  support were already correctly set.)

## Benefits

- OAuth discovery actually activates in prod once the fixed image deploys —
  the well-known document and `WWW-Authenticate` challenge will be served.
- Claude Desktop and other OAuth-only GUI clients can connect with only a URL.
- The regression tests close the gap that let a fully-configured feature ship
  silently inert.

## Impact

- Requires a new `mcp-server` image to reach prod (deploy triggers on `main`
  changes under `mcp-server/`). Until then, discovery remains off.
- No behavior change for API-key or bring-your-own-IdP users — the
  manual-Bearer passthrough path was never affected.

## Related Work

- Fixes the deployment of
  [`2026-06-03-134217-remote-mcp-server-oauth-discovery.md`](2026-06-03-134217-remote-mcp-server-oauth-discovery.md).
- Builds on
  [`2026-06-03-110650-remote-mcp-server-deployment.md`](2026-06-03-110650-remote-mcp-server-deployment.md).

---

**Status**: ✅ Code complete and verified locally — pending prod deploy and a
live end-to-end connect test from Claude Desktop.
