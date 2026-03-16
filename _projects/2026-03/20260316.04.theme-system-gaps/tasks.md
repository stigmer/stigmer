# Tasks: 20260316.04.theme-system-gaps

**Created**: 2026-03-16

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Sync SDK styles.css @theme inline with globals.css — add success, warning, info, chart token mappings

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Add success/success-foreground, warning/warning-foreground, info/info-foreground token mappings
- [x] Add chart-1 through chart-5 token mappings
- [x] Verify SDK styles.css and Console globals.css alignment

### Notes
- Added 11 token mappings to `sdk/react/src/styles.css` `@theme inline` block
- **Sidebar tokens deliberately excluded from SDK.** Sidebar is a Console layout concern — embedded SDK components (chat widgets, execution viewers) don't have sidebars. Excluding sidebar from `@theme inline` means Tailwind won't generate `bg-sidebar` etc. in SDK components, acting as a compile-time guard enforcing the Console/SDK boundary. The Console gets sidebar tokens through its own `globals.css`, which imports the SDK styles and adds sidebar on top.
- No existing SDK components use the newly added tokens — this is a proactive addition to complete the theme surface for future components.

## Task 2: Add preset prop to StigmerProvider so platform builders can apply presets programmatically

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Fix dark mode CSS selectors in all 4 preset files (descendant matching for embedded contexts)
- [x] Add `ThemePresetId` union type derived from `THEME_PRESETS` array
- [x] Add `resolvePresetClass()` utility function to `@stigmer/theme`
- [x] Export new type and function from package barrel
- [x] Add optional `preset` prop to `StigmerProviderProps`
- [x] Resolve preset ID to CSS class and apply to wrapper div
- [x] TypeScript build verification across `sdk/theme`, `sdk/react`, `client-apps/web`

### Notes
- **Architectural discovery: dark mode CSS selectors were broken for embedded use.** All 4 preset CSS files used compound selectors (`.stgm-theme-X.dark`) requiring both classes on the same element. In embedded contexts, `.dark` is on `<html>` (host-controlled) and the preset class is on the StigmerProvider's `<div>` — compound selector matches neither. Fixed by adding `.dark .stgm-theme-X` descendant selector alongside the existing compound. Both have specificity `0-2-0`, no cascade conflicts.
- Switched `THEME_PRESETS` from explicit `readonly ThemePreset[]` type annotation to `as const satisfies readonly ThemePreset[]` to preserve literal types for the `ThemePresetId` union derivation. Fully backward-compatible.
- `resolvePresetClass()` includes a dev-mode `console.warn` for invalid IDs — guards JavaScript consumers who bypass TypeScript.
- Console (`ThemePresetSelector`, `StigmerTransportBridge`) left unchanged — page-level theming is a different concern from component-level theming.

## Task 3: Add shadow tokens (--stgm-shadow-sm/md/lg) to tokens.css and override per preset

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Add `--stgm-shadow-sm/md/lg` to `tokens.css` `:root` (light) with Tailwind v4 default values
- [x] Add `--stgm-shadow-sm/md/lg` to `tokens.css` `.dark` with increased opacity (~2.5x) for dark surface visibility
- [x] Add shadow overrides to `corporate.css` — slightly more prominent shadows (enterprise solid-card feel)
- [x] Add shadow overrides to `startup.css` — minimal, barely-there shadows (Linear/Vercel flat aesthetic)
- [x] Add shadow overrides to `friendly.css` — soft, extra-diffused shadows (warm, approachable)
- [x] Add shadow overrides to `fintech.css` — tight, precise shadows (Stripe-like crispness)
- [x] Add `--shadow-sm/md/lg` Tailwind `@theme inline` mappings to `sdk/react/src/styles.css`
- [x] Add `--shadow-sm/md/lg` Tailwind `@theme inline` mappings to `client-apps/web/src/app/globals.css`
- [x] Verify `npm run build:libs` passes — TypeScript + Tailwind compilation clean
- [x] Verify built CSS contains `--tw-shadow: var(--stgm-shadow-*)` resolution chain

