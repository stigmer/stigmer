# OAuth for Tools Guide and Hero Demo (T03)

**Date**: April 13, 2026

## Summary

Added the "OAuth for tools" how-to guide and a 5-step hero demo to the
integrations documentation section. The guide explains how to connect
OAuth-protected MCP servers, what happens to the token after authorization,
and how to fall back to manual entry. The demo walks through the full
OAuth flow using GitHub as the example server.

## Problem Statement

The integrations documentation section (T01/T02) covered marketplace browsing
and connecting API-key-based servers, but OAuth-authenticated servers — GitHub,
Slack, Figma, Google Calendar — were only mentioned in a forward-reference
table. Readers who clicked "Sign in to connect" on an OAuth server had no
documentation explaining the flow, token lifecycle, or manual override path.

### Pain Points

- No guide explaining the OAuth connect experience
- No demo showing the sign-in popup → authorization → connected flow
- Forward links from the marketplace guide and overview page pointed to a
  page that didn't exist yet
- The SDK demo fixtures module lacked helpers for OAuth-related RPCs,
  making it impossible to build OAuth-state demos

## Solution

Wrote a Diataxis how-to guide focused on the user experience (not architecture)
and built a ScenarioPlayer demo that alternates between real SDK component views
and a BrowserView mock of GitHub's authorization page. Added missing fixture
helpers to the SDK demo module to support OAuth state fixturing.

## Implementation Details

### Guide (`docs/guides/integrations/oauth-for-tools.mdx`)

- **Diataxis type**: How-to guide (assumes T01/T02 familiarity)
- **Sections**: Intro → hero demo → OAuth vs API-key contrast with YAML
  example → 5-step connect walkthrough → token lifecycle table (4 health
  states) → manual override path → cross-links to T04 (BYOA) and T05
  (architecture)
- **YAML example**: Real `auth` block from `mcp-server-github.yaml` seedpack
  entry showing `oauth_app_ref`, `target_env_var`, and `scope_hints`
- **Tone**: How-to register — direct, second-person, practical

### Demo (`oauth-connect-flow`)

- **Pattern**: Multi-view ScenarioPlayer with cursor animation, following
  `sso-login-playback` (BrowserView) and `marketplace-connect-tour` (SDK
  component) patterns
- **Steps**: (1) GitHub detail pre-connect with "Sign in to connect" →
  (2) cursor clicks sign-in → (3) GitHub authorization page in BrowserView
  with scope list → (4) connected detail with 6 discovered tools →
  (5) policies tab with 3 write operations flagged for approval
- **Fixtures**: GitHub McpServer built from real seedpack entry (vendor OAuth,
  HTTP transport, `repo`/`read:org`/`read:user` scopes, 6 tools, 3 approval
  policies). OAuth grant status fixtures for pre-connect (NO_GRANT) and
  post-connect (HEALTHY with 8h expiry).

### SDK fixture helpers (`sdk/react/src/demo/fixtures.ts`)

- `fixtures.mcpServer.getOAuthGrantStatus` — stubs `useOAuthGrantStatus` hook
- `fixtures.mcpServer.getOrgOAuthApp` — stubs `useOrgOAuthApp` hook

These enable any future demo scenario to fixture OAuth connection states
without raw `rpcKey` usage. Reusable for T04 (BYOA demo).

## Benefits

- OAuth connect flow is now documented with a live demo showing each step
- Forward links from T02 marketplace guide and overview hub now resolve
- SDK demo fixtures module covers OAuth RPCs, unblocking T04 demo work
- Token lifecycle table gives users a quick reference for connection health

## Impact

- **Platform builders**: Can follow the complete path from marketplace
  browsing → OAuth connection → token lifecycle understanding
- **Documentation site**: `guides/integrations/` section now has 3 of 5
  planned pages live (overview, marketplace, OAuth)
- **SDK demo infrastructure**: OAuth fixture helpers available for future demos

## Related Work

- Predecessor: T02 marketplace connect guide (`2026-04-13-190058`)
- Successor: T04 BYOA guide + demo (next task)
- OAuth BYOA proto layer (`2026-04-13-130208`)
- Frontend BYOA experience (`2026-04-13-170304`)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
