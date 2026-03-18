# Fix ScrollArea Hydration Mismatch

**Date**: March 18, 2026

## Summary

Replaced the Base UI `ScrollArea` component with a CSS-based implementation to eliminate a React 19 `useId()` hydration mismatch in the Console. The error occurred because Base UI internally generated different `data-id` attributes during server-side rendering vs. client hydration in Next.js 16 App Router.

## Problem Statement

The Stigmer Console displayed a persistent hydration error on every page load: *"A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up."*

### Pain Points

- Base UI's `ScrollArea` used React 19's `useId()` to generate internal `data-id` attributes (`base-ui-R_h4lb_-viewport` on server vs. `base-ui-R_26q1b_-viewport` on client)
- The mismatch was non-patchable -- React left the DOM in an inconsistent state
- The error was noisy and could mask real hydration issues during development
- The component tree crossed an RSC-to-client boundary and a Suspense boundary, creating conditions where `useId()` tree-path encoding diverged

## Solution

Replaced `@base-ui/react/scroll-area` with a lightweight CSS-based scroll container using standard `scrollbar-width`/`scrollbar-color` properties and webkit pseudo-elements.

## Implementation Details

- **File changed**: `client-apps/web/src/components/ui/scroll-area.tsx`
- Removed Base UI's four-element structure (Root, Viewport, Scrollbar, Thumb) in favor of a single `div` with `overflow-auto`
- Scrollbar styling uses Firefox-standard properties (`scrollbar-width: thin`, `scrollbar-color`) and webkit pseudo-elements for cross-browser coverage
- Preserved `data-slot="scroll-area"` for consistency with UI component conventions
- Removed the unused `ScrollBar` export (only used internally)
- Zero changes to consumers (`Sidebar.tsx`, `ContextPanel.tsx`)

## Benefits

- Eliminates root cause rather than masking it with `suppressHydrationWarning`
- Simpler component (30 lines vs. 55 lines, single div vs. four nested elements)
- One fewer Base UI sub-import, zero hydration risk
- No visual regression -- scrollbar appearance matches the previous implementation

## Impact

- **Console**: Clean hydration with no errors or warnings from the ScrollArea component
- **SDK**: No changes -- this component lives in `client-apps/web`, not `@stigmer/react`
- **Other Base UI components**: Unaffected (Button, Menu, Collapsible, Separator, Badge remain)

---

**Status**: Production Ready
