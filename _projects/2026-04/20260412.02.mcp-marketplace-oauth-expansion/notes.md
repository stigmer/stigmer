# Notes: 20260412.02.mcp-marketplace-oauth-expansion

**Created**: 2026-04-12

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-04-12 -- Research Complete, Project Bootstrapped

### Key Decisions
- DCR verification is mandatory before adding any server as "DCR-compatible" (Pattern A / no `oauth_app_ref`).
- Two auth patterns in Stigmer YAML:
  - **Pattern A (DCR)**: `auth.target_env_var` only. Stigmer auto-discovers + DCR. Used for Linear, Notion, etc.
  - **Pattern B (Vendor OAuth)**: `auth.oauth_app_ref` pointing to an OAuthApp resource. Used for Figma, Slack.
- For Wave 1, all servers are Pattern A. Wave 3 servers are Pattern B.

### Learnings
- Having `registration_endpoint` in OAuth metadata does NOT guarantee DCR works. Vercel has it but enforces an allowlist.
- The old Cloudflare servers (`bindings.mcp.cloudflare.com`) had broken DCR until March 2026. The NEW `mcp.cloudflare.com` server works.
- GitHub explicitly does not support DCR. Asana V2 explicitly does not support DCR.
- Many vendors use an **OAuth proxy pattern**: a thin MCP-specific OAuth layer on `mcp.*.com` that accepts DCR, then proxies to the vendor's standard OAuth.
- Stripe built a dedicated DCR layer at `access.stripe.com/mcp/oauth2/register`.

### Gotchas
- Atlassian is currently configured as DCR-compatible in the marketplace, but awesome-remote-mcp-servers lists it as "no DCR". Needs auditing (T06).
- Datadog has regional endpoints (datadoghq.eu, etc) -- users in EU need different URL.
- Webflow auto-installs a companion Bridge app during OAuth.
- PayPal production endpoint is `/http` (streamable HTTP), sandbox is separate at `mcp.sandbox.paypal.com`.

### References
- Full research plan: `/Users/suresh/.cursor/plans/oauth_mcp_server_research_7faa970d.plan.md`
- Awesome Remote MCP Servers: https://github.com/jaw9c/awesome-remote-mcp-servers
- MCP Authorization Spec (2025-11-25): DCR + CIMD + Cross App Access

---

## 2026-04-12 -- T05 Expanded (Session 3)

### Key Decisions
- **BigQuery dropped**: No confirmed hosted endpoint at `https://bigquery.googleapis.com/mcp`. Google's BigQuery MCP server is stdio-only. `GOOGLE_API_KEY` is wrong credential type for BigQuery.
- **HubSpot env var**: Used `HUBSPOT_ACCESS_TOKEN` (not `HUBSPOT_API_KEY`). HubSpot deprecated API keys in 2022; the actual credential is a "Private App Access Token." Matches codebase convention.
- **discovery_url proto field**: Added `discovery_url` to `McpServerAuth` to enable DCR for stdio servers. Resolution: `discovery_url` > `http.url`. Ignored when `oauth_app_ref` is set.
- **GitHub OAuth reuses existing credentials**: Duplicated from `github-oauth-config/credentials` into `vendor-oauth-config/credentials`. Same client_id/secret, separate pipeline entry.
- **Google Calendar OAuth**: New dedicated Google Cloud OAuth client created (separate from Auth0 Login client). Calendar scope classified as sensitive — shows unverified warning until Google verification.

### Learnings
- **stdio + OAuth is architecturally supported**: The proto schema already allows `auth` on stdio servers. Vendor OAuth (with `oauth_app_ref`) works because the OAuthApp provides endpoints directly — no URL discovery needed. DCR needed `discovery_url` because there's no `http.url` to derive the discovery endpoint from.
- **HubSpot and PagerDuty support OAuth** (without DCR): Both expose `/.well-known/oauth-authorization-server` with full authorization/token endpoints but no `registration_endpoint`. They are vendor OAuth candidates (T04) but added as API-key-only for now since we don't have registered OAuth apps.
- **Brevo is genuinely API-key-only**: No OAuth metadata at all (404 on well-known endpoints).

### Future Work (move to T04)
- **Upgrade HubSpot to vendor OAuth**: Register OAuth app at HubSpot developer portal, create OAuthApp resource, add `oauth_app_ref` to `mcp-server-hubspot.yaml`.
- **Upgrade PagerDuty to vendor OAuth**: Register OAuth app at PagerDuty, create OAuthApp resource, add `oauth_app_ref` to `mcp-server-pagerduty.yaml`.
- **Submit Google Calendar for verification**: Go to Google Auth Platform > Verification centre, submit for sensitive scope review.
- **Verify GitHub OAuth App redirect URI**: Ensure `https://app.stigmer.ai/auth/oauth/callback` is added to the GitHub OAuth App's redirect URIs at github.com/settings/developers.

---

## 2026-04-12 -- T06+T03 Combined (Session 4)

### Key Decisions
- **Combined T06 and T03** into a single verification pass. All 13 servers verified in parallel, then YAML written in batch.
- **Dropbox moved to T04**: Has full OAuth (auth server at `www.dropbox.com`, well-known metadata, registration_endpoint) but DCR returns "Only pre-registered MCP trusted partners are allowed." Same allowlist pattern as Vercel.
- **Stack Overflow skipped**: 404 on well-known. No OAuth metadata at all.
- **Grafbase skipped**: Vercel deployment removed (DEPLOYMENT_NOT_FOUND). Service is down.

### Learnings
- **Atlassian DCR works** despite awesome-remote-mcp-servers listing it as "no DCR." The listing is wrong. Discovery is at the ROOT of `mcp.atlassian.com`, not under the `/v1/` path. Issuer is `cf.mcp.atlassian.com` (Cloudflare-fronted OAuth proxy).
- **GitLab DCR works** with `scope: "mcp"` and `require_pkce: true`. GitLab supports MCP-specific OAuth scopes (`mcp`, `mcp_orbit`).
- **Dropbox uses Protected Resource Metadata** (RFC 8707 pattern): The MCP endpoint returns `WWW-Authenticate` with `resource_metadata` URL, which points to the auth server at `www.dropbox.com`. The direct `/.well-known/oauth-authorization-server` at `mcp.dropbox.com` returns 429 -- it may not be served from there at all.
- **Egnyte redirects OAuth discovery**: `mcp-server.egnyte.com` 302-redirects well-known requests to `mcp-oauth.egnyte.com`. The MCP endpoint stays at `mcp-server.egnyte.com/sse`.
- **Port IO domain**: Listed as `mcp.port.io` in task, actual OAuth issuer is `auth.getport.io`, endpoints at `mcp.getport.io`. Both `mcp.port.io` and `mcp.getport.io` resolve to the same MCP service.
- **Prisma uses JWT client_ids**: DCR returns a signed JWT as client_id with a `client_secret`. Auth server at `auth.prisma.io`, separate from MCP endpoint at `mcp.prisma.io`.
- **Ramp overrides client_name**: DCR POST returned `client_name: "Ramp MCP Remote"` regardless of what we sent. No impact on functionality.

### Verification Results Summary
- **DCR confirmed (8 new)**: Wix, Canva, Netlify, Ramp, Prisma, Cloudinary, Egnyte, Port IO
- **DCR confirmed (2 existing)**: Atlassian, GitLab -- existing YAML configs are correct
- **No DCR / blocked (3)**: Dropbox (allowlist), Stack Overflow (no OAuth), Grafbase (service down)
- **Marketplace count**: 48 → 56 servers

---