### Notes
- **Token scope: sm/md/lg only.** Matches the 3 tiers actually used in the codebase (shadow-sm: 1 usage, shadow-md: 3, shadow-lg: 2). No shadow-xl or shadow-2xl consumers exist. Adding more tiers later is non-breaking.
- **Base defaults replicate Tailwind v4 built-in values — zero visual regression.** The change is purely structural: shadows become overridable via the token system without changing how existing components look.
- **Dark mode shadows use ~2.5x opacity.** Standard practice (Material Design 3, Apple HIG, Stripe). On dark backgrounds, shadows at 10% opacity are nearly invisible — increased to 25-35% for perceptible elevation cues.
- **Preset shadow character matches design language:** Corporate = defined/prominent, Startup = barely-there/flat, Friendly = soft/diffused, Fintech = tight/precise. Each preset overrides both light and dark variants.
- **No separate shadow color token.** Tailwind v4 already supports `shadow-(color:...)` syntax — a dedicated `--stgm-shadow-color` would duplicate built-in capability.
- **Token grouping:** shadows sit between chart tokens and sidebar tokens in all files (colors → effects → layout-specific).

## Task 4: Add transition tokens (--stgm-transition-duration, --stgm-transition-timing) and override per preset

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Verify Tailwind v4 compiled CSS to determine transition wiring path
- [x] Add `--stgm-transition-duration` and `--stgm-transition-timing` to `tokens.css` `:root` (base defaults matching Tailwind v4)
- [x] Add transition overrides to `corporate.css` — 200ms, standard curve (deliberate enterprise feel)
- [x] Add transition overrides to `startup.css` — 100ms, ease-out only (snappy dev-tools feel)
- [x] Add transition overrides to `friendly.css` — 200ms, standard curve (relaxed consumer SaaS feel)
- [x] Add transition overrides to `fintech.css` — 150ms, tighter curve (precise financial feel)
- [x] Add `--default-transition-duration` and `--default-transition-timing-function` Tailwind `@theme inline` mappings to `sdk/react/src/styles.css`
- [x] Add same `@theme inline` mappings to `client-apps/web/src/app/globals.css`
- [x] Verify `npm run build:libs` passes — TypeScript + Tailwind compilation clean
- [x] Verify built CSS: `transition-colors` resolves through `var(--tw-duration, var(--stgm-transition-duration))` chain
- [x] Verify old Tailwind hardcoded defaults (`--default-transition-duration: .15s`) replaced by token references

### Notes
- **Tailwind v4 wiring works via `--default-transition-duration` / `--default-transition-timing-function`.** These are theme variables that all `transition-*` utilities fall back to when no explicit `duration-*` or `ease-*` is applied. Overriding them via `@theme inline` makes every existing `transition-colors` / `transition-all` / `transition-transform` automatically pick up the preset's timing. Zero component changes needed.
- **Tailwind v4 inlines the chain.** The compiled CSS shows `transition-duration: var(--tw-duration, var(--stgm-transition-duration))` — Tailwind collapsed `var(--default-transition-duration)` into `var(--stgm-transition-duration)` at build time. Clean, no intermediate variable in the output.
- **No dark mode overrides.** Motion is perceptually identical across light/dark surfaces (unlike shadows where dark backgrounds require higher opacity). Tokens set in the light selector cascade into dark mode. This is a deliberate simplification — not an oversight.
- **No tiers (fast/normal/slow).** Zero components differentiate transition speeds today — everything uses Tailwind's single default. Adding tiers later is non-breaking.
- **Explicit `duration-*` utilities still win.** The fallback chain `var(--tw-duration, var(--stgm-transition-duration))` means if a component applies `duration-200`, `--tw-duration` is set and takes precedence over the token default. Clean override semantics.
- **Preset motion character:** Corporate (200ms) = deliberate/enterprise, Startup (100ms + ease-out) = instant/snappy, Friendly (200ms) = relaxed/unhurried, Fintech (150ms + tighter curve) = precise/controlled. Timing functions vary to match each design language's motion personality, not just speed.

