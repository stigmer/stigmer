# Promote SDK Reference and fix site-wide placeholder links

**Date**: April 4, 2026

## Summary

Moved SDK Reference out of the "Coming soon" section on the docs homepage now that all 18 SDK reference pages are live. Fixed every generic `/docs` placeholder link across the marketing site and footer to point to the correct destination page.

## Problem Statement

The SDK Reference was fully generated and published under `/docs/sdk` with 18 resource pages, yet the docs homepage still listed it under "Coming soon" with no link. Meanwhile, every CTA on the marketing site — "Teach your agent", "Connect your tools", "Set your rules", "Read the Docs", "Get Started", "View SDKs" — pointed to the generic `/docs` landing page instead of the specific page the visitor would actually want. The footer had the same issue. One internal link in `create-agent.mdx` pointed to a non-existent tutorials page.

### Pain Points

- Visitors clicking "Teach your agent" landed on the docs hub instead of the first-skill tutorial
- "View SDKs" linked to `/docs` instead of the SDK Reference section
- SDK Reference appeared unavailable despite being complete
- Footer links for "Getting Started" and "API Reference" were indistinguishable — both went to `/docs`
- A broken card in `create-agent.mdx` linked to `/docs/tutorials/give-your-agent-tools`, which does not exist

## Solution

Promoted SDK Reference to its own "Reference" section on the docs homepage with a working link. Updated all marketing site CTAs and footer links to point to the specific docs page that matches the CTA label. Replaced the broken tutorials card with an SDK Reference card.

## Implementation Details

Nine files changed across two areas:

**Docs homepage** (`docs/index.mdx`):
- Created a new "Reference" section between "Learn" and "Coming soon"
- Moved the SDK Reference card into it with `href="/docs/sdk"`
- Removed "Coming soon." from its description
- Left Tutorials and CLI Reference under "Coming soon"

**Marketing site sections** (6 files under `site/src/components/`):
- `Capabilities.tsx` — "Teach your agent" → `/docs/getting-started/first-skill`, "Connect your tools" → `/docs/getting-started/connect-tools`, "Set your rules" → `/docs/getting-started/connect-tools`
- `Hero.tsx` — "Read the Docs" → `/docs/getting-started/quickstart`
- `HowItWorks.tsx` — "Get Started" → `/docs/getting-started/quickstart`
- `WhyItWorks.tsx` — "Read the docs" → `/docs/concepts/what-is-stigmer`
- `FinalCTA.tsx` — "View SDKs" → `/docs/sdk`
- `UseCasesPage.tsx` — "Read the Docs" → `/docs/getting-started/quickstart`

**Footer** (`site/src/lib/constants.ts`):
- "Getting Started" → `/docs/getting-started/quickstart`
- Renamed "API Reference" to "SDK Reference" → `/docs/sdk`
- "Tutorials" stays at `/docs` (no tutorials section yet)
- Removed all Phase TODO comments

**Broken link** (`docs/getting-started/create-agent.mdx`):
- Replaced the dead `/docs/tutorials/give-your-agent-tools` card with an "SDK Reference" card linking to `/docs/sdk`

## Benefits

- Every CTA on the marketing site now lands on the page the visitor expects
- SDK Reference is discoverable from the docs homepage
- No more dead-end links or misleading "Coming soon" labels for shipped content
- Removed 8 stale TODO comments that were cluttering the codebase

## Impact

Affects the public docs site and marketing site. All link targets are existing, verified pages. No functional or API changes.

## Related Work

- SDK docs auto-generation (2026-04-03/04 changelogs) — produced the 18 SDK reference pages that are now promoted
- Phase 3 Getting Started documentation — the destination pages these links now point to

---

**Status**: ✅ Production Ready
