# Next Task: 20260413.02.mcp-integration-docs

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260413.02.mcp-integration-docs

**Description**: Documentation content strategy and implementation for the MCP integration ecosystem — marketplace, connect flow, OAuth patterns, BYOA, and architecture transparency — across the Stigmer docs site.
**Goal**: Create compelling, demo-rich documentation that shows platform builders how to integrate tools onto Stigmer, and provides transparent architecture documentation for external reviewers (e.g., Slack marketplace).
**Tech Stack**: Next.js/Fumadocs, MDX, TypeScript/React (demos), @stigmer/react SDK components
**Components**: docs/ (MDX content), site/src/components/docs/demos/ (demo scenarios), apis/ (proto overview.md files)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260413.02.mcp-integration-docs/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-13
**Current Task**: T07 — SDK reference polish
**Status**: T07 COMPLETE
**Last Session**: 2026-04-13 — T07 SDK reference polish

## Session Progress (2026-04-13, session 9 — T07)

- **Completed `DOMAIN_META`**: Added 5 missing entries to the hand-maintained
  map in `site/scripts/generate-react-sdk-docs/parser.ts` for `oauth-app`,
  `iam-policy`, `identity-provider`, `invitation`, and `usage`. These domains
  were rendering with slug-case titles and empty descriptions. Regenerated all
  React SDK docs — MDX files, `meta.json`, and `react-sdk-summary.json` now
  show proper titles and descriptions for all 22 domains.
- **Created OAuthApp `overview.md`**: New file at
  `apis/ai/stigmer/iam/oauthapp/docs/overview.md` with 3-sentence description
  and representative Slack YAML example. Regenerated resource docs — the
  generated `o-auth-app.mdx` now opens with the proper overview instead of a
  generic fallback.
- **Refreshed McpServer `overview.md`**: Added one sentence acknowledging the
  `auth` block and OAuthApp reference. Kept existing stdio YAML (one
  representative example per convention).
- **Proto comment review**: Reviewed all RPC, message, and field comments across
  `mcpserver/v1/*.proto` and `oauthapp/v1/*.proto`. All comments follow the
  `@internal` separation convention correctly. Zero changes needed.
- Build verified: `make gen-react-sdk-docs`, `make gen-proto-sdk-docs`, and
  `yarn build` all pass.

### Files created

| File | Purpose |
|------|---------|
| `apis/ai/stigmer/iam/oauthapp/docs/overview.md` | OAuthApp resource overview |

### Files modified

| File | Change |
|------|--------|
| `site/scripts/generate-react-sdk-docs/parser.ts` | 5 new `DOMAIN_META` entries |
| `apis/ai/stigmer/agentic/mcpserver/docs/overview.md` | Added sentence about `auth` block |
| `docs/sdk/react/*.mdx` (5 files) | Regenerated with proper titles/descriptions |
| `docs/sdk/react/meta.json` | Regenerated |
| `site/src/data/react-sdk-summary.json` | Regenerated with proper titles/descriptions |
| `docs/sdk/resources/o-auth-app.mdx` | Regenerated with new overview |

### Key decisions

- **Option A for McpServer overview**: Added one sentence mentioning OAuth auth
  rather than replacing the YAML example with an HTTP+OAuth variant. The overview
  convention calls for one representative YAML; the OAuth story is covered in
  depth by the T03-T05 how-to guides.
- **No proto comment changes**: All comments reviewed and found clean. The OAuth
  feature work was done with the SDK docs conventions already in mind.

### Out-of-scope finding

- **"O Auth App" display name**: The proto SDK docs generator derives display
  names from proto type names by splitting on camelCase boundaries, producing
  "O Auth App" instead of "OAuth App". This is a codegen logic issue in
  `sdk_docs.go`, not a documentation content task. Noted for future work.

## Session Progress (2026-04-13, session 8 — T06)

- **Rescoped T06**: Original plan called for "build 2 tutorial pages." After
  Diataxis analysis, determined new tutorial pages would overlap with the
  existing how-to guides (T02–T04). Rescoped to refresh + bridge + demo audit.
- **Refreshed `connect-tools.mdx`**: Added marketplace awareness callout after
  "The problem" section. Added "Going deeper" cards at end linking to
  marketplace guide, OAuth guide, and Tools concept page.
