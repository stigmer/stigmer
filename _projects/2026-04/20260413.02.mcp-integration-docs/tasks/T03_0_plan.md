# Task T03: OAuth for Tools Guide + Hero Demo

**Created**: 2026-04-13
**Status**: COMPLETE
**Estimated effort**: 1 session

## Objective

Write the "OAuth for tools" how-to guide with a hero demo showing the
end-to-end experience of connecting an OAuth-protected MCP server (GitHub
as the example).

## Diataxis Type

**How-to guide.** The reader already knows what MCP servers and tools are
(T01 concepts, T02 marketplace guide). This page answers: "How do I connect
a tool that requires OAuth?"

## Content Strategy

The user experience of connecting an OAuth-protected tool is simple: click
a button, authorize in a popup, done. The real value of the page is:

1. Showing the experience via a hero demo
2. Explaining when OAuth applies vs environment variables
3. Explaining the token lifecycle after authorization
4. Showing the manual fallback for users who prefer their own tokens

The page does NOT explain DCR vs vendor OAuth internals — it mentions
"Stigmer handles this automatically" and defers to T05 (OAuth architecture)
for protocol details.

## Deliverables

### 1. `oauth-for-tools.mdx` (How-to guide)

Sections:
1. Intro — OAuth servers, automatic flow
2. Hero demo — `<DemoOAuthConnectFlow />`
3. How OAuth tools differ — `auth` block in YAML, env var badge
4. Connect an OAuth-protected tool — 5-step walkthrough
5. Token lifecycle — health states table
6. Manual override — PAT fallback path
7. What's next — links to BYOA (T04) and architecture (T05)

### 2. `oauth-connect-flow` demo

5-step playback: detail (pre-connect) → cursor clicks "Sign in to connect"
→ GitHub authorization page (BrowserView) → connected detail with tools →
policies tab.

Fixture data from real GitHub seedpack entry (vendor OAuth, HTTP transport,
scope hints).

### 3. SDK fixture helpers

Added `fixtures.mcpServer.getOAuthGrantStatus` and
`fixtures.mcpServer.getOrgOAuthApp` to the demo fixtures module to support
OAuth state fixturing in demo scenarios.

### 4. Demo registration

- Export from `site/src/components/docs/index.ts`
- Register in `site/src/components/mdx.tsx`
- Register in `site/src/components/docs/demos/scenarios/registry.ts`

## Source Material

- Seedpack: `seedpack/mcp-servers/mcp-server-github.yaml` (vendor OAuth)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` (McpServerAuth)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` (OAuthGrantStatus)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` (OAuthStatus)
- SDK: `sdk/react/src/mcp-server/McpServerDetailView.tsx` (ConnectBar)
- Existing demo: `sso-login-playback` (BrowserView pattern)
- Existing demo: `marketplace-connect-tour` (SDK component pattern)
- Document writer role: `_roles/002_document_writer.md`
- Vocabulary: `docs/vocabulary.md`

## Verification

- `yarn build` passes in `site/` — CONFIRMED
- `oauth-for-tools` renders in sidebar under Integrations
- Demo registered in all three locations
- No broken cross-links
- Register is consistent: how-to guide tone, vocabulary-aligned terms
- YAML examples match real seedpack shape

## Files Created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/oauth-for-tools.mdx` | How-to guide page |
| `site/src/components/docs/demos/scenarios/oauth-connect-flow/index.tsx` | Demo component |
| `site/src/components/docs/demos/scenarios/oauth-connect-flow/steps.ts` | Fixtures + step data |

## Files Modified

| File | Change |
|------|--------|
| `sdk/react/src/demo/fixtures.ts` | Added `getOAuthGrantStatus` and `getOrgOAuthApp` fixture helpers |
| `site/src/components/docs/index.ts` | Export `DemoOAuthConnectFlow` |
| `site/src/components/mdx.tsx` | Register in MDX component map |
| `site/src/components/docs/demos/scenarios/registry.ts` | Register for video export |

## Key Decisions

- **GitHub as example server**: Most relatable for developers, uses vendor
  OAuth with HTTP transport, familiar scopes. Matches real seedpack data.
- **Real SDK component for detail views**: Used `McpServerDetailView` with
  fixture data rather than hand-built content — the component renders the
  real OAuth button label, health pill, and credential badge, keeping the
  demo visually identical to production.
- **BrowserView for authorization page**: GitHub authorize page is hand-built
  JSX inside BrowserView, following the SSO demo pattern. Shows realistic
  scopes and app authorization UI.
- **User-experience focused**: Kept DCR vs vendor OAuth distinction to a
  minimum. The two patterns look identical from the user's perspective;
  architecture details belong in T05.
- **Added SDK fixture helpers**: Rather than raw `rpcKey` usage in the demo,
  added proper `fixtures.mcpServer.getOAuthGrantStatus` and
  `fixtures.mcpServer.getOrgOAuthApp` helpers. These are reusable by T04
  and any future OAuth-related demos.

## Full Project Task Map

| Task | Title | Status |
|------|-------|--------|
| **T01** | Concepts expansion + nav setup | COMPLETE |
| **T02** | Marketplace and connect guides + demos | COMPLETE |
| **T03** | OAuth for tools guide + hero demo | COMPLETE |
| **T04** | BYOA guide + demo | Not started |
| **T05** | Architecture transparency page | Not started |
| **T06** | Tutorial completion + demo updates | Not started |
| **T07** | SDK reference polish | Not started |
