# Style Isolation for @stigmer/react Embeddable Components

**Date**: 2026-03-16
**Session**: 7 (20260316.01.sdk-package-restructure)
**Scope**: `sdk/react`, `client-apps/web/_libs/ui/theme`, `client-apps/web/src/app`

## Summary

Added CSS Cascade Layer isolation, namespaced design tokens, and scoped preflight to `@stigmer/react` so embeddable components never leak styles into host applications. Kept Tailwind as the styling engine — no CSS Modules migration.

## What Changed

### 1. Namespaced Design Tokens (`@stigmer/theme`)

Renamed all 82 CSS custom properties in `tokens.css` from generic names to `--stgm-*` namespaced names (both `:root` and `.dark`):

- `--background` → `--stgm-background`
- `--primary` → `--stgm-primary`
- `--border` → `--stgm-border`
- `--radius` → `--stgm-radius`
- (40 in `:root`, 40 in `.dark`)

Updated `@theme inline` blocks in both CSS entry points to reference new names.

### 2. CSS Cascade Layers (`sdk/react/src/styles.css`)

Replaced monolithic `@import "tailwindcss"` with granular layered imports:

```css
@layer stgm;
@import "tailwindcss/theme.css" layer(stgm);
@import "tailwindcss/utilities.css" layer(stgm);
@import "@stigmer/theme/tokens.css" layer(stgm);
```

All Stigmer CSS now lives inside `@layer stgm`, which has lower cascade priority than un-layered host CSS. Host app styles always win at equal specificity.

### 3. Omitted Preflight

Tailwind's `preflight.css` (CSS reset) is NOT imported in the React package build. This prevents the compiled `dist/styles.css` from resetting the host app's global typography, margins, and box-sizing.

### 4. Scoped Reset (`.stgm` Container)

Added a minimal scoped reset that only applies within the `.stgm` container class:

- `line-height: 1.5`, `-webkit-font-smoothing: antialiased` on `.stgm`
- `box-sizing: border-box`, `border-width: 0`, `border-color: var(--stgm-border)` on `.stgm *`

### 5. StigmerProvider Container (`sdk/react/src/provider.tsx`)

`StigmerProvider` now renders a `<div className="stgm">` wrapper around its children. This is the scoping boundary for the CSS reset and design tokens. Added optional `className` prop for consumer customization.

### 6. Package.json Adjustment

Changed `sideEffects` from `false` to `["*.css"]` so bundlers don't tree-shake the CSS file import.

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `client-apps/web/_libs/ui/theme/src/tokens.css` | +82/-82 | Namespaced all CSS custom properties |
| `client-apps/web/src/app/globals.css` | +42/-42 | Updated `@theme inline` references |
| `sdk/react/src/styles.css` | +49/-30 | Granular layered imports, scoped reset |
| `sdk/react/src/provider.tsx` | +18/-6 | Added `.stgm` container div |
| `sdk/react/package.json` | +3/-1 | Updated sideEffects |

## Technical Decisions

- **Why not CSS Modules?** CSS Modules only scopes class names — it doesn't solve preflight leakage, token collisions, or cascade conflicts. It would also require rewriting all 22 component files and losing Tailwind DX. CSS Layers + namespaced tokens solves all three problems without touching component code.
- **Why `@layer stgm` not `@layer stigmer`?** Short prefix matches the `stgm-` class naming convention already used in components (e.g., `stgm-agent-session-history`). Reduces visual noise in CSS variable references.
- **Why omit preflight entirely?** Scoping preflight to a container selector is not natively supported by Tailwind v4. The minimal scoped reset in `.stgm` provides the essential `box-sizing: border-box` normalization that components need without resetting the entire host page.
- **Why `display: block` on the wrapper (default)?** The `.stgm` div sits between context providers and `AppShell` in the console. A plain block div is layout-transparent at this position. No `display: contents` or flex tricks needed.

## Verification

- `tsc --noEmit` — 0 errors (both `@stigmer/sdk` and `@stigmer/react`)
- `next build` — 17 pages, 2.0s, 0 errors (Turbopack)
- `npm run build:libs` — all 4 packages build
- Dry-run publish — all 4 packages pass `npm publish --dry-run`
- Browser smoke test — 9/9 automated checks pass: host styles preserved, host variables preserved, Stigmer tokens functional, scoped reset working

## Consumer Experience (After This Change)

```tsx
import { StigmerProvider } from '@stigmer/react';
import '@stigmer/react/styles.css';

function MyApp() {
  return (
    <StigmerProvider client={stigmerClient}>
      <AgentChatWidget agentId="my-agent" />
    </StigmerProvider>
  );
}
```

- Zero Tailwind dependency for consumers
- Zero CSS side effects on host app
- Zero token collisions
- Theming via `--stgm-*` CSS custom properties on `.stgm`
