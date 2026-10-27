# @stigmer/design-tokens

Design tokens, color presets, and utilities for Stigmer UI components.

## Install

```bash
npm install @stigmer/design-tokens
```

Peer dependencies: `clsx`, `tailwind-merge`

## Tokens

Import the base token stylesheet to get all Stigmer design variables (light and dark mode):

```css
@import "@stigmer/design-tokens/tokens.css";
```

This defines CSS custom properties on `:root` (light) and `[data-stgm-color-mode="dark"]` (dark mode). All properties use the `--stgm-*` namespace to avoid collisions with host application styles.

### Token Reference

The complete token contract — every token with its purpose, light/dark
defaults, and swatches — is documented at
[stigmer.ai/docs/sdk/theme/tokens](https://stigmer.ai/docs/sdk/theme/tokens).
That reference is generated directly from `src/tokens.css`, so it can never
drift from the shipped values. The token groups:

- **Typography** — `--stgm-font-sans`, `--stgm-font-mono`, and the type scale (below)
- **Spacing** — `--stgm-spacing`, the unit every padding, margin and gap is a multiple of
- **Shape** — `--stgm-radius` (the whole radius scale derives from it)
- **Core surfaces & text** — background/foreground, card, popover, primary, secondary, muted, accent (each with its `-foreground` pair)
- **Semantic colors** — destructive, success, warning, info
- **Forms & focus** — border, input, input-bg, ring
- **Charts** — 5 categorical series + named chart colors
- **Emphasis & elevation** — prominent borders, shadow scale
- **Motion & layering** — transition duration/easing, popover z-index
- **State shades** — hover/subtle/muted/faint variants of the core colors
- **Sidebar** — a self-contained token context for contrasting sidebars
- **Status** — ready/running/pending/degraded/failed/disabled/draft, each with `-foreground` and `-subtle`
- **Diff viewer** and **Syntax highlighting** token sets

Default token values are contrast-audited in CI: `src/contract/` measures
every declared text/surface pairing (WCAG 2.1 AA for text, a documented
lightness-delta floor for borderless surfaces) across all presets and both
color modes. Run `npx tsx scripts/contrast-report.ts` in this package to see
the full matrix.

### Type scale

Every text size is a step of one scale, each a token with its line height:

| Step | Size | Use |
|------|------|-----|
| `2xs` | 11px | dense metadata only: badges, counters, key hints. The floor: nothing is drawn smaller |
| `xs` | 12px | metadata and supporting text: timestamps, captions, dense table cells |
| `sm` | 14px | body text in panels, labels, controls |
| `base` | 16px | reading text: message bodies, long prose |
| `lg` | 18px | section titles |
| `xl` | 20px | page titles |
| `2xl` | 24px | prominent figures, empty-state headings |
| `3xl` | 30px | display headings |

`--stgm-text-<step>` holds the size and `--stgm-leading-<step>` its line
height. A preset or a host may retune a step; none may go under 11px. The
kit, the console and the desktop app write sizes only as these steps
(`stg:text-xs`); the `stigmer/text-size-from-scale` lint rule refuses a size
picked by hand (`text-[10px]`, an inline `fontSize: "13px"`).

### Tailwind mapping

`@stigmer/design-tokens/tailwind-theme.css` is Tailwind v4's theme read from
these tokens: colours, radius, the type scale, the spacing unit, shadows and
motion, as one `@theme inline` block. Import it after Tailwind and
`tokens.css`, and every utility reads its token, so a preset restyles it:

```css
@import "tailwindcss";
@import "@stigmer/design-tokens/tokens.css";
@import "@stigmer/design-tokens/tailwind-theme.css";
```

## Design Language Presets

Stigmer ships with 6 design language presets. Each represents a real-world product category's visual DNA — not just a color swap, but a complete design language with different border radius, surface treatments, border styles, sidebar appearance, and color palette.

| Preset | Archetype | Import | CSS Class |
|--------|-----------|--------|-----------|
| Default | Stigmer's own look: black and white, typographic, sharp | (built-in) | *(none)* |
| Corporate | Enterprise SaaS (Azure, Salesforce) | `@stigmer/design-tokens/presets/corporate.css` | `stgm-theme-corporate` |
| Startup | Dev tools (Linear, Vercel) | `@stigmer/design-tokens/presets/startup.css` | `stgm-theme-startup` |
| Friendly | Consumer SaaS (Notion, Intercom) | `@stigmer/design-tokens/presets/friendly.css` | `stgm-theme-friendly` |
| Fintech | Premium financial (Stripe, Mercury) | `@stigmer/design-tokens/presets/fintech.css` | `stgm-theme-fintech` |
| Monochrome | The default look, named (kept for code that sets it) | `@stigmer/design-tokens/presets/monochrome.css` | `stgm-theme-monochrome` |

Each preset overrides most of the token surface — radius, surface colors, borders, sidebar, and accent palette — for both light and dark modes, and falls through to the defaults for anything it leaves alone. The defaults are Stigmer's own black-and-white look, with hue only in the status, diff and syntax colors; Monochrome adds nothing to them. The full per-preset override tables are at [stigmer.ai/docs/sdk/theme/presets](https://stigmer.ai/docs/sdk/theme/presets).

### Using a Preset

1. Import the base tokens and the preset CSS:

```css
@import "@stigmer/design-tokens/tokens.css";
@import "@stigmer/design-tokens/presets/corporate.css";
```

2. Add the preset class to a root element:

```html
<html class="stgm-theme-corporate">
```

Dark mode is controlled by the `data-stgm-color-mode` attribute, which `StigmerProvider` sets automatically from its `colorMode` prop. Preset dark tokens activate when `data-stgm-color-mode="dark"` is present on the same element or an ancestor.

3. All components consuming `--stgm-*` variables automatically pick up the new colors.

### Preset Metadata (TypeScript)

The preset list is available as a typed constant for building UI selectors:

```typescript
import { THEME_PRESETS } from "@stigmer/design-tokens";
// or
import { THEME_PRESETS } from "@stigmer/design-tokens/presets";

// THEME_PRESETS is an array of:
// { id: string, name: string, className: string, description: string, swatch: string }
```

## Custom Theming

You can create your own theme by overriding `--stgm-*` variables. Only override the tokens you want to change — everything else falls through to the defaults.

```css
.my-custom-theme {
  --stgm-primary: oklch(0.6 0.2 220);
  --stgm-primary-foreground: oklch(0.985 0 0);
  --stgm-ring: oklch(0.55 0.15 220);
  --stgm-sidebar-primary: oklch(0.6 0.2 220);
  --stgm-sidebar-primary-foreground: oklch(0.985 0 0);
  --stgm-sidebar-ring: oklch(0.55 0.15 220);
}

.my-custom-theme[data-stgm-color-mode="dark"],
[data-stgm-color-mode="dark"] .my-custom-theme {
  --stgm-primary: oklch(0.75 0.18 220);
  --stgm-primary-foreground: oklch(0.145 0 0);
  --stgm-sidebar-primary: oklch(0.75 0.18 220);
  --stgm-sidebar-primary-foreground: oklch(0.145 0 0);
  --stgm-sidebar-ring: oklch(0.5 0.12 220);
}
```

Apply via `className` on `StigmerProvider`:

```tsx
<StigmerProvider client={client} className="my-custom-theme" colorMode="dark">
  {children}
</StigmerProvider>
```

### What a Full Preset Overrides

A complete design language preset overrides most of the token surface:

- **Shape**: `--stgm-radius` (sharp `0.125rem` in Fintech to very rounded `1.25rem` in Friendly)
- **Surfaces**: `--stgm-background`, `--stgm-card`, `--stgm-popover`, `--stgm-muted`, `--stgm-secondary`, `--stgm-accent`
- **Text**: `--stgm-foreground`, `--stgm-card-foreground`, `--stgm-muted-foreground`, etc.
- **Accent**: `--stgm-primary` / `--stgm-primary-foreground`, `--stgm-ring`
- **Borders**: `--stgm-border`, `--stgm-input`
- **Sidebar**: `--stgm-sidebar`, `--stgm-sidebar-primary`, `--stgm-sidebar-accent`, `--stgm-sidebar-border`
- **Charts**: `--stgm-chart-1` through `--stgm-chart-5`

You can also create minimal presets that override only a subset of tokens.

If your preset defines a token in its light block, define its dark value
too: preset-light declarations outrank the default dark block in the
cascade, so a light-only override would leak into dark mode. The theme
package's contract tests flag this automatically for built-in presets.

### Color Format

All built-in tokens use [OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) for perceptually uniform color manipulation. You can use any CSS color format in your overrides.

## Utilities

### `cn()` — Class Name Merge

Combines class names with Tailwind conflict resolution (powered by `clsx` + `tailwind-merge`):

```typescript
import { cn } from "@stigmer/design-tokens";

<div className={cn("px-4 py-2", isActive && "bg-primary text-primary-foreground")} />
```

## Exports

| Export | Content |
|--------|---------|
| `@stigmer/design-tokens` | `cn()`, `ClassValue`, `THEME_PRESETS`, `ThemePreset` |
| `@stigmer/design-tokens/tokens.css` | Base CSS custom properties (light + dark) |
| `@stigmer/design-tokens/tailwind-theme.css` | Tailwind v4 theme mapping read from the tokens |
| `@stigmer/design-tokens/presets` | `THEME_PRESETS` array and `ThemePreset` type |
| `@stigmer/design-tokens/presets/corporate.css` | Corporate (Enterprise SaaS) design language |
| `@stigmer/design-tokens/presets/startup.css` | Startup (Modern dev tools) design language |
| `@stigmer/design-tokens/presets/friendly.css` | Friendly (Consumer SaaS) design language |
| `@stigmer/design-tokens/presets/fintech.css` | Fintech (Premium financial) design language |
| `@stigmer/design-tokens/presets/monochrome.css` | Monochrome: the default look, named |

## License

Apache-2.0
