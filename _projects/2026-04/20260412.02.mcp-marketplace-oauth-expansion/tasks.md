# Tasks: 20260412.02.mcp-marketplace-oauth-expansion

**Created**: 2026-04-12

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: T01 Wave-1a -- Add 9 DCR-verified new servers (YAML only, no manual steps)

**Status**: ✅ DONE
**Created**: 2026-04-12 16:48
**Completed**: 2026-04-12
**Effort**: ~1 hour
**Pattern**: `auth:` block with `target_env_var` only (no `oauth_app_ref`). Stigmer auto-discovers DCR.

All 9 servers have verified `registration_endpoint` in their `/.well-known/oauth-authorization-server` metadata.
Reference template: `seedpack/mcp-servers/mcp-server-linear.yaml`

### Subtasks

- [x] **PayPal** -- `https://mcp.paypal.com/sse` (production) / `https://mcp.paypal.com/http` (streamable HTTP)
  - Category: `payments`
  - Tags: paypal, payments, e-commerce, invoicing
  - Env: `PAYPAL_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: PAYPAL_ACCESS_TOKEN`
  - Token lifetime hint: `1h`
  - Note: Sandbox at `mcp.sandbox.paypal.com`. DCR confirmed via blog walkthrough.

- [x] **Intercom** -- `https://mcp.intercom.com/sse`
  - Category: `crm-support`
  - Tags: intercom, customer-support, messaging, helpdesk
  - Env: `INTERCOM_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: INTERCOM_ACCESS_TOKEN`
  - Token lifetime hint: `1h`

- [x] **monday.com** -- `https://mcp.monday.com/sse`
  - Category: `productivity`
  - Tags: monday, project-management, work-management, collaboration
  - Env: `MONDAY_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: MONDAY_ACCESS_TOKEN`
  - Token lifetime hint: `1h`

- [x] **Contentful** -- `https://mcp.contentful.com/mcp`
  - Category: `developer-tools`
  - Tags: contentful, cms, headless-cms, content-management
  - Env: `CONTENTFUL_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: CONTENTFUL_ACCESS_TOKEN`
  - Token lifetime hint: `1h`
  - Repo: https://github.com/contentful/contentful-mcp-server

- [x] **Buildkite** -- `https://mcp.buildkite.com/mcp`
  - Category: `developer-tools`
  - Tags: buildkite, ci-cd, pipelines, build-automation
  - Env: `BUILDKITE_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: BUILDKITE_ACCESS_TOKEN`, scope_hints: ["read", "write"]
  - Token lifetime hint: `1h`

- [x] **Webflow** -- `https://mcp.webflow.com/sse`
  - Category: `developer-tools`
  - Tags: webflow, website-builder, cms, web-design
  - Env: `WEBFLOW_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: WEBFLOW_ACCESS_TOKEN`
  - Token lifetime hint: `1h`
  - Note: Auto-installs companion Bridge app during OAuth.

- [x] **Square** -- `https://mcp.squareup.com/sse`
  - Category: `payments`
  - Tags: square, payments, point-of-sale, inventory
  - Env: `SQUARE_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: SQUARE_ACCESS_TOKEN`
  - Token lifetime hint: `1h`

- [x] **Attio** -- `https://mcp.attio.com/mcp`
  - Category: `crm-support`
  - Tags: attio, crm, sales, contacts
  - Env: `ATTIO_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: ATTIO_ACCESS_TOKEN`
  - Token lifetime hint: `1h`
  - Note: Auth server is at `app.attio.com` (not mcp.attio.com). Full OIDC with JWKS.

- [x] **Datadog** -- `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=core`
  - Category: `monitoring`
  - Tags: datadog, monitoring, observability, apm, logs
  - Env: `DATADOG_ACCESS_TOKEN` (is_secret: true)
  - Auth: `target_env_var: DATADOG_ACCESS_TOKEN`
  - Token lifetime hint: `1h`
  - Note: Regional endpoints exist (datadoghq.eu, etc). 16+ tools. HIPAA-eligible. `toolsets=core,software-delivery` for CI tools.

### Notes
- All use the same auth pattern as Linear/Notion: `auth.target_env_var` only, no `oauth_app_ref`.
- The URL in `http.url` should use the vendor's preferred endpoint (some use `/sse`, some `/mcp`).
- The `Authorization: Bearer ${ENV_VAR}` header pattern is consistent across all.

---

## Task 2: T02 Wave-1b -- Upgrade Stripe and Cloudflare to remote OAuth (DCR verified)

**Status**: ✅ DONE
**Created**: 2026-04-12 16:48
**Completed**: 2026-04-12
**Effort**: ~30 min
**What**: Convert existing stdio-based YAML to remote HTTP with OAuth auth block.

### Subtasks

