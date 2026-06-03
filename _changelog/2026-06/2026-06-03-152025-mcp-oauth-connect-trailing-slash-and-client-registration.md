# MCP OAuth Connect: Trailing-Slash Audience + Third-Party Client Registration

**Date**: June 3, 2026

## Summary

With OAuth discovery finally live on `mcp.stigmer.ai`, a real end-to-end connect
from claude.ai's "Add custom connector" still failed at Auth0's `/authorize`
with a generic "Oops, something went wrong." Live probing surfaced **three**
distinct, sequential blockers — an unregistered CIMD client, a resource
identifier that didn't match the trailing slash the client sends, and a missing
third-party client grant. This change aligns the hosted MCP server's advertised
resource on the trailing-slash form (`https://mcp.stigmer.ai/`) to match what
OAuth MCP clients actually request and what the Auth0 API now keys on; the Auth0
and cloud-audience sides were fixed alongside it.

## Problem Statement

The OAuth discovery work (see
[`2026-06-03-134217-remote-mcp-server-oauth-discovery.md`](2026-06-03-134217-remote-mcp-server-oauth-discovery.md)
and the propagation fix in
[`2026-06-03-142851-mcp-server-oauth-config-propagation-fix.md`](2026-06-03-142851-mcp-server-oauth-config-propagation-fix.md))
made `mcp.stigmer.ai` advertise its authorization server correctly. But the
connector GUI still could not complete the flow. Each `/authorize` rendered
Auth0's generic error page; the real cause was only visible by reproducing the
request and reading the hidden `invalid_request` / `access_denied` detail and
the tenant logs.

### Pain Points

- The failures were invisible behind Auth0's friendly error page and surfaced
  one at a time — fixing one revealed the next.
- The advertised resource was the bare origin (`https://mcp.stigmer.ai`), but
  OAuth MCP clients canonicalize the origin URI and send the RFC 8707 `resource`
  with a **trailing slash** (`https://mcp.stigmer.ai/`). Auth0 matches `resource`
  to API identifiers by exact string, so it returned `Service not found`.
- Auth0's CIMD support is *manual-registration*: the tenant flag only advertises
  the capability; the client must be pre-registered or `/authorize` fails with
  `Unknown client`.
- Third-party applications always require an explicit client grant, even when the
  API access policy is "Allow All" — without it Auth0 returns
  `Client … is not authorized to access resource server`.

## Solution

Standardize the MCP audience on the **trailing-slash** canonical form across all
three places it must agree, mirroring the primary API's existing
`https://api.stigmer.com/` convention:

| Place | Value |
| --- | --- |
| MCP server advertised resource (`STIGMER_MCP_OAUTH_RESOURCE`) | `https://mcp.stigmer.ai/` |
| Auth0 API (resource server) identifier → token `aud` | `https://mcp.stigmer.ai/` |
| Cloud accepted audience (`prod.mcp-audience`) | `https://mcp.stigmer.ai/` |

The OSS change in this repo is the MCP server overlay; the Auth0 and cloud
changes were made alongside it (see Impact / Related Work). No OAuth server is
built in Stigmer — Auth0 owns the entire OAuth surface, and the MCP server stays
a stateless Bearer passthrough.

## Implementation Details

### OSS — `mcp-server/_kustomize/overlays/prod/service.yaml`

- `STIGMER_MCP_OAUTH_RESOURCE`: `https://mcp.stigmer.ai` → `https://mcp.stigmer.ai/`.
- Expanded the env comment to record the trailing-slash invariant: OAuth MCP
  clients send the canonical origin URI (empty path → `/`), Auth0 matches
  `resource` to API identifiers by exact string, so the advertised resource, the
  Auth0 API identifier, and the cloud audience are all the slash form.

### Cloud (`stigmer-cloud`, separate repo)

- `prod.mcp-audience`: `https://mcp.stigmer.ai` → `https://mcp.stigmer.ai/` in the
  `stigmer-auth0-config` VariablesGroup (applied via `planton apply`).
  `GrpcSecurityConfigBase.acceptedAudiences()` exact-matches token `aud` against
  this value, so it must equal the Auth0 API identifier.
- New setup guides: `_ops/setup-guides/02-auth0-mcp-oauth-setup.md` documents the
  full MCP OAuth setup (tenant flags, MCP API, third-party client grant, CIMD/DCR
  registration, domain-level connections, verification, troubleshooting), and
  `01-auth0-setup.md` gained `auth0` CLI commands alongside every Dashboard step.

### Ops — Auth0 tenant (`stigmer-prod.us.auth0.com`, this session)

- **Registered the claude.ai CIMD client** (`clients/cimd/register`,
  `external_client_id = https://claude.ai/oauth/mcp-oauth-client-metadata`) →
  `tpc_8rjKhCnJFL34Uub8E8F5S3`. Fixes `Unknown client`.
- **Created the trailing-slash MCP API** (`resource-servers`,
  `identifier = https://mcp.stigmer.ai/`) → `6a1ff639267de75f4e7f57ab`. Fixes
  `Service not found`.
- **Created a default third-party user grant** (`client-grants`,
  `default_for: third_party_clients`, `subject_type: user`,
  `audience: https://mcp.stigmer.ai/`) → `cgr_velZTIXqB9jN0omu`, so any OAuth MCP
  client (not just Claude) gets user-delegated access automatically. Fixes
  `not authorized to access resource server`.
- Confirmed live: the original failing `/authorize` URL now returns
  `302 → /u/login` instead of an error page.

## Benefits

- claude.ai / Claude Desktop and other OAuth-only connector GUIs can complete the
  authorization flow against the hosted MCP server.
- The default third-party grant means new connector types work without further
  Auth0 changes.
- The setup guides capture the entire (previously undocumented) MCP OAuth wiring,
  including the trailing-slash gotcha and an error → cause → fix table.

## Impact

- Requires the fixed `mcp-server` image and a `stigmer-service` redeploy to pick
  up the trailing-slash resource/audience; until `stigmer-server` accepts
  `https://mcp.stigmer.ai/` as `aud`, OAuth completes but tool calls return `401`.
- No behavior change for API-key (`stk_…`) or bring-your-own-IdP users — they send
  an `Authorization` header directly and never hit the discovery/challenge path.
- The no-slash Auth0 API is left in place as a harmless fallback; it can be
  deleted after a verified live connect.

## Related Work

- Completes the connect path opened by
  [`2026-06-03-134217-remote-mcp-server-oauth-discovery.md`](2026-06-03-134217-remote-mcp-server-oauth-discovery.md)
  and
  [`2026-06-03-142851-mcp-server-oauth-config-propagation-fix.md`](2026-06-03-142851-mcp-server-oauth-config-propagation-fix.md).
- Builds on
  [`2026-06-03-110650-remote-mcp-server-deployment.md`](2026-06-03-110650-remote-mcp-server-deployment.md).

---

**Status**: ✅ Auth0 fixed and verified live (302 → login); OSS + cloud config
complete — pending the `stigmer-service` / `mcp-server` redeploy and a live
end-to-end tool call.
