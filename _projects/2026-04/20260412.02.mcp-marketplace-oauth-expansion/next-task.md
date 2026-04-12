# Next Task: 20260412.02.mcp-marketplace-oauth-expansion

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260412.02.mcp-marketplace-oauth-expansion  
**Description**: Add new MCP server integrations with verified OAuth/DCR support to the Stigmer marketplace, organized by wave priority. Each wave is a category that can be picked up independently.  
**Goal**: Expand the Stigmer MCP marketplace from 36 to 50+ servers by adding verified remote OAuth integrations one category at a time, with proper DCR verification and manual OAuthApp setup where needed.  
**Tech Stack**: YAML seedpack, Proto (reference)  
**Components**: seedpack/mcp-servers/, apis/ai/stigmer/agentic/mcpserver/v1/spec.proto

**Created**: 2026-04-12  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260412.02.mcp-marketplace-oauth-expansion/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-04-12  
**Status**: In Progress (T01+T02+T03+T05+T06 complete, T04 partially done)  
**Current Focus**: T04 — GitHub subtask complete, remaining vendors need manual registration  
**Last Session**: Session 5 (2026-04-12) — GitHub stdio→HTTP upgrade, vendor assessment

## Session Progress (2026-04-12, session 2)

- Completed T02 Wave-1b: upgraded Stripe and Cloudflare from stdio to remote HTTP with DCR-verified OAuth
- Both endpoints live-verified before YAML changes: OAuth metadata, DCR registration (got client_ids), and MCP endpoint connectivity
- Stripe: `https://mcp.stripe.com/` (Streamable HTTP, issuer at `access.stripe.com/mcp`)
- Cloudflare: `https://mcp.cloudflare.com/mcp` (returns 401 with proper WWW-Authenticate, resource_name: "Cloudflare API MCP Server")

### Key Decisions Made (T02)
- Single env var pattern: `STRIPE_ACCESS_TOKEN` replaces `STRIPE_SECRET_KEY`, `CLOUDFLARE_ACCESS_TOKEN` replaces `CLOUDFLARE_API_TOKEN` — no dead env var declarations
- Dropped `CLOUDFLARE_ACCOUNT_ID`: the new remote endpoint handles account context via OAuth
- Cloudflare `repository_url` updated from `cloudflare/mcp-server-cloudflare` to `cloudflare/mcp` (new first-party repo)

### Previous Session (2026-04-12, session 1)
- Completed T01 Wave-1a: added 9 DCR-verified MCP servers (PayPal, Square, Intercom, Attio, monday.com, Contentful, Buildkite, Webflow, Datadog)
- Marketplace expanded from 36 to 45 servers
- Committed: `bc4c754c0` on branch `feat/mcp-oauth-expansion`

## Session Progress (2026-04-12, session 3)

- Completed T05 (expanded scope): 3 API-key servers + proto `discovery_url` + GitHub/Google Calendar vendor OAuth
- BigQuery dropped: no confirmed hosted endpoint, wrong credential type
- Surprise: HubSpot and PagerDuty both support OAuth (without DCR) — added as API-key-only, flagged for T04 upgrade
- First stdio servers with `auth` blocks: GitHub + Google Calendar prove vendor OAuth on stdio works
- Proto enhanced: `discovery_url` field enables DCR on stdio servers (future use)
- Marketplace count: 45 → 48 servers

## Session Progress (2026-04-12, session 4)

- Completed T06 + T03 combined: verified DCR for 13 servers, added 8 new DCR-confirmed servers
- T06 audit: Atlassian and GitLab both confirmed DCR working. awesome-remote-mcp-servers "no DCR" listing for Atlassian is wrong.
- T03 results: 8 of 11 servers confirmed DCR (Wix, Canva, Netlify, Ramp, Prisma, Cloudinary, Egnyte, Port IO)
- 3 servers deferred/skipped: Dropbox (allowlist, moved to T04), Stack Overflow (no OAuth), Grafbase (service down)
- Marketplace count: 48 → 56 servers

## Session Progress (2026-04-12, session 4 continued -- quality audit)

- Post-DCR quality audit revealed 3 servers to remove and 9 missing repo URLs
- **Removed**: Port IO (archived repo Feb 2026), Egnyte (stale repo, uncertain remote relationship), Ramp (no npm package, remote endpoint undocumented)
- **Fixed**: Cloudinary repo URL + endpoint path, Wix repo URL + endpoint path
- **Added repos for 7 servers**: PayPal (`paypal/paypal-mcp-server`), Square (`square/square-mcp-server`, 95 stars), Intercom (`intercom/intercom-mcp-server`), monday.com (`mondaycom/mcp`, 387 stars), Buildkite (`buildkite/buildkite-mcp-server`, 49 stars), Webflow (`webflow/mcp-server`, 113 stars), PagerDuty (`PagerDuty/pagerduty-mcp-server`, 58 stars)
- Final marketplace count: 53 servers (56 - 3 removed)
- Audit result: zero high-risk servers remaining; all are first-party vendor with public repo or official docs

## Session Progress (2026-04-12, session 5)

- Completed GitHub upgrade: stdio → remote HTTP at `api.githubcopilot.com/mcp/`
- Env var renamed `GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN` to match OAuth convention
- No migration or credential changes needed — already existed from session 3
- Assessed all remaining T04 vendors for registration difficulty
- Confirmed: **No official Google Calendar remote MCP endpoint exists** (Google briefly shipped and removed Workspace MCP in Mar 2026). Community server (`nspady/google-calendar-mcp`) remains the only option; already has auth block from session 3.
- Commit: `45d1bb571` on branch `feat/mcp-oauth-expansion`

### Vendor Assessment (T04 remaining)
- **Immediately actionable**: Asana (easy), Box (easy), Close CRM (easy)
- **Medium difficulty**: Plaid (business verification), Salesforce YAML (migration+creds exist, just needs YAML)
- **Blocked on vendor**: Dropbox (partner allowlist), Vercel (client allowlist), Shopify (Level 2 data access)

## Next Steps
1. **Salesforce YAML** (~5 min): Migration and credentials already exist. Just create `mcp-server-salesforce.yaml`.
2. **Asana** (~20 min): Register OAuth app at developers.asana.com (easy, no approval gate). V1 shuts down May 11, 2026.
3. **Box** (~20 min): Register at developer.box.com (straightforward).
4. **Close CRM** (~20 min): Register at Close developer portal.
5. **HubSpot/PagerDuty upgrade**: Register OAuth apps, upgrade from API-key to vendor OAuth.
6. **Blocked vendors** (Dropbox, Vercel, Shopify): Contact vendors for partner/allowlist approval.

## Context for Resume
- Branch: `feat/mcp-oauth-expansion`
- Changes span both repos: stigmer (OSS) and stigmer-cloud
- GitHub OAuth redirect URI: verify `https://app.stigmer.ai/auth/oauth/callback` is configured at github.com/settings/developers
- Google Calendar: unverified — submit for Google verification when ready. No remote endpoint exists; stays on stdio.
- Dropbox: needs partner registration before OAuth will work
- Vercel: needs client allowlist approval before OAuth will work
- 10 servers remain without `repository_url` (Attio, Canva, Datadog, Brevo, HubSpot, Prisma, Linear, Slack, Google Maps, Stigmer) — all verified official vendor-hosted with docs

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