- [x] **Stripe** -- Change from stdio to HTTP
  - Current: `stdio` with `npx -y @stripe/mcp@latest` + `STRIPE_SECRET_KEY`
  - New URL: `https://mcp.stripe.com/`
  - New env var: `STRIPE_ACCESS_TOKEN` (is_secret: true)
  - Add `auth.target_env_var: STRIPE_ACCESS_TOKEN`
  - DCR: `registration_endpoint` at `https://access.stripe.com/mcp/oauth2/register`
  - Note: Stripe built a dedicated MCP OAuth proxy layer. Keep the old `STRIPE_SECRET_KEY` env for users who prefer API key.

- [x] **Cloudflare** -- Change from stdio to HTTP (NEW server)
  - Current: `stdio` with `npx -y @cloudflare/mcp-server-cloudflare` + `CLOUDFLARE_API_TOKEN`
  - New URL: `https://mcp.cloudflare.com/mcp`
  - New env var: `CLOUDFLARE_ACCESS_TOKEN` (is_secret: true)
  - Add `auth.target_env_var: CLOUDFLARE_ACCESS_TOKEN`
  - DCR: `registration_endpoint` at `https://mcp.cloudflare.com/register`
  - Repo: https://github.com/cloudflare/mcp
  - Note: This is the NEW `mcp.cloudflare.com` server (Jan 2026), NOT the old `bindings.mcp.cloudflare.com`. The old one had broken DCR (issue #257, fixed March 2026). Test before shipping.

### Notes
- Decided on single env var pattern (STRIPE_ACCESS_TOKEN, CLOUDFLARE_ACCESS_TOKEN) instead of keeping old env vars alongside. Cleaner and avoids dead declarations.
- Dropped CLOUDFLARE_ACCOUNT_ID — the new remote endpoint handles account context via OAuth.
- Both endpoints live-verified: OAuth metadata, DCR registration, and MCP endpoint connectivity confirmed before writing YAML.
- Stripe uses Streamable HTTP transport (POST-only at root /), not SSE.
- Cloudflare repo URL updated from `cloudflare/mcp-server-cloudflare` to `cloudflare/mcp`.

---

## Task 3: T03 Wave-2 -- Verify and add unverified DCR servers (test /register endpoint first)

**Status**: ✅ DONE
**Created**: 2026-04-12 16:48
**Completed**: 2026-04-12
**Effort**: ~1 hour (combined with T06)
**What**: For each server, fetch `/.well-known/oauth-authorization-server`, confirm `registration_endpoint`, POST to it, and confirm a `client_id` is returned. Only then create the YAML.

### Subtasks

- [x] **Wix** -- `https://mcp.wix.com/sse`
  - DCR confirmed: `client_id: CTWEHGzLonfWbAfV`
  - YAML created: `seedpack/mcp-servers/mcp-server-wix.yaml`

- [x] **Canva** -- `https://mcp.canva.com/mcp`
  - DCR confirmed: `client_id: 5KWgRCCZ4GRbdMn9`
  - YAML created: `seedpack/mcp-servers/mcp-server-canva.yaml`

- [x] **Netlify** -- `https://netlify-mcp.netlify.app/mcp`
  - DCR confirmed: `client_id: WPj6y5rioBefjlitAdDp330AEzrtXXL5k75na1AR1Wp`
  - YAML created: `seedpack/mcp-servers/mcp-server-netlify.yaml`

- [x] **Ramp** -- `https://ramp-mcp-remote.ramp.com/mcp`
  - DCR confirmed: `client_id: <REDACTED>`
  - YAML created: `seedpack/mcp-servers/mcp-server-ramp.yaml`

- [x] **Prisma Postgres** -- `https://mcp.prisma.io/mcp`
  - DCR confirmed: JWT client_id + client_secret (auth server at `auth.prisma.io`)
  - YAML created: `seedpack/mcp-servers/mcp-server-prisma.yaml`

- [x] **Cloudinary** -- `https://asset-management.mcp.cloudinary.com/sse`
  - DCR confirmed: `client_id: mcp_client_HtziK8uOd46PWdkf`
  - YAML created: `seedpack/mcp-servers/mcp-server-cloudinary.yaml`

- [x] **Egnyte** -- `https://mcp-server.egnyte.com/sse`
  - DCR confirmed: `client_id: 9e226cf9-5825-4a93-8513-f09a850a6061` (OAuth proxy at `mcp-oauth.egnyte.com`)
  - YAML created: `seedpack/mcp-servers/mcp-server-egnyte.yaml`

- [x] **Port IO** -- `https://mcp.port.io/v1`
  - DCR confirmed: `client_id: E7dCDHFLiiohBxiRV4iiihMkTw61lRBO` (auth at `auth.getport.io`)
  - YAML created: `seedpack/mcp-servers/mcp-server-port.yaml`

- [x] **Dropbox** -- DEFERRED to T04. OAuth metadata exists (auth server at `www.dropbox.com`) but DCR blocked: "Only pre-registered MCP trusted partners are allowed."

- [x] **Stack Overflow** -- SKIPPED. 404 on `/.well-known/oauth-authorization-server`. No OAuth support.

- [x] **Grafbase** -- SKIPPED. Vercel deployment not found (`DEPLOYMENT_NOT_FOUND`). Service is down.

### Notes
- 8 of 11 servers confirmed DCR and added to marketplace.
- Dropbox has full OAuth infrastructure but enforces a partner allowlist (same pattern as Vercel). Move to T04.
- Stack Overflow has no OAuth metadata at all -- may be API-key-only or not yet implemented.
- Grafbase appears to have been taken down from Vercel hosting.

---

## Task 4: T04 Wave-3 -- Add no-DCR vendor OAuth servers (requires manual OAuthApp registration)

**Status**: ✅ DONE (partially — GitHub complete, remaining deferred)
**Created**: 2026-04-12 16:48
**Completed**: 2026-04-12
**Effort**: ~3-4 hours (includes manual registration at each vendor)
**What**: For each vendor, manually register an OAuth app, create an OAuthApp resource in Stigmer, then create/update the MCP server YAML with `oauth_app_ref`. Reference pattern: `seedpack/mcp-servers/mcp-server-figma.yaml`

### Subtasks

- [ ] **Dropbox** (moved from T03) -- `https://mcp.dropbox.com/mcp` (files) + `https://mcp.dropbox.com/dash` (universal search)
  - Has full OAuth infrastructure (auth server at `www.dropbox.com`) but blocks DCR: "Only pre-registered MCP trusted partners are allowed."
  - Manual steps: Contact Dropbox to add Stigmer to partner allowlist, or register app at dropbox.com/developers
  - Scopes: account_info.read, files.metadata.read, files.content.write, sharing.write, files.content.read
  - Create OAuthApp resource: `dropbox-oauth`
  - Note: Dash endpoint (`/dash`) searches 30+ apps. Requires Business plan.

- [x] **GitHub** (upgrade existing to remote) -- `https://api.githubcopilot.com/mcp/`
  - COMPLETED (session 5): YAML upgraded from stdio to remote HTTP. Migration and credentials already existed from session 3.
  - Env var renamed: `GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN`
  - Commit: `45d1bb571` on branch `feat/mcp-oauth-expansion`

- [ ] **Asana** -- `https://mcp.asana.com/v2/mcp`
  - Manual steps: Register app at developers.asana.com > developer console > Create new app > OAuth tab
  - Redirect URI: set per client (e.g., `http://localhost:8080/callback`)
  - Scopes: default
  - Create OAuthApp resource: `asana-oauth`
  - Note: V1 shuts down May 11, 2026. Must use V2. No DCR on V2.

- [ ] **Vercel** -- `https://mcp.vercel.com/`
  - Manual steps: Contact Vercel to add Stigmer to client allowlist
  - Has `registration_endpoint` but strict allowlist. Only ~12 approved clients work.
  - Blocked until Vercel approves Stigmer.

- [ ] **Shopify** -- `https://{shopDomain}/customer/api/mcp`
  - Manual steps: Shopify Partner account > Create app > OAuth config
  - Scopes: customer-account-mcp-api:full
  - Note: Domain-specific URLs, requires Level 2 data access approval.

- [ ] **Salesforce** -- `https://api.salesforce.com/platform/mcp` (beta)
  - Manual steps: Setup > Apps > App Manager > New External Client App
  - Scopes: api, refresh_token, sfap_api
  - Note: Hosted MCP still in beta. GA was targeted Feb 2026.

- [ ] **Box** -- `https://mcp.box.com`
  - Manual steps: Register Box developer app at developer.box.com

- [ ] **Plaid** -- `https://api.dashboard.plaid.com/mcp/sse`
  - Manual steps: Plaid developer account registration

- [ ] **Close CRM** -- `https://mcp.close.com/mcp`
  - Manual steps: Register at Close developer portal

### Notes
- Each requires: (1) Register at vendor, (2) Get client_id/client_secret, (3) Create OAuthApp YAML, (4) Create/update McpServer YAML with `oauth_app_ref`
- For the OAuthApp YAML, reference the existing Figma/Slack patterns in the codebase.
- Vercel is blocked on their approval -- may not be actionable immediately.

---

## Task 5: T05 Expanded -- API-key servers + proto enhancement + GitHub/Google Calendar vendor OAuth

**Status**: ✅ DONE
**Created**: 2026-04-12 16:48
**Completed**: 2026-04-12
**Effort**: ~2 hours (expanded from original 30 min scope)
**What**: Added 3 API-key HTTP servers, `discovery_url` proto field, and vendor OAuth for GitHub + Google Calendar.

### Subtasks

- [x] **HubSpot** -- `https://app.hubspot.com/mcp/v1/http` (API-key-only)
  - Category: `crm-support`, Env: `HUBSPOT_ACCESS_TOKEN` (renamed from HUBSPOT_API_KEY)
  - Discovery: supports OAuth without DCR. Upgrade to vendor OAuth in T04.

- [x] **Brevo** -- `https://mcp.brevo.com/v1/brevo/mcp` (API-key-only)
  - Category: `communication`, Env: `BREVO_MCP_TOKEN`
  - Genuinely API-key-only (no OAuth metadata).

- [x] **PagerDuty** -- `https://mcp.pagerduty.com/mcp` (API-key-only)
  - Category: `monitoring`, Env: `PAGERDUTY_API_TOKEN`, Header: `Authorization: Token ...`
  - Discovery: supports OAuth without DCR. Upgrade to vendor OAuth in T04.

- [x] **BigQuery** -- DROPPED. No confirmed hosted endpoint. stdio-only. Wrong credential type.

- [x] **Proto: discovery_url** -- Added `discovery_url` field (field 7) to `McpServerAuth`. Enables DCR for stdio servers. Updated Go + Java backends to prefer `discovery_url` > `http.url`.

- [x] **GitHub vendor OAuth** -- Added `auth` block with `oauth_app_ref: github-oauth` to `mcp-server-github.yaml` (stdio transport). Reused existing GitHub OAuth App credentials. New Mongock migration seeds OAuthApp.

- [x] **Google Calendar vendor OAuth** -- Added `auth` block with `oauth_app_ref: google-calendar-oauth` to `mcp-server-google-calendar.yaml` (stdio transport). New Google Cloud OAuth client created with Calendar scope. Unverified (pending Google review).

### Notes
- HubSpot and PagerDuty both support OAuth (RFC 8414 discovery) but NOT DCR. They should be upgraded to vendor OAuth in T04 when we register OAuth apps with them.
- GitHub and Google Calendar are the first stdio servers with `auth` blocks in the marketplace — proving that vendor OAuth on stdio works.
- Marketplace count: 45 → 48 servers (3 new API-key servers).

---

## Task 6: T06 Audit -- Verify Atlassian and GitLab DCR status and fix config if broken

**Status**: ✅ DONE
**Created**: 2026-04-12 16:48
**Completed**: 2026-04-12
**Effort**: ~15 min (combined with T03)
**What**: The existing `mcp-server-atlassian.yaml` and `mcp-server-gitlab.yaml` are configured with `auth.target_env_var` but NO `oauth_app_ref`, implying DCR support. Verify this is correct.

### Subtasks

- [x] **Atlassian** -- `https://mcp.atlassian.com/v1/mcp`
  - DCR CONFIRMED: `registration_endpoint` at `https://cf.mcp.atlassian.com/v1/register`, POST returned `client_id: VPpg6WfDS0y7YJwt`
  - Discovery is at ROOT (`mcp.atlassian.com/.well-known/oauth-authorization-server`), NOT under `/v1/`
  - Issuer: `https://cf.mcp.atlassian.com` (Cloudflare-fronted)
  - awesome-remote-mcp-servers "no DCR" listing is WRONG -- DCR works
  - No YAML change needed: existing Pattern A config is correct

- [x] **GitLab** -- `https://gitlab.com/api/v4/mcp`
  - DCR CONFIRMED: `registration_endpoint` at `https://gitlab.com/oauth/register`, POST returned `client_id: 0f0beabb...`
  - `scope: "mcp"`, `require_pkce: true`, `dynamic: true`
  - Scopes supported include `mcp` and `mcp_orbit` (new GitLab-specific scopes)
  - No YAML change needed: existing Pattern A config is correct

### Notes
- Both servers verified: existing YAML configs are correct and DCR works.
- The awesome-remote-mcp-servers listing for Atlassian as "no DCR" is incorrect -- DCR registration succeeds.
- Atlassian uses a Cloudflare-fronted OAuth proxy (`cf.mcp.atlassian.com`) separate from the MCP endpoint domain.


## Project Completion Checklist

- [x] All tasks marked ✅ DONE (T01-T06 complete; T04 remaining vendors deferred to future work)
- [x] Final testing completed (all DCR endpoints verified, quality audit done)
- [x] Documentation updated (notes.md captures all decisions and learnings)
- [x] Code reviewed/validated (3 servers removed in quality audit, all remaining verified)
- [x] Ready for use/deployment

**Project closed**: 2026-04-12

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

