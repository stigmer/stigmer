# Sidebar Theme Tokens and Custom ESLint Plugin for Token Compliance

**Date**: March 21, 2026

## Summary

Added `--stgm-sidebar-muted` and `--stgm-sidebar-muted-foreground` design tokens to `@stigmer/theme`, replacing ad-hoc opacity modifiers across sidebar components. Created `eslint-plugin-stigmer` with three custom rules that enforce theme token compliance, detect opacity modifier workarounds, and guard SDK import boundaries. Integrated into `make lint` / `make check` for automated enforcement.

## Problem Statement

The Corporate and Fintech theme presets use a dark sidebar in light mode by design. Sidebar child components were referencing main content-area tokens (`text-muted-foreground`, `bg-muted`) that resolve to light colors, creating visual clashes. The initial fix used Tailwind opacity modifiers (`text-sidebar-foreground/60`) which work visually but bypass the theme system -- each preset cannot independently control the opacity-modified value.

### Pain Points

- No `--stgm-sidebar-muted-foreground` token existed, forcing components to improvise with 6 different opacity values (`/10`, `/30`, `/40`, `/50`, `/60`, `/80`)
- No lint rule caught main-area tokens used inside sidebar context
- No mechanism prevented AI-generated code from introducing the same class of bug

## Solution

Three-layer approach: fix the token gap, build automated enforcement, and add AI guidance rules.

## Implementation Details

### New Design Tokens (Part 1)

Added `--stgm-sidebar-muted` and `--stgm-sidebar-muted-foreground` to:
- `sdk/theme/src/tokens.css` -- base (Default) light and dark values
- All four preset CSS files (corporate, fintech, startup, friendly) with preset-appropriate values for both light and dark modes

Added Tailwind bridge mappings in `client-apps/web/src/app/globals.css`.

Updated `OrgSwitcher.tsx`, `UserMenu.tsx`, and `AppShell.tsx` to replace all opacity modifiers with the new token-based classes.

### Custom ESLint Plugin (Part 2)

Created `tools/eslint-plugin-stigmer/` as a local npm workspace package with three rules:

- **`stigmer/no-main-tokens-in-sidebar`** (warn) -- detects main-area Tailwind tokens (`bg-muted`, `text-foreground`, etc.) in files that use sidebar tokens. Heuristic-based with `eslint-disable` escape hatch for portaled content.
- **`stigmer/no-token-opacity-modifiers`** (warn) -- flags opacity modifiers (`/60`, `/50`) on design-token color classes. Catches the exact pattern that caused the original bug.
- **`stigmer/sdk-import-boundaries`** (error) -- prevents SDK packages from importing Console-specific modules (`next/*`, `@/contexts/*`, etc.).

Shared `lib/class-extractor.js` utility handles Tailwind class extraction from JSX attribute values, including `cn()` calls with conditionals and object syntax.

### Cursor Rule + Role Integration (Part 3)

Created `.cursor/rules/client-apps/web/theme-token-guidelines.mdc` with the full token context reference table, opacity modifier prohibition, and verification steps.

Added mandate item #10 ("Theme Token Compliance") to `_roles/004_web_ux_ui.md` referencing the cursor rule and requiring `make lint` after web UI changes.

## Benefits

- Every theme preset can independently control muted sidebar text and background colors
- Token context violations are caught automatically by `make lint` and `make check`
- AI agents editing web UI files receive proactive guidance via the cursor rule
- SDK import boundary violations are hard errors, preventing architectural drift

## Impact

- **Theme package** (`@stigmer/theme`): 2 new tokens added to the public token set (10 values total: 5 presets x 2 modes each)
- **Console** (`client-apps/web`): 3 layout components updated, ESLint config extended
- **Tooling**: New `eslint-plugin-stigmer` package added to monorepo workspaces
- **AI workflow**: New cursor rule and role mandate ensure token compliance in vibe-coded changes

## Related Work

- Sidebar truncation fix (commit `86c81de3`) applied the initial sidebar-muted-foreground tokens to `Sidebar.tsx`
- Existing `no-restricted-imports` rule for `_libs/` (extended conceptually by `sdk-import-boundaries`)

---

**Status**: Production Ready
**Timeline**: Single session