- **Cross-link bridge**: Added "Tool Integrations" card to `create-agent.mdx`
  "What's next" section. Added tutorial backlink to `integrations/overview.mdx`
  prerequisites. Bidirectional bridge: tutorials point to guides, guides point
  back to tutorials.
- **Demo audit**: Found `mcp-server-creation-tour` and `agent-creation-tour`
  showing library list views without `layout="grid"`, inconsistent with the
  production card grid layout. Added `layout="grid"` to all 6 `ResourceListPage`
  calls. Verified `connect-tools-tour`, `connect-playback` proto fixtures match
  current shapes. Confirmed `skill-creation-tour` correctly stays as list layout.
- Build verified: `yarn build` passes

### Files modified

| File | Change |
|------|--------|
| `docs/getting-started/connect-tools.mdx` | Marketplace callout + "Going deeper" cards |
| `docs/getting-started/create-agent.mdx` | Tool Integrations card in "What's next" |
| `docs/guides/integrations/overview.mdx` | Tutorial backlink in prerequisites |
| `site/.../mcp-server-creation-tour/index.tsx` | `layout="grid"` on 3 ResourceListPage calls |
| `site/.../agent-creation-tour/index.tsx` | `layout="grid"` on 3 ResourceListPage calls |

### Key decisions

- **No new tutorial pages**: Diataxis analysis showed the getting-started
  sequence is already complete. How-to guides (T02–T05) cover specific tasks.
  New tutorials would create overlap and maintenance burden.
- **Custom creation stays as primary tutorial path**: Teaches deeper
  fundamentals. Marketplace is acknowledged via callout, not the main flow.
- **Grid layout for Agents too**: Agent list pages also use card grid in
  production (per changelog). Updated agent-creation-tour alongside
  mcp-server-creation-tour for consistency.

## Session Progress (2026-04-13, session 7 — T05 closure amendment)

- Updated `docs/guides/integrations/bring-your-own-oauth.mdx` with a new
  "Manage OAuth apps from Settings" section between "Remove a custom app"
  and "What's next"
- Acknowledges the OAuth App CRUD settings page
  (`_changelog/2026-04/2026-04-13-195337-oauth-app-crud-settings.md`) as a
  second entry point for creating org-level OAuth apps
- Explains the distinction: BYOA dialog clones from a platform template and
  binds to a server; Settings page gives the full form for custom servers
- No demo added — standard settings CRUD does not warrant a ScenarioPlayer
- No other pages changed — T03, T05, overview, and concepts are accurate as-is

### Deferred: Custom integration OAuth guide

The CRUD change primarily serves platform builders with custom MCP servers who
need OAuth apps without a platform template. Fully documenting this journey
(create OAuth app → write custom MCP server definition with `auth.oauth_app_ref`
→ connect) requires content about custom MCP server definitions that doesn't
exist yet. Recommended as a future task (T08 or new project) when the "MCP
server authors" audience becomes a priority.

### Files modified

| File | Change |
|------|--------|
| `docs/guides/integrations/bring-your-own-oauth.mdx` | Added "Manage OAuth apps from Settings" section |

## Session Progress (2026-04-13, session 3 — T02)

- Created `docs/guides/integrations/connect-from-marketplace.mdx` — how-to
  guide with hero demo, browse section, connect section, auth patterns table,
  wire-to-agent YAML, and cross-links to T03/T04 guides
- Built `marketplace-connect-tour` demo scenario (6-step playback):
  grid browse → select PostgreSQL → detail view → connect → tools → policies
- Fixture data drawn from real seedpack entries (9 servers: GitHub, Slack,
  PostgreSQL, Playwright, Fetch, Sentry, Stripe, Figma, Notion)
- Full McpServer fixture for PostgreSQL with stdio transport, env vars,
  5 discovered tools, and `execute_sql` approval policy
- Extended `ResourceListPage` view with optional `layout` prop to support
  grid layout (production-consistent card grid)
- Fixed MDX comment syntax in `overview.mdx` (`<!-- -->` → `{/* */}`)
- Registered demo in `index.ts`, `mdx.tsx`, and `registry.ts`
- Build verified: `yarn build` passes

