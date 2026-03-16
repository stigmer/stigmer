# Notes: 20260316.04.theme-system-gaps

**Created**: 2026-03-16

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-16 - Project kickoff & architectural analysis

### `@stigmer/theme` moved to `sdk/theme/` (done)

- Was at `client-apps/web/_libs/ui/theme/` but published as `@stigmer/theme` on npm
- `@stigmer/react` depends on it — SDK depending on a client app internal lib was an inverted dependency
- Platform builders install it directly — it's a first-class SDK surface, not a web app internal
- The `_libs` convention implies non-publishable internals; this package is neither
- **Completed in session 2** — moved via `git mv`, updated workspace config, made tsconfig self-contained, fixed publish script path and order, removed orphaned `_libs/`

### Gap audit summary

10 gaps identified in theming system. This project addresses 6:
1. SDK `@theme inline` missing semantic tokens (success, warning, info, chart, sidebar)
2. `StigmerProvider` has no `preset` prop — host must wire CSS classes manually
3. No shadow tokens (`--stgm-shadow-*`)
4. No transition tokens (`--stgm-transition-*`)
5. No z-index base token (`--stgm-z-base`) for stacking context isolation
6. No `@stigmer/react` README for platform builders

Deferred: spacing tokens, typography scale, RTL/locale/density, Storybook

---

## 2026-03-16 - Task 1: Token sync decision

### Sidebar tokens excluded from SDK (deliberate)

- Sidebar is a Console layout concern — embedded SDK components (chat widgets, execution viewers) don't have sidebars
- Excluding sidebar from `@theme inline` in SDK means Tailwind won't generate `bg-sidebar`, `text-sidebar-foreground`, etc. in SDK components
- This acts as a compile-time guard: if an SDK component author tries to use `bg-sidebar`, it simply won't exist — steering them toward generic surface tokens (background, card, muted)
- The Console gets sidebar tokens through `globals.css`, which imports SDK styles and adds sidebar mappings on top — correct layering
- Cost of being wrong is near zero: adding sidebar later is 7 lines of CSS; removing after adoption is a breaking change

### Token grouping in styles.css

- Status tokens (success, warning, info) grouped after destructive — all semantic status colors together
- Chart tokens grouped after ring — matching the grouping in globals.css
- 11 new mappings total, bringing SDK from 19 to 30 token mappings

---

## 2026-03-16 - Task 2: Preset prop and dark mode discovery

### Dark mode CSS selectors were broken for embedded use

- All 4 preset CSS files used compound selectors (`.stgm-theme-X.dark`) requiring both classes on the same DOM element
- In the Console this works: `ThemePresetSelector` applies both `.dark` and `.stgm-theme-X` to `document.documentElement`
- In embedded SDK contexts it breaks: `.dark` is on `<html>` (host-controlled), preset class is on StigmerProvider's `<div>` — compound selector matches neither
- Result without fix: corporate LIGHT colors rendered inside a dark page
- Fixed by adding `.dark .stgm-theme-X` descendant selector alongside the existing compound — specificity is identical (`0-2-0`), both Console and embedded cases work

### `satisfies` instead of explicit type annotation for THEME_PRESETS

- `THEME_PRESETS` was typed as `readonly ThemePreset[]` which widens `id` to `string`, defeating `as const`
- Switched to `as const satisfies readonly ThemePreset[]` — preserves literal types for `ThemePresetId` derivation while keeping runtime shape validation
- Fully backward-compatible: the narrower inferred type is assignable to `readonly ThemePreset[]`

### Console theming stays separate

- `ThemePresetSelector` applies classes to `document.documentElement` — page-level concern
- `StigmerTransportBridge` passes no preset — the Console manages theming globally
- The new `preset` prop is for embedded SDK consumers, not the Console

---

## 2026-03-16 - Task 3: Shadow token design decisions

### Tailwind v4 shadow theming via @theme inline

- Tailwind v4 shadow utilities resolve to `--shadow-*` CSS custom properties: `shadow-sm` → `var(--shadow-sm)`, `shadow-md` → `var(--shadow-md)`, etc.
- Overriding via `@theme inline { --shadow-sm: var(--stgm-shadow-sm); }` replaces only the specified tiers — other shadow utilities (`shadow-xl`, `shadow-2xl`, `shadow-none`) retain Tailwind's defaults. No namespace collision.
- Built CSS confirms the full resolution chain: `.shadow-md { --tw-shadow: var(--stgm-shadow-md) }` — Tailwind inserts a `--tw-` intermediate variable but the final computed `box-shadow` resolves through our token.

