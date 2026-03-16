# Z-Index Popover Token for Theme System

**Date**: March 16, 2026

## Summary

Added a z-index popover token (`--stgm-z-popover`) to the Stigmer theme system, enabling platform builders to control the stacking order of SDK overlay components (dropdowns, popovers) when embedded in their applications. This required discovering and working around a Tailwind v4 limitation: z-index has no theme namespace, so the token is wired via `@utility` instead of `@theme inline`.

## Problem Statement

When SDK components are embedded in a host application, their floating overlays (dropdown listboxes, popovers, tooltips) can conflict with the host page's z-index hierarchy. A host page with a sticky header at `z-50` could visually obscure an SDK dropdown also at `z-50`. There was no mechanism for platform builders to control SDK overlay stacking.

### Pain Points

- SDK components used hardcoded z-index values (`z-20` on AgentPicker) with no override path
- No z-index token existed in the `--stgm-*` token system despite shadows, transitions, and colors all being tokenized
- Platform builders had no CSS custom property to adjust SDK overlay stacking to fit their page's z-index scheme

## Solution

Added a semantic z-index tier token (`--stgm-z-popover: 50`) that follows the established three-layer token architecture but uses Tailwind v4's `@utility` directive instead of `@theme inline` for the Tailwind bridge layer.

## Implementation Details

### Token layer (`tokens.css`)

Single token in `:root` only — no `.dark` variant (z-index is mode-agnostic), no preset overrides (z-index is functional infrastructure, not design personality):

```css
:root {
  --stgm-z-popover: 50;
}
```

### Tailwind bridge layer (`styles.css`)

Tailwind v4 has no `--z-*` theme namespace. Unlike `--shadow-sm` and `--default-transition-duration`, the built-in `z-10`/`z-50` utilities generate hardcoded integers — not CSS variable references. Defining `--z-popover` in `@theme inline` does not create a utility.

Used `@utility` directive instead:

```css
@utility z-popover {
  z-index: var(--stgm-z-popover);
}
```

This creates a first-class Tailwind utility that:
- Generates `.z-popover { z-index: var(--stgm-z-popover) }` in compiled CSS
- Supports responsive variants, hover states, and standard Tailwind priority
- Resolves through the token variable at runtime — overridable by platform builders

### Component layer

Converted `AgentPicker.tsx` from `z-20` to `z-popover`. Left `ExecutionStream.tsx` at `z-10` (local stacking for a scroll-to-bottom button, not an overlay concern).

### Console inheritance

The Console's `globals.css` imports `@stigmer/react/styles.css` which resolves to the SDK **source** file. The `@utility` directive is available to the Console's Tailwind compilation without duplication.

## Design Decisions

**Semantic tiers over base offset.** The original task called for `--stgm-z-base` (a single offset all components add to). Rejected because: (1) `calc()` in z-index theme values adds complexity, (2) all layers shift together — can't independently adjust popover vs modal, (3) harder to read in component code. Semantic tiers (`--stgm-z-popover`) are self-documenting and follow Chakra/Radix/Bootstrap patterns.

**One tier only.** Only `--stgm-z-popover` added. Additional tiers (`--stgm-z-overlay`, `--stgm-z-modal`, `--stgm-z-toast`) deferred until the SDK gains those component types. Adding later is non-breaking.

**No preset overrides.** Z-index is about stacking context isolation, not design personality. Corporate and Startup don't need different z-index values.

## Benefits

- Platform builders can override `--stgm-z-popover` in CSS to fit their page's z-index scheme
- SDK overlay components use a consistent, semantic z-index value instead of arbitrary integers
- Established the `@utility` pattern for CSS properties that lack Tailwind v4 theme namespace support
- Token resolves through CSS variables at runtime — zero JavaScript involved

## Impact

- **SDK components**: AgentPicker dropdown now uses tokenized z-index
- **Platform builders**: New `--stgm-z-popover` override point for stacking context control
- **Future SDK development**: Pattern established for adding z-index tiers as overlay components are built

## Related Work

- [Shadow Elevation Tokens](2026-03-16-182033-shadow-elevation-tokens-for-theme-system.md) — shadow tokens via `@theme inline`
- [Transition Tokens](2026-03-16-183714-transition-tokens-for-theme-system.md) — transition tokens via `@theme inline`
- [React Style Isolation](2026-03-16-145326-react-style-isolation-for-embeddable-components.md) — `@layer stgm` scoping

---

**Status**: Production Ready
**Timeline**: Session 6 of theme-system-gaps project
