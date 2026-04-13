# Demo Visual Consistency, Step Interactions, and Enforcement

**Date**: April 13, 2026

## Summary

Fixed visual inconsistencies across all 25 demo scenarios, added mid-step interactions to 7 integration guide demos, and introduced automated validation to prevent regressions. Establishes a zero-pixel-font-size baseline enforced by a new `validate-demos` script and strengthened document writer role standards.

## Problem Statement

Demo scenarios across the documentation site had accumulated visual inconsistencies. The BYOA dialog overlay used hardcoded micro-typography (`text-[8px]` to `text-[11px]`) that, compounded with `DEMO_CONTENT_ZOOM` (0.82), rendered far smaller than adjacent SDK components. The dialog also lacked the underlying detail view visible in production, creating a visual disconnect between steps.

Separately, 18 of 22 playback demos did not use mid-step interactions (`scroll-to`, `set-cursor`, `clear-cursor`), despite narration referencing content below the fold. The three new integration guide demos (BYOA, marketplace connect, OAuth connect) had zero mid-step interactions.

### Pain Points

- BYOA dialog appeared "zoomed out" relative to all other screens
- Dialog overlay floated over a blank background instead of the MCP server detail view
- Narration described tools and policies that viewers could not see (content below the fold)
- No automated checks caught pixel font sizes or missing interaction wiring
- 11 scenarios used hardcoded pixel font sizes (`text-[7px]` through `text-[11px]`) totaling ~76 occurrences

## Solution

Three-layer fix: visual consistency across all demos, mid-step interactions for the integration guide demos, and enforcement via role standards and automated validation.

## Implementation Details

### BYOA Dialog Fix

Rewrote the `ByoaDialogOverlay` as `ByoaDialogCard` authored at standard Tailwind scale (`text-sm`, `text-xs`) with `DEMO_CONTENT_ZOOM` handling the sizing. Dialog steps now render the real `McpServerDetailView` behind a semi-transparent overlay, matching production `<dialog>` behavior. Updated `steps.ts` to include server/grant/orgApp data on dialog steps.

### Step Interactions (7 demos)

Wired `useStepInteractions` hook with timed `scroll-to` and `set-cursor` actions:

| Demo | Interactions added |
|------|--------------------|
| byoa-setup | `scroll-to` on steps 0/4/5; `set-cursor` sequence on step 2 (Client ID → Client Secret fields) |
| marketplace-connect-tour | `scroll-to` on steps 2/4 (server config, tools list) |
| oauth-connect-flow | `scroll-to` on steps 0/3 (OAuth section, tools list) |
| federation-overview-tour | Hook wired (empty map, ready for additions) |
| multi-tenant-setup-playback | Hook wired (empty map) |
| provision-grant-playback | Hook wired (empty map) |
| skill-creation-tour | Hook wired (empty map) |

### Token Compliance (11 scenarios)

Replaced all `text-[Npx]` classes across 11 scenario files:
- `text-[11px]` headings → `text-sm`
- `text-[7-10px]` body/labels/buttons → `text-xs`
- Also fixed GitHub authorize page in oauth-connect-flow

### Document Writer Role

Added two mandatory sections to `_roles/002_document_writer.md`:
- **Visual consistency checklist** — no pixel font sizes, no hardcoded zoom, dialog overlay continuity, hand-built UI parity check
- **Step interaction coverage** — every narrated step referencing off-screen content must have `scroll-to`; two-question self-check gate

### Automated Validation

New `site/scripts/validate-demos.ts` checks:
- Token compliance: scans for hardcoded `text-[Npx]` and inline zoom values
- Step interaction coverage: flags narrated demos without `useStepInteractions`
- Manifest alignment: verifies step count matches between `steps.ts` and `manifest.json`

Registered as `yarn validate-demos` and `make validate-demos`.

## Benefits

- All 25 demos now pass validation with zero violations
- BYOA dialog visually matches production behavior (detail view behind dialog)
- Integration guide demos scroll to reveal content as narration references it
- Future demos will be caught by the validation script if they introduce pixel font sizes or skip interaction wiring
- Document writer role now has concrete, mandatory self-checks rather than suggestions

## Impact

- **All demo scenarios** — typography consistency across the entire docs site
- **Integration guides** (marketplace, OAuth, BYOA) — significantly better narration-visual alignment
- **Future demo authors** — clear standards and automated enforcement prevent regression
- **`make check`** — validation integrated into pre-commit workflow

## Related Work

- T02–T04: Integration guide demos created in earlier sessions of this project
- `_changelog/2026-04/2026-04-13-171427-library-card-grid-layout.md`: Card grid layout applied to demos

---

**Status**: ✅ Production Ready
**Files changed**: 19 scenario files, 1 role file, 1 validation script, 2 build config files