### Dark mode shadow opacity rationale

- Light mode shadows at `rgb(0 0 0 / 0.1)` are standard — 10% black on a bright surface produces a natural, subtle shadow.
- On dark surfaces (oklch 0.145 / ~15% lightness), 10% black shadow is nearly invisible — the shadow blends into the dark background.
- Increased to ~2.5x opacity (0.25-0.35) for dark mode. This matches the approach used by Material Design 3 and Stripe's dark mode.

### Per-preset shadow tuning approach

- **Corporate**: Higher opacity (+20% over base), standard Tailwind blur/offset geometry. Enterprise UIs benefit from clear card elevation — it reinforces the "solid, structured" feel.
- **Startup**: Reduced blur AND opacity (~40-60% of base). Linear and Vercel rely on borders more than shadows. The near-zero shadow lets the minimal aesthetic breathe.
- **Friendly**: Increased blur radius (+30% over base), slightly reduced opacity. More spread = softer edges = warmer feel. Matches Notion/Slack's gentle elevation language.
- **Fintech**: Reduced blur (~70% of base), slightly reduced spread. Tight shadows with clean edges = precision = premium financial aesthetic. Mirrors Stripe's crisp card shadows.

---

## 2026-03-16 - Task 4: Transition token design decisions

### Tailwind v4 transition theming via @theme inline

- Tailwind v4 `transition-*` utilities use a two-level fallback: `var(--tw-duration, var(--default-transition-duration))`. The `--tw-duration` is set by explicit `duration-*` utilities; `--default-transition-duration` is the global fallback.
- Overriding `--default-transition-duration` and `--default-transition-timing-function` in `@theme inline` replaces the fallback for ALL transition utilities at once. Zero component changes — every existing `transition-colors` automatically picks up the preset's timing.
- At build time, Tailwind v4 inlines the reference: the compiled CSS shows `var(--tw-duration, var(--stgm-transition-duration))` with no intermediate `--default-transition-*` variable. Clean chain.

### No dark mode overrides (deliberate)

- Motion is mode-agnostic. A 200ms ease-in-out transition feels identical on light and dark backgrounds — there's no perceptual equivalent to shadow opacity needing 2.5x boost on dark surfaces.
- Tokens set in `:root` and preset light selectors cascade into dark mode naturally via CSS inheritance.
- This simplifies the implementation: 2 tokens in `:root`, 2 overrides per preset (light selector only), vs shadows which required 6 overrides per preset (3 tiers x 2 modes).

### Per-preset motion character

- **Corporate** (200ms, standard `cubic-bezier(0.4, 0, 0.2, 1)`): Enterprise UIs (Azure, Salesforce) feel more deliberate. Slightly longer transitions reinforce the "considered, structured" brand impression. Standard easing — enterprise values predictability.
- **Startup** (100ms, `cubic-bezier(0, 0, 0.2, 1)` ease-out): Modern dev tools (Linear, Vercel, Raycast) feel instant. The ease-out curve means quick departure with gentle landing — interactions feel responsive without being jarring.
- **Friendly** (200ms, standard `cubic-bezier(0.4, 0, 0.2, 1)`): Consumer SaaS (Notion, Slack) feels unhurried and approachable. Same duration as Corporate but paired with warmer colors and rounder corners, creating a distinct feel through context rather than timing alone.
- **Fintech** (150ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`): Financial tools (Stripe, Mercury) feel precise. Tighter cubic-bezier with less dramatic ease-in — more linear feel that matches the "crisp, controlled" aesthetic. Duration matches base default because financial UIs shouldn't feel fast or slow — they should feel exact.

### Reduced-motion opportunity (deferred)

- SDK and Console have no `prefers-reduced-motion` handling. A future `@media (prefers-reduced-motion: reduce) { :root { --stgm-transition-duration: 0ms; } }` in `tokens.css` could centrally disable all token-based transitions for users who need it.
- Not adding now — separate concern, benefits from its own audit. Flagged for a11y pass.

---