### Files created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/connect-from-marketplace.mdx` | How-to guide page |
| `site/src/components/docs/demos/scenarios/marketplace-connect-tour/index.tsx` | Demo component |
| `site/src/components/docs/demos/scenarios/marketplace-connect-tour/steps.ts` | Fixtures + step data |
| `_projects/2026-04/20260413.02.mcp-integration-docs/tasks/T02_0_plan.md` | Task plan file |

### Files modified

| File | Change |
|------|--------|
| `site/src/components/docs/demos/views/ResourceListPage.tsx` | Added `layout` prop |
| `site/src/components/docs/index.ts` | Export `DemoMarketplaceConnectTour` |
| `site/src/components/mdx.tsx` | Register in MDX component map |
| `site/src/components/docs/demos/scenarios/registry.ts` | Register for video export |
| `docs/guides/integrations/overview.mdx` | Fix HTML comments to MDX comments |

## Session Progress (2026-04-13, session 2 — side-track)

Side-track from the docs project to address UX gaps found during BYOA testing:

- **BYOA dialog fix**: Added `m-auto` to the native `<dialog>` in
  `McpServerDetailView.tsx` — Tailwind v4 preflight strips `margin: auto`,
  causing the dialog to render in the top-left corner instead of centered
- **OAuth Apps settings page**: New `@stigmer/react` module (`oauth-app/`)
  with `useOAuthAppList` data hook and `OAuthAppListPanel` styled component.
  New Console route at `/settings/oauth-apps` under Configuration group.
  Read-only list of org-level BYOA OAuth apps.
- No backend changes required — used existing IAM `OAuthApp.listByOrg` API
- Committed: `ad229c983` on `feat/mcp-integration-docs`
- Changelog: `_changelog/2026-04/2026-04-13-184626-oauth-apps-settings-page.md`

### Files created/modified in session 2

| File | Change |
|------|--------|
| `sdk/react/src/mcp-server/McpServerDetailView.tsx` | Bug fix: `m-auto` on BYOA `<dialog>` |
| `sdk/react/src/oauth-app/useOAuthAppList.ts` | New data hook |
| `sdk/react/src/oauth-app/OAuthAppListPanel.tsx` | New styled component |
| `sdk/react/src/oauth-app/index.ts` | New module barrel |
| `sdk/react/src/index.ts` | Root barrel re-exports (in parallel commit `92cf04596`) |
| `client-apps/web/src/app/settings/oauth-apps/page.tsx` | New route page |
| `client-apps/web/src/components/settings/OAuthAppsSection.tsx` | New settings section |
| `client-apps/web/src/components/layout/settings-nav.ts` | Nav item + description update |

## Session Progress (2026-04-13, session 1 — T01)

- Expanded `docs/concepts/tools.mdx` (163 -> 257 lines) with 3 new sections
  (tool library, connecting a tool, authentication) and 2 updated sections
  (environment declarations, sandbox isolation)
- Created `docs/guides/integrations/` navigation: `meta.json`, `overview.mdx`
  hub page with Cards
- Updated `docs/guides/meta.json` to add integrations before federation
- Marked IA document as superseded by live `meta.json` files
- Investigated `env_spec` vs `env` YAML discrepancy: confirmed it's the
  established YAML convention, not stale
- Build verified: `yarn build` passes

## Key Decisions

- **BYOA dialog: `m-auto` not global CSS**: Fixed the specific `<dialog>`
  element rather than adding a global CSS rule for all dialogs — scoped fix
  is safer for the SDK component library
- **OAuth Apps page: read-only list, not CRUD**: Creation is inherently
  per-MCP-server (backend clones from template); settings page is a
  visibility surface only. Creation/editing stays on MCP server detail pages.
- **No backend changes**: Used existing `listByOrg` IAM API. A future
  `listOrgOAuthAppOverrides` RPC could add MCP server association context.
- **IA document update dropped**: the live `meta.json` files are the source of
  truth; adding one entry to a stale 778-line planning document creates false
  confidence
- **tools.mdx restructured, not appended**: new sections woven into narrative
  flow (tool library after demo, connect/auth after Agent wiring) rather than
  bolted at the end
