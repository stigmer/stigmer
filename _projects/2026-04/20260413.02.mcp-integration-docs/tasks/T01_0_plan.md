# Task T01: Concepts Expansion and Navigation Setup

**Created**: 2026-04-13
**Status**: PENDING REVIEW
**Estimated effort**: 1 session

## Objective

Expand the existing `concepts/tools.mdx` to cover the full MCP integration ecosystem and create the `guides/integrations/` navigation structure in the docs sidebar.

## Background

The current `concepts/tools.mdx` was written before the marketplace, connect flow, OAuth, and BYOA work. It covers MCP protocol basics and YAML shape but says nothing about the curated marketplace, the one-click Connect model, authentication patterns, sandbox isolation, or environment declarations. The docs sidebar has no `guides/integrations/` section.

This task lays the groundwork: expanding the concept page so readers understand the full picture, and wiring the navigation so subsequent tasks can drop guide pages into the right place.

## Deliverables

### 1. Expand `docs/concepts/tools.mdx`

Add the following sections to the existing page (Diataxis type: Explanation):

- **The Tool Library** — what the marketplace is, how servers are curated (~53 servers), categories and tags, transports (stdio via npx/uvx/go, HTTP remote)
- **Connecting a tool** — the Connect model (single action replaces discover + generate policies), auto-classified approvals, two-tier system (pinned vs auto), connect states
- **Authentication for tools** — high-level overview of three patterns (no auth, DCR auto-discovery, vendor OAuth app), what happens behind the scenes (env vars, managed credentials), link forward to the dedicated guide (not yet written)
- **Sandbox isolation** — stdio runs in Daytona sandbox (not on the agent-runner pod), why this matters for security
- **Environment declarations** — required vs optional env vars, how credentials layer (OAuth managed env + personal env + runtime env)

Keep the existing content (MCP protocol, YAML examples, transports table). The new sections expand the page; they don't replace what's there.

### 2. Create `guides/integrations/` navigation

Files to create:
- `docs/guides/integrations/meta.json` with page ordering
- `docs/guides/integrations/overview.mdx` — a minimal placeholder hub page (full content is T02)

Update:
- `docs/guides/meta.json` — add `integrations` before `federation`
- `docs/getting-started/meta.json` — confirm `connect-tools` is present (it is)

### 3. Update the Information Architecture document

Update `_projects/2026-03/20260331.01.content-strategy/design-decisions/information-architecture.md`:
- Add `guides/integrations/` to the docs navigation tree (Section 3)
- Add the 5 integration guide pages to the site map (Section 1)
- Move the guides/integrations concept from "future expansion" to current scope

## Source Material

- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` (current spec shape)
- Connect flow: project `20260408.02.mcp-connect-flow`
- Marketplace: project `20260410.01.curated-mcp-marketplace`
- OAuth: project `20260410.03.mcp-oauth-connect`
- Sandbox: project `20260409.01.mcp-server-sandbox-security`
- Env declarations: project `20260411.02.mcp-connect-retry-and-env-declaration`
- Document writer role: `_roles/002_document_writer.md`

## Verification

- `yarn build` passes in `site/`
- The new `guides/integrations/` section appears in the sidebar
- `concepts/tools.mdx` renders with the new sections
- No broken links

## Notes

- Keep the tools.mdx page as Explanation type — no step-by-step instructions. Those belong in the guides (T02-T04) and tutorials (T06).
- The overview.mdx placeholder should have real framing text (what this section covers, who it's for) but can link to pages that don't exist yet — Fumadocs handles dead links gracefully during development.
- Follow the document writer role's register rules: concepts pages use the bridge register (accessible explanations, introduce proper terms).

---

## Full Project Task Map

| Task | Title | Scope | Est. effort |
|------|-------|-------|-------------|
| **T01** | Concepts expansion + nav setup | Expand `concepts/tools.mdx`, create `guides/integrations/` nav, update IA doc | 1 session |
| **T02** | Marketplace and connect guides | Write `overview.mdx` and `connect-from-marketplace.mdx`, build `marketplace-browse` + `credential-management` demos | 1-2 sessions |
| **T03** | OAuth for tools guide | Write `oauth-for-tools.mdx`, build `oauth-connect-flow` demo (hero demo with BrowserView popup) | 1-2 sessions |
| **T04** | BYOA guide | Write `bring-your-own-oauth.mdx`, build `byoa-setup` demo | 1 session |
| **T05** | Architecture transparency | Write `oauth-architecture.mdx` with mermaid diagrams (honest current-state + roadmap, Slack-reviewable) | 1 session |
| **T06** | Tutorial completion | Refresh `connect-tools.mdx`, build `give-your-agent-tools.mdx` + `connect-your-systems.mdx`, update existing demos | 2 sessions |
| **T07** | SDK reference polish | Create `overview.md` for mcpserver and oauthapp API resources, review proto RPC comments | 1 session |
