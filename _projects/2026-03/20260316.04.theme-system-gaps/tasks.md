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

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 5: Add z-index base token (--stgm-z-base) for embedded component stacking context isolation

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 6: Write @stigmer/react README — integration guide, theming instructions, preset usage, custom token override examples

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

