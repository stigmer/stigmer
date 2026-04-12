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

**Status**: ⏸️ TODO
**Created**: 2026-04-12 16:48
**Effort**: ~2 hours (verification + YAML)
**What**: For each server, fetch `/.well-known/oauth-authorization-server`, confirm `registration_endpoint`, POST to it, and confirm a `client_id` is returned. Only then create the YAML.

### Subtasks

- [ ] **Dropbox** -- `https://mcp.dropbox.com/mcp` (files) + `https://mcp.dropbox.com/dash` (universal search)
  - Got 429 last time. Retry metadata fetch.
  - Category: `productivity`, Tags: dropbox, file-management, cloud-storage
  - Note: Dash searches 30+ apps (Slack, Google Drive, Jira, etc). Requires Business plan.

- [ ] **Wix** -- `https://mcp.wix.com/sse`
  - Category: `developer-tools`, Tags: wix, website-builder, cms

- [ ] **Canva** -- `https://mcp.canva.com/mcp`
  - Fetch timed out last time. Retry.
  - Category: `design`, Tags: canva, design, graphics

- [ ] **Netlify** -- `https://netlify-mcp.netlify.app/mcp`
  - Category: `developer-tools`, Tags: netlify, deployment, hosting, jamstack

- [ ] **Ramp** -- `https://ramp-mcp-remote.ramp.com/mcp`
  - Category: `payments`, Tags: ramp, expense-management, corporate-finance

- [ ] **Prisma Postgres** -- `https://mcp.prisma.io/mcp`
  - Category: `databases`, Tags: prisma, postgresql, orm, database

- [ ] **Stack Overflow** -- `https://mcp.stackoverflow.com`
  - Category: `developer-tools`, Tags: stackoverflow, knowledge-base, q-and-a

- [ ] **Cloudinary** -- `https://asset-management.mcp.cloudinary.com/sse`
  - Category: `developer-tools`, Tags: cloudinary, asset-management, image-optimization

- [ ] **Egnyte** -- `https://mcp-server.egnyte.com/sse`
  - Category: `productivity`, Tags: egnyte, file-management, enterprise-storage

- [ ] **Grafbase** -- `https://api.grafbase.com/mcp`
  - Category: `developer-tools`, Tags: grafbase, graphql, api-platform

- [ ] **Port IO** -- `https://mcp.port.io/v1`
  - Category: `developer-tools`, Tags: port, developer-portal, internal-tools

### Verification Steps (for each)
1. `curl -s https://<url>/.well-known/oauth-authorization-server | jq .registration_endpoint`
2. If `registration_endpoint` exists, POST to it with test client metadata
3. If `client_id` returned, DCR works -- create YAML
4. If fails, move to Wave 3 (needs OAuthApp)

### Notes
- Some of these may turn out to not support DCR despite being listed as OAuth 2.1.

---

## Task 4: T04 Wave-3 -- Add no-DCR vendor OAuth servers (requires manual OAuthApp registration)

**Status**: ⏸️ TODO
**Created**: 2026-04-12 16:48
**Effort**: ~3-4 hours (includes manual registration at each vendor)
**What**: For each vendor, manually register an OAuth app, create an OAuthApp resource in Stigmer, then create/update the MCP server YAML with `oauth_app_ref`. Reference pattern: `seedpack/mcp-servers/mcp-server-figma.yaml`

### Subtasks

- [ ] **GitHub** (upgrade existing to remote) -- `https://api.githubcopilot.com/mcp/`
  - Manual steps: Register GitHub App or OAuth App at github.com/settings/developers
  - Scopes: repo, read:org, read:user, user:email, read:packages, write:packages, read:project
  - Create OAuthApp resource: `github-oauth` (org: stigmer, kind: oauth_app)
  - Update `mcp-server-github.yaml`: change stdio to http, add `oauth_app_ref`
  - Note: GitHub explicitly says "DCR is NOT supported". Needs pre-registered app.

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

## Task 5: T05 Wave-4 -- Add API-key-only remote servers (YAML with env vars, no OAuth)

**Status**: ⏸️ TODO
**Created**: 2026-04-12 16:48
**Effort**: ~30 min
**What**: Simple HTTP servers that use API key auth only. No `auth:` block needed. Just `http.url` + `http.headers` + `env`.

### Subtasks

- [ ] **HubSpot** -- `https://app.hubspot.com/mcp/v1/http`
  - Category: `crm-support`, Tags: hubspot, crm, marketing, sales
  - Env: `HUBSPOT_API_KEY` (is_secret: true)
  - Header: `Authorization: Bearer ${HUBSPOT_API_KEY}`

- [ ] **Google BigQuery** -- `https://bigquery.googleapis.com/mcp`
  - Category: `databases`, Tags: google, bigquery, data-warehouse, analytics
  - Env: `GOOGLE_API_KEY` (is_secret: true)

- [ ] **Brevo** -- `https://mcp.brevo.com/v1/brevo/mcp`
  - Category: `communication`, Tags: brevo, email, marketing, crm
  - Env: `BREVO_MCP_TOKEN` (is_secret: true)
  - Header: `Authorization: Bearer ${BREVO_MCP_TOKEN}`
  - Note: 27 modules. Also has per-module endpoints (contacts, deals, campaigns, etc).

- [ ] **PagerDuty** -- `https://mcp.pagerduty.com/mcp`
  - Category: `monitoring`, Tags: pagerduty, incident-management, on-call, alerting
  - Env: `PAGERDUTY_API_TOKEN` (is_secret: true)
  - Header: `Authorization: Token ${PAGERDUTY_API_TOKEN}`
  - Note: EU endpoint at `mcp.eu.pagerduty.com/mcp`. Read-only by default.

### Notes
- No `auth:` block for these -- users must get their own API keys.
- These could gain OAuth support later; easy to add `auth:` block when vendors support it.

---

## Task 6: T06 Audit -- Verify Atlassian and GitLab DCR status and fix config if broken

**Status**: ⏸️ TODO
**Created**: 2026-04-12 16:48
**Effort**: ~30 min
**What**: The existing `mcp-server-atlassian.yaml` and `mcp-server-gitlab.yaml` are configured with `auth.target_env_var` but NO `oauth_app_ref`, implying DCR support. Verify this is correct.

### Subtasks

- [ ] **Atlassian** -- `https://mcp.atlassian.com/v1/sse`
  - Current config: `auth.target_env_var: ATLASSIAN_ACCESS_TOKEN` (no oauth_app_ref)
  - Concern: awesome-remote-mcp-servers lists as "OAuth2.1 (no DCR)" 
  - Verify: `curl -s https://mcp.atlassian.com/v1/.well-known/oauth-authorization-server | jq .registration_endpoint`
  - If no DCR: Need to register Atlassian OAuth app at developer.atlassian.com and add `oauth_app_ref`

- [ ] **GitLab** -- `https://gitlab.com/api/v4/mcp`
  - Current config: `auth.target_env_var: GITLAB_ACCESS_TOKEN` (no oauth_app_ref)
  - Verify: `curl -s https://gitlab.com/.well-known/oauth-authorization-server | jq .registration_endpoint`
  - GitLab Premium/Ultimate required for MCP access

### Notes
- If DCR doesn't work, these existing configs may be silently broken (users fall back to manual API key entry).
- Fix would follow the Figma/Slack pattern: create OAuthApp resource + add `oauth_app_ref`.


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