## Task 5: Add z-index popover token for embedded component stacking context isolation

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Audit all z-index usage across codebase (11 occurrences in 8 files)
- [x] Evaluate design approaches: single base offset vs. semantic tiers vs. defer
- [x] Add `--stgm-z-popover: 50` to `tokens.css` `:root` (no `.dark`, no presets — z-index is mode-agnostic and not design-personality)
- [x] Discover that Tailwind v4 has no `--z-*` theme namespace — `@theme inline` cannot create z-index utilities
- [x] Use `@utility z-popover` directive instead to create a first-class Tailwind utility
- [x] Add `@utility z-popover { z-index: var(--stgm-z-popover); }` to `sdk/react/src/styles.css`
- [x] Verify Console inherits utility via `@import "@stigmer/react/styles.css"` (resolves to SDK source)
- [x] Convert `AgentPicker.tsx` from `z-20` to `z-popover`
- [x] Leave `ExecutionStream.tsx` at `z-10` (local stacking, not an overlay)
- [x] Verify `npm run build:libs` passes — TypeScript + Tailwind compilation clean
- [x] Verify built CSS: `.z-popover { z-index: var(--stgm-z-popover) }` resolution chain
- [x] Verify Console build (`client-apps/web`) passes

### Notes
- **Tailwind v4 has no z-index theme mechanism.** Unlike shadows (`--shadow-sm`) and transitions (`--default-transition-duration`), the built-in `z-10`/`z-20`/`z-50` utilities generate hardcoded integers, not CSS variable references. There is no `--z-*` namespace in `@theme`. Defining `--z-popover` in `@theme inline` does NOT create a utility.
- **Used `@utility` directive instead of `@theme inline`.** Tailwind v4's `@utility z-popover { z-index: var(--stgm-z-popover); }` creates a first-class utility that participates in Tailwind's utility layer. It supports responsive variants, hover states, and the standard Tailwind priority system.
- **Semantic tiers, not a base offset.** Chose `--stgm-z-popover` (one semantic tier) over `--stgm-z-base` (global offset). A base offset forces all SDK layers to shift together and uses `calc()` in z-index which adds unnecessary complexity. Semantic tiers are self-documenting and give platform builders independent control over each stacking layer. Additional tiers (`--stgm-z-overlay`, `--stgm-z-modal`, `--stgm-z-toast`) will be added when the SDK gains those component types.
- **No preset overrides.** Z-index is functional infrastructure, not design personality. Corporate and Startup don't need different z-index values — that's a stacking context concern, not a brand concern.
- **No `.dark` overrides.** Z-index is mode-agnostic (same reasoning as transitions).
- **Portal content and `:root` cascade.** Portal-based overlays (Base UI `FloatingPortal`) render to `document.body`, outside the `StigmerProvider` wrapper. CSS variables on the wrapper don't cascade to portals. However, `--stgm-z-popover` is defined on `:root` in `tokens.css`, which does cascade to portal content. Future improvement: `StigmerProvider` could create a portal container to keep portal content within the theme scope (Base UI Portal accepts a `container` prop).
- **Console inherits the utility.** `globals.css` imports `@stigmer/react/styles.css` which resolves to the SDK source file (not compiled dist). The `@utility` directive is available to the Console's Tailwind compilation without duplication.

## Task 6: Write @stigmer/react README — integration guide, theming instructions, preset usage, custom token override examples

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Define doc blueprint: audience (platform builders), gap analysis (no README existed), structure outline
- [x] Write Install section with peer dependencies table
- [x] Write Quick Start with minimal working example (client + provider + component + stylesheet)
- [x] Write Provider section with props table and `useStigmer()` hook usage
- [x] Write Theming section: built-in presets table, custom token override CSS example, dark mode explanation, token categories reference
- [x] Write Style Isolation section: `@layer stgm`, `.stgm` container scoping, `--stgm-*` namespacing
- [x] Write Components and Hooks section: all 6 subpath exports with per-export tables
- [x] Write Exports quick-reference table
- [x] Cross-reference `@stigmer/theme` README for full token reference (no duplication)

### Notes
- Followed the tone and structure of `@stigmer/theme` README — concise, code-heavy, no marketing.
- Custom token override example includes shadow and transition tokens (from Tasks 3-4) alongside colors, demonstrating the full theming surface.
- Dark mode explanation covers the descendant selector pattern (`&:is(.dark *)`) that was fixed in Task 2.
- Component tables mirror the actual barrel exports from each subpath `index.ts` file.
- Deliberately did not duplicate the full token reference table — pointed readers to `@stigmer/theme` README via relative link.
- HITL acronym expanded on first use (Human-in-the-Loop) per doc writer standards.
- MCP acronym expanded on first use (Model Context Protocol) per doc writer standards.


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

