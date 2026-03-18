# Reply Widget Appearance and Human Message Indentation

**Date**: March 18, 2026

## Summary

Fixed two visual gaps in the session page compared to the Claude Code reference: the FollowUpInput now renders as a prominent floating widget card (previously invisible in dark mode), and human messages are indented 20% from the left edge to create instant visual differentiation from AI/system messages. Both changes are SDK-level improvements that benefit all consumers.

## Problem Statement

### Pain Points

- The FollowUpInput's inner card used `bg-background`, which in dark mode is the same shade as the page background (oklch 0.145) — the input was virtually invisible
- The outer wrapper's `border-t` and `bg-card` defaults imposed a "bar" layout assumption, requiring consumers to override with `border-t-0 bg-transparent` to get floating widget behavior
- Human messages (`MESSAGE_HUMAN`) started at the same left edge as AI messages, providing no positional cue to distinguish the speaker — users had to read content to determine authorship

## Solution

Two SDK-level changes that improve the out-of-box experience for all platform builders:

1. **FollowUpInput as floating widget**: Removed bar chrome from outer wrapper defaults, changed inner card from `bg-background` to `bg-card` for visible contrast in both light and dark modes
2. **Human message indentation**: Added `ms-[20%]` (margin-inline-start) to `HumanMessage` and `pending-message` rendering, creating ~177px indent on typical thread columns

## Implementation Details

### FollowUpInput (sdk/react)

- Outer wrapper: Changed from `"border-border bg-card shrink-0 border-t px-4 py-3"` to `"shrink-0 px-4 py-3"` — no bar chrome, just padding
- Inner card: Changed from `bg-background` to `bg-card` — visible contrast against page background in dark mode (oklch 0.205 vs 0.145)
- SessionPage: Removed `className="border-t-0 bg-transparent"` override — SDK defaults now produce correct appearance

### MessageEntry / MessageThread (sdk/react)

- `HumanMessage`: Added `ms-[20%]` to outer div className
- `pending-message`: Added `ms-[20%]` to match HumanMessage indentation
- Uses logical property `ms-` for RTL language support
- Percentage-based margin adapts to container width

## Benefits

- **Immediate visual recognition**: Human messages are instantly distinguishable from AI messages by position alone
- **Better dark mode experience**: FollowUpInput card is clearly visible against the page background
- **Improved SDK defaults**: Platform builders get a floating widget out of the box — no className overrides needed
- **RTL support**: Uses `margin-inline-start` instead of `margin-left`

## Impact

- SDK consumers: Better defaults for `FollowUpInput` and `MessageEntry` — no code changes required
- Console: Simplified SessionPage by removing className override workaround
- Visual: Session page now matches Claude Code's visual hierarchy patterns

## Related Work

- Part of the session page redesign project (20260318.03)
- Follows Phase 1-4 completion: sidebar removal, widget decomposition, layout redesign, dark mode token alignment

---

**Status**: Production Ready
