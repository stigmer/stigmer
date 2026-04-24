# Console: Contextual Runner Promotion on Settings > Runners (T09)

**Date**: April 24, 2026

## Summary

Added a contextual Desktop App promotion card to the Console's Settings > Runners page. The card appears below the runner list as a permanent, non-dismissible `<aside>` — informational rather than interruptive. Single file change to `RunnersSection.tsx`, no SDK modifications.

## Problem Statement

The Console's Runners page showed the runner list and a launch button but gave no indication that the Stigmer Desktop app exists or how it enhances runner management. Users visiting this page are already thinking about runners — the ideal moment to surface the Desktop App as a complementary tool.

### Pain Points

- Users on the Runners settings page had no contextual path to the Desktop App, despite it being directly relevant to runner management.
- The UserMenu "Get Desktop App" item (T08) is a global entry point; it lacks page-specific context about why the Desktop App matters for runners specifically.

## Solution

Added a `DesktopAppPromo` component to `RunnersSection.tsx` that renders a subtle card below the runner list. The card names three concrete Desktop App capabilities (system tray, deep-link launches, native notifications) and links to the download page.

## Implementation Details

### Modified: `client-apps/web/src/domain/settings/RunnersSection.tsx`

- Added private `DesktopAppPromo` function component (~25 lines).
- Semantic `<aside aria-label="Stigmer Desktop">` — supplementary content to the main section.
- Layout: horizontal flex with `Monitor` icon left, text center (title + value prop), "Download" link with `ArrowUpRight` right.
- Visual: `border-border-muted rounded-lg border` with `px-4 py-3` — lighter than the runner list cards above, reads as supplementary information.
- `mt-6` spacing creates clear visual separation from primary content.
- Link uses `EXTERNAL_LINKS.download` from `external-links.ts` (T08), `target="_blank"` + `rel="noopener noreferrer"`.
- `Monitor` icon and `ArrowUpRight` indicator follow the visual conventions established in T08.
- Renders in all page states: no-org selected, empty runner list, populated runner list.

### Design Decisions

- **Always-visible, not dismissible**: T09 is contextual information on a page users navigate to intentionally. T10 handles the one-time dismissible global nudge. Adding localStorage dismissal for a subtle footer card is disproportionate complexity.
- **Not conditional on runner count**: Conditioning would require a duplicate `useRunnerList` call (wasteful) or SDK API changes (render prop for empty state — disproportionate for a Console-specific promo). The Desktop App is useful regardless of runner count.
- **No new files**: Component is private to `RunnersSection.tsx` — only used on this page. If T10 or future promotions need a shared pattern, extract then.
- **No SDK changes**: DD-004 compliance — platform builders don't get desktop app CTAs in their embedded components.

## Benefits

- Users on the Runners page now see a contextual, informational reference to the Desktop App with specific capability highlights.
- The promotion is non-intrusive — positioned after the primary content, styled as supplementary information.
- Zero additional complexity: no localStorage state, no data fetching, no SDK surface area changes.

## Impact

- **Console UI**: Settings > Runners page gains a footer card in all states.
- **No SDK changes**: `RunnerListPanel` and all runner hooks remain untouched.
- **No new dependencies**: Uses existing lucide-react icons and `EXTERNAL_LINKS` config.

## Related Work

- **T08** (`6430c485f`): "Get Desktop App" in UserMenu + `external-links.ts` shared config.
- **T07** (`498522593`): Nav/footer wiring for download link on marketing site.
- **T06** (`6e879ead7`): Marketing site `/download` page with platform detection.
- **T10** (next): Smart nudge banner in `AppShell` — one-time, dismissible.
- **Project**: `20260424.01.desktop-app-promotion` — Phase B distribution and promotion.

---

**Status**: Production Ready
**Files changed**: 1 modified
