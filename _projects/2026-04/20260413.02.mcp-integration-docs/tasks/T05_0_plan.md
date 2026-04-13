# Task T05: OAuth Architecture Explanation Page

**Created**: 2026-04-13
**Status**: IN PROGRESS
**Estimated effort**: 1 session

## Objective

Write `docs/guides/integrations/oauth-architecture.mdx` — a Diataxis
Explanation page for platform builders that covers the three architectural
topics cross-linked from T03 and T04: the OAuth app resolution chain, the
credential storage model, and the token lifecycle.

## Diataxis Type

**Explanation.** The reader has already used the OAuth system (T03) and
possibly BYOA (T04). They want to understand the *why* behind the behavior
they experienced. This is the only non-how-to page in the
`guides/integrations/` section — it serves as the architectural capstone.

## Audience

**Platform builders** who want architecture depth. External reviewers
(Slack marketplace, etc.) are explicitly deferred to a future project.

## Content Strategy

The page delivers on exactly three promises made by T03 and T04 cross-links:

1. **Resolution chain** — How Stigmer picks the OAuth app (org override →
   platform default → none). Two modes: DCR vs vendor OAuth. Resolution runs
   at connect time AND every token refresh.
2. **Storage model** — Where credentials live. OAuthGrant (non-secret
   metadata) vs Managed Environment (encrypted tokens). Why they are
   separate (security boundary, not convenience).
3. **Token lifecycle** — How tokens stay fresh. Connect flow → pre-flight
   check → auto-refresh → failure mode → re-auth.

Brief capstone: What BYOA changes across all three areas.

## No Demo — By Design

Mermaid diagrams are the right medium for architecture. The UI interactions
are already demoed in T03 (OAuth connect flow) and T04 (BYOA setup).
A forced demo for an explanation page would be artificial.

## Deliverables

### Files to create

| File | Purpose |
|------|---------|
| `docs/guides/integrations/oauth-architecture.mdx` | Explanation page |
| `_projects/.../tasks/T05_0_plan.md` | This plan file |

### Files to verify (no changes expected)

| File | Verify |
|------|--------|
| `docs/guides/integrations/meta.json` | `oauth-architecture` already listed |
| `docs/guides/integrations/overview.mdx` | Card already links here |
| `docs/guides/integrations/oauth-for-tools.mdx` | Cross-link resolves |
| `docs/guides/integrations/bring-your-own-oauth.mdx` | Cross-link resolves |

## Source Material

- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` (McpServerAuth)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/oauth.proto` (OAuthGrant, OAuthAppOverride)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` (OAuthStatus, OAuthAppSource)
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` (OAuthConnectionHealth)
- Proto: `apis/ai/stigmer/iam/oauthapp/v1/spec.proto` (OAuthAppSpec, VendorApprovalStatus)
- Existing guides: T03 `oauth-for-tools.mdx`, T04 `bring-your-own-oauth.mdx`
- Roles: `_roles/001_architect.md`, `_roles/002_document_writer.md`

## Verification

- `yarn build` passes in `site/`
- Page renders in sidebar under Integrations
- All mermaid diagrams render correctly
- Cross-links from T03 and T04 resolve
- No broken links
- Register: explanation tone, Stigmer vocabulary, no proto field dumps

## Full Project Task Map

| Task | Title | Status |
|------|-------|--------|
| **T01** | Concepts expansion + nav setup | COMPLETE |
| **T02** | Marketplace and connect guides + demos | COMPLETE |
| **T03** | OAuth for tools guide + hero demo | COMPLETE |
| **T04** | BYOA guide + demo | COMPLETE |
| **T05** | Architecture transparency page | IN PROGRESS |
| **T06** | Tutorial completion + demo updates | Not started |
| **T07** | SDK reference polish | Not started |
