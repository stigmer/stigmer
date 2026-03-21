# Fix Session Subject Truncation in Sidebar

**Date**: March 21, 2026

## Summary

Session subjects in the sidebar were always truncated to a single line with ellipsis and no way to reveal the full text. This change introduces a multi-layered fix: two-line display with `line-clamp-2`, a Base UI Tooltip for full-text hover reveal, word-boundary initial subjects, and a delayed refetch to surface LLM-generated titles.

## Problem Statement

The sidebar Recents section displayed session subjects as single-line truncated text inside a 280px-wide sidebar. Users could not see or discover the full subject of their sessions.

### Pain Points

- **Mid-word truncation**: The initial subject was set to `message.slice(0, 120)` — the raw first 120 characters of the user's message. This produced ugly mid-word cuts like "Can you describe what we have in th..."
- **No reveal mechanism**: There was no tooltip, hover-expand, or other way to see the full subject text once truncated
- **Single-line constraint**: The `truncate` CSS class forced all subjects to one line, wasting available vertical space in a scrollable area
- **Stale initial subject**: The LLM-generated subject (3-7 words, max 50 chars) runs asynchronously via a Temporal activity. The sidebar had no mechanism to pick up the updated subject without manual navigation

## Solution

A three-layer approach addressing display, data quality, and reactivity:

1. **Display layer** — Replace `truncate` (single-line ellipsis) with `line-clamp-2` (two-line clamping) on session links, doubling visible text. Add a Base UI Tooltip that shows the full subject on hover.
2. **Data layer** — Replace `message.slice(0, 120)` with `firstNWords(message, 8)`, producing clean word-boundary subjects as an initial placeholder before the LLM generates the proper title.
3. **Reactivity layer** — Add a one-shot delayed refetch (5 seconds) when viewing a session, so the LLM-generated subject replaces the initial placeholder without requiring navigation or page refresh.

## Implementation Details

### New Tooltip primitive (`client-apps/web/src/components/ui/tooltip.tsx`)

Created a Tooltip component using `@base-ui/react/tooltip`, following the same shadcn/ui wrapping pattern as the existing Dialog and DropdownMenu primitives. Exports `Tooltip`, `TooltipProvider`, `TooltipTrigger`, and `TooltipContent`. The content uses `Tooltip.Portal → Positioner → Popup` with popover-style theming and entry/exit animations.

### Sidebar session list (`Sidebar.tsx`)

- Wrapped the session list in `TooltipProvider` for coordinated tooltip delays
- Each session link now uses `TooltipTrigger` with Base UI's `render` prop to compose with Next.js `Link` without extra DOM wrappers
- Replaced `block truncate` with `line-clamp-2` — text wraps to two lines before clamping, showing roughly double the content
- Added `setTimeout(refetch, 5_000)` that fires once per session view to catch the async LLM subject update

### Session launcher (`SessionLauncher.tsx`)

- Added `firstNWords(text, n)` utility: splits on whitespace, returns first N words. Produces clean subjects like "Can you describe what we have in" instead of "Can you describe what we have in th"
- Changed `subject: message.slice(0, 120)` to `subject: firstNWords(message, 8)`

## Benefits

- Session subjects are now readable at a glance (two lines instead of one)
- Full subject is accessible via tooltip hover without navigation
- Initial subjects break at word boundaries — no more mid-word truncation
- LLM-generated titles appear within seconds without requiring user action
- Tooltip primitive is reusable across the Console for future truncated-text patterns

## Impact

- **End users**: Can identify sessions from the sidebar without guessing from truncated fragments
- **Console UX**: Sidebar session items are more informative while remaining compact (two lines per item in a ScrollArea)
- **Codebase**: New `tooltip.tsx` primitive available for other Console components that need truncated-text reveal

## Related Work

- Theme token compliance work (sidebar-muted-foreground tokens) included in the same commit
- `GenerateSessionSubject` Temporal activity in the backend (unchanged) — this fix bridges the gap between initial subject and LLM-generated title

---

**Status**: ✅ Production Ready