- **YAML convention preserved**: `env_spec.data` is the established convention
  across all docs; proto field `env` maps to this in YAML representation

## Key Decisions (T02)

- **One demo, not two**: Combined `marketplace-browse` and `credential-management`
  into a single `marketplace-connect-tour` — the browse and connect steps are
  one user journey; credential management is T03/T04 territory
- **Grid layout for demo**: Uses `layout="grid"` matching the recent production
  change (card grid for MCP Servers and Agents)
- **PostgreSQL as the connect example**: Familiar to developers, simple env-var
  auth (no OAuth complexity), stdio transport — relatable without being trivial
- **Seedpack as public catalog deferred**: Real seedpack data used in fixtures
  for authenticity; a live public catalog page is a separate initiative
- **MDX comment syntax fix**: `overview.mdx` from T01 used HTML comments
  (`<!-- -->`); MDX requires `{/* */}` — fixed during build verification

## Session Progress (2026-04-13, session 4 — T03)

- Created `docs/guides/integrations/oauth-for-tools.mdx` — how-to guide with
  hero demo, OAuth vs API-key contrast, YAML `auth` block example, 5-step
  connect walkthrough, token lifecycle table, manual override path, and
  cross-links to T04/T05
- Built `oauth-connect-flow` demo scenario (5-step playback):
  detail (pre-connect, "Sign in to connect") → cursor clicks sign-in →
  GitHub authorization page (BrowserView) → connected detail with tools →
  policies tab
- GitHub McpServer fixture built from real seedpack entry (vendor OAuth,
  HTTP transport, scope hints, 6 discovered tools, 3 approval policies)
- GitHub authorize page: hand-built JSX inside BrowserView with realistic
  scope list, app name, and authorize/cancel buttons
- Added `fixtures.mcpServer.getOAuthGrantStatus` and
  `fixtures.mcpServer.getOrgOAuthApp` to SDK demo fixtures for OAuth
  state fixturing
- Registered demo in `index.ts`, `mdx.tsx`, and `registry.ts`
- Build verified: `yarn build` passes

### Files created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/oauth-for-tools.mdx` | How-to guide page |
| `site/src/components/docs/demos/scenarios/oauth-connect-flow/index.tsx` | Demo component |
| `site/src/components/docs/demos/scenarios/oauth-connect-flow/steps.ts` | Fixtures + step data |

### Files modified

| File | Change |
|------|--------|
| `sdk/react/src/demo/fixtures.ts` | Added OAuth fixture helpers |
| `site/src/components/docs/index.ts` | Export `DemoOAuthConnectFlow` |
| `site/src/components/mdx.tsx` | Register in MDX component map |
| `site/src/components/docs/demos/scenarios/registry.ts` | Register for video export |

## Session Progress (2026-04-13, session 5 — T04)

- Created `docs/guides/integrations/bring-your-own-oauth.mdx` — how-to guide
  with hero demo, two BYOA scenarios (vendor approval blocked, tighter control),
  step-by-step setup, what-changes section, remove-and-revert with grant
  breakage warning, cross-link to T05 architecture page
- Built `byoa-setup` demo scenario (6-step playback):
  Slack detail (vendor approval pending, sign-in disabled) → cursor clicks
  "Use your own OAuth app" → BYOA dialog overlay with OAuthAppForm → cursor
  clicks Save → detail showing "Using your OAuth app" → connected with tools
- Slack McpServer fixture built from real seedpack entry (vendor OAuth, HTTP
  transport, 4 scope hints, 5 discovered tools, 2 approval policies)
- BYOA dialog overlay: hand-built dialog card within AppShell matching
  production `<dialog>` visual — renders form fields, vendor docs link,
  pre-filled state with cursor target on Save
- Three fixture variants: blocked (PENDING + PLATFORM), org-app (APPROVED +
  ORG_OVERRIDE), connected (APPROVED + ORG_OVERRIDE + tools)
- Added `data-cursor-target="byoa-cta-button"` to ConnectBar's amber banner
  BYOA button in `McpServerDetailView.tsx`
- Registered demo in `index.ts`, `mdx.tsx`, and `registry.ts`
- Build verified: `yarn build` passes

