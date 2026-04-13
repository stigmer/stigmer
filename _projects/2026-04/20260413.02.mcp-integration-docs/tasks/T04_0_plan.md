# Task T04: BYOA Guide + Hero Demo

**Created**: 2026-04-13
**Status**: IN PROGRESS
**Estimated effort**: 1 session

## Objective

Write the "Bring Your Own OAuth App" how-to guide with a hero demo
showing the end-to-end BYOA setup flow for an org admin overriding
the platform's OAuth app on a vendor-approval-blocked MCP server
(Slack as the example).

## Diataxis Type

**How-to guide.** The reader already knows what OAuth for tools is
(T03 prerequisite). This page answers: "How do I use my own OAuth
app registration instead of the platform default?"

## Content Strategy

The BYOA flow is an admin-level configuration action, not an everyday
user flow. The guide should be:
- **Focused** — shorter than T02/T03; one clear task with a narrow audience
- **Practical** — step-by-step setup, what changes, how to undo
- **Honest about consequences** — removing an override breaks existing grants

What this page covers:
- When and why to bring your own OAuth app
- Step-by-step setup via the BYOA dialog
- What changes after setup (status indicator, sign-in label, resolution)
- Removing a custom app and the consequences
- Cross-link to the settings page for org-wide visibility

What this page does NOT cover:
- OAuth flow mechanics (covered in T03)
- Resolution chain internals / token refresh architecture (deferred to T05)
- OAuthApp proto structure / API reference (deferred to T07)

## Deliverables

### 1. `bring-your-own-oauth.mdx` (How-to guide)

Sections:
1. Intro — What BYOA is, when you'd use it
2. Prerequisite callout — Links to T03 (OAuth for tools)
3. Hero demo — `<DemoByoaSetup />`
4. When to bring your own app — Two scenarios: vendor approval blocked,
   tighter control
5. Set up your own OAuth app — Step-by-step walkthrough
6. What changes — Status text, sign-in label, resolution summary
7. Remove a custom app — How to revert, grant breakage warning
8. What's next — Link to T05 (OAuth architecture)

### 2. `byoa-setup` demo (6-step playback)

detail (vendor-blocked) → cursor clicks BYOA CTA → dialog overlay
with OAuthAppForm → cursor clicks Save → detail with org app status →
connected with tools.

Fixture data from real Slack seedpack entry (vendor OAuth, HTTP
transport, `channels:read`, `chat:write`, `users:read`, `search:read`).

### 3. Demo registration

- Export from `site/src/components/docs/index.ts`
- Register in `site/src/components/mdx.tsx`
- Register in `site/src/components/docs/demos/scenarios/registry.ts`

## Source Material

- Seedpack: `seedpack/mcp-servers/mcp-server-slack.yaml`
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` (McpServerAuth)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` (BYOA I/O)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` (OAuthStatus)
- Proto: `apis/ai/stigmer/iam/oauthapp/v1/spec.proto` (VendorApprovalStatus)
- SDK: `sdk/react/src/mcp-server/McpServerDetailView.tsx` (ConnectBar)
- SDK: `sdk/react/src/mcp-server/OAuthAppForm.tsx`
- SDK: `sdk/react/src/mcp-server/useOrgOAuthApp.ts`
- SDK fixtures: `sdk/react/src/demo/fixtures.ts`
- Existing demo: `oauth-connect-flow` (T03 — structural template)
- Existing guide: `oauth-for-tools.mdx` (T03 — writing style template)
- Role: `_roles/002_document_writer.md`
- Role: `_roles/001_architect.md`

## Verification

- `yarn build` passes in `site/`
- `bring-your-own-oauth` renders in sidebar under Integrations
- Demo registered in all three locations
- Cross-links from T02 and T03 resolve
- Register is consistent: how-to guide tone, vocabulary-aligned terms
- BYOA dialog overlay is visually faithful to the production modal

## Files Created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/bring-your-own-oauth.mdx` | How-to guide page |
| `site/src/components/docs/demos/scenarios/byoa-setup/index.tsx` | Demo component |
| `site/src/components/docs/demos/scenarios/byoa-setup/steps.ts` | Fixtures + step data |

## Files Modified

| File | Change |
|------|--------|
| `site/src/components/docs/index.ts` | Export `DemoByoaSetup` |
| `site/src/components/mdx.tsx` | Register in MDX component map |
| `site/src/components/docs/demos/scenarios/registry.ts` | Register for video export |

## Key Decisions

- **Slack as example server**: Uses vendor OAuth, Slack marketplace approval
  is well-known, different server than T03 (GitHub) for variety. Real
  seedpack entry used for authentic fixtures.
- **Dialog overlay approach**: BYOA form is a native `<dialog>` in
  production. Demo renders OAuthAppForm in a hand-built dialog-like
  overlay within AppShell — faithful to the visual while sidestepping
  native dialog state limitations in fixture-driven demos.
- **Vendor approval PENDING (not REJECTED)**: PENDING is the more common
  real-world scenario; shows the amber banner with BYOA CTA naturally.

## Full Project Task Map

| Task | Title | Status |
|------|-------|--------|
| **T01** | Concepts expansion + nav setup | COMPLETE |
| **T02** | Marketplace and connect guides + demos | COMPLETE |
| **T03** | OAuth for tools guide + hero demo | COMPLETE |
| **T04** | BYOA guide + demo | IN PROGRESS |
| **T05** | Architecture transparency page | Not started |
| **T06** | Tutorial completion + demo updates | Not started |
| **T07** | SDK reference polish | Not started |