### Files created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/bring-your-own-oauth.mdx` | How-to guide page |
| `site/src/components/docs/demos/scenarios/byoa-setup/index.tsx` | Demo component |
| `site/src/components/docs/demos/scenarios/byoa-setup/steps.ts` | Fixtures + step data |
| `_projects/2026-04/20260413.02.mcp-integration-docs/tasks/T04_0_plan.md` | Task plan file |

### Files modified

| File | Change |
|------|--------|
| `sdk/react/src/mcp-server/McpServerDetailView.tsx` | Added `data-cursor-target` on BYOA CTA button |
| `site/src/components/docs/index.ts` | Export `DemoByoaSetup` |
| `site/src/components/mdx.tsx` | Register in MDX component map |
| `site/src/components/docs/demos/scenarios/registry.ts` | Register for video export |

## Session Progress (2026-04-13, session 6 — T05)

- Created `docs/guides/integrations/oauth-architecture.mdx` — Diataxis
  Explanation page with three mermaid diagrams covering the full OAuth
  architecture for platform builders
- Three core sections:
  1. **Resolution chain** — flowchart showing DCR vs vendor OAuth decision tree,
     three-level resolution (org override → platform default → none), when
     resolution runs (connect time + every token refresh)
  2. **Credential storage** — two-layer diagram showing OAuthGrant (non-secret
     metadata) vs Managed Environment (encrypted tokens), security boundary
     rationale, environment priority table
  3. **Token lifecycle** — state machine diagram covering connect flow,
     pre-flight check, auto-refresh, failure mode, and four health signals
- Brief capstone section: what BYOA changes across all three layers, including
  why removing an override breaks existing grants
- No demo (by design) — this is an explanation page; UI interactions already
  demoed in T03 and T04; mermaid diagrams are the right medium for architecture
- Audience scoped to platform builders only — external reviewer (Slack
  marketplace) artifact deferred to a future project
- All cross-links verified: `meta.json`, `overview.mdx`, T03 and T04 all
  already point to this page
- Build verified: `yarn build` passes

### Files created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/oauth-architecture.mdx` | Explanation page |
| `_projects/2026-04/20260413.02.mcp-integration-docs/tasks/T05_0_plan.md` | Task plan file |

### No files modified

T05 required no changes to existing files — all cross-links and navigation
entries were already in place from T01–T04.

## Key Decisions (T05)

- **Explanation type, not how-to**: The only non-how-to page in the integrations
  section. Justified because it's the architectural capstone that T03 and T04
  cross-link to for depth.
- **No demo**: Mermaid diagrams are the right medium for architecture. A forced
  ScenarioPlayer demo for an explanation page would be artificial — the UI
  interactions are already covered by T03 and T04 demos.
- **Platform builders only**: External reviewer (Slack marketplace) audience
  explicitly deferred to a future project. One page cannot serve both a "help me
  understand the system I'm building on" audience and a "prove to me your system
  is safe" audience without diluting both.
- **Three pillars matching cross-link promises**: The page structure maps exactly
  to the three promises made by T03 and T04: resolution chain, credential
  storage, token lifecycle. No extra sections, no padding.
- **Fresh resolution on every refresh**: Documented that the resolution chain is
  evaluated on every token refresh, not just connect time. This is the key
  insight that explains why BYOA changes take effect immediately and why
  removing overrides breaks existing grants.

## Next Steps

1. Future: T08 — Custom integration OAuth setup guide (deferred, "MCP server authors" audience)
2. Future: Fix "O Auth App" display name in proto SDK docs codegen (`sdk_docs.go`)

## Task Map

| Task | Title | Status |
|------|-------|--------|
| T01 | Concepts expansion + nav setup | COMPLETE |
| T02 | Marketplace and connect guides + demos | COMPLETE |
| T03 | OAuth for tools guide + hero demo | COMPLETE |
| T04 | BYOA guide + demo | COMPLETE (amended: Settings CRUD) |
| T05 | Architecture transparency page | COMPLETE |
| T06 | Tutorial refresh + cross-link bridge + demo audit | COMPLETE (rescoped) |
| T07 | SDK reference polish | COMPLETE |
| T08 | Custom integration OAuth setup guide | Deferred |

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
