# @stigmer/theme

Design tokens, color presets, and utilities for Stigmer UI components.

## Install

```bash
npm install @stigmer/theme
```

Peer dependencies: `clsx`, `tailwind-merge`

## Tokens

Import the base token stylesheet to get all Stigmer design variables (light and dark mode):

```css
@import "@stigmer/theme/tokens.css";
```

This defines CSS custom properties on `:root` (light) and `[data-stgm-color-mode="dark"]` (dark mode). All properties use the `--stgm-*` namespace to avoid collisions with host application styles.

### Token Reference

#### Layout

| Token | Purpose |
|-------|---------|
| `--stgm-radius` | Base border radius |

#### Colors (Core)

| Token | Purpose |
|-------|---------|
| `--stgm-background` | Page / app background |
| `--stgm-foreground` | Default text color |
| `--stgm-primary` | Primary brand / action color |
| `--stgm-primary-foreground` | Text on primary |
| `--stgm-secondary` | Secondary surfaces |
| `--stgm-secondary-foreground` | Text on secondary |
| `--stgm-muted` | Muted / disabled surfaces |
| `--stgm-muted-foreground` | Text on muted |
| `--stgm-accent` | Accent highlights |
| `--stgm-accent-foreground` | Text on accent |

#### Colors (Semantic)

| Token | Purpose |
|-------|---------|
| `--stgm-destructive` | Destructive / error actions |
| `--stgm-destructive-foreground` | Text on destructive |
| `--stgm-success` | Success states |
| `--stgm-success-foreground` | Text on success |
| `--stgm-warning` | Warning states |
| `--stgm-warning-foreground` | Text on warning |
| `--stgm-info` | Informational states |
| `--stgm-info-foreground` | Text on info |

#### Colors (Surfaces)

| Token | Purpose |
|-------|---------|
| `--stgm-card` | Card background |
| `--stgm-card-foreground` | Card text |
| `--stgm-popover` | Popover / dropdown background |
| `--stgm-popover-foreground` | Popover text |

#### Colors (Form)

| Token | Purpose |
|-------|---------|
| `--stgm-border` | Default border color |
| `--stgm-input` | Input border color |
| `--stgm-ring` | Focus ring color |

#### Colors (Chart)

| Token | Purpose |
|-------|---------|
| `--stgm-chart-1` through `--stgm-chart-5` | Data visualization palette |

#### Colors (Sidebar)

| Token | Purpose |
|-------|---------|
| `--stgm-sidebar` | Sidebar background |
| `--stgm-sidebar-foreground` | Sidebar text |
| `--stgm-sidebar-primary` | Sidebar active item |
| `--stgm-sidebar-primary-foreground` | Text on sidebar active |
| `--stgm-sidebar-accent` | Sidebar hover / accent |
| `--stgm-sidebar-accent-foreground` | Text on sidebar accent |
| `--stgm-sidebar-border` | Sidebar border |
| `--stgm-sidebar-ring` | Sidebar focus ring |

## Design Language Presets

Stigmer ships with 5 design language presets. Each represents a real-world product category's visual DNA — not just a color swap, but a complete design language with different border radius, surface treatments, border styles, sidebar appearance, and color palette.

| Preset | Archetype | Import | CSS Class |
|--------|-----------|--------|-----------|
| Default | Stigmer's own identity | (built-in) | *(none)* |
| Corporate | Enterprise SaaS (Azure, Salesforce) | `@stigmer/theme/presets/corporate.css` | `stgm-theme-corporate` |
| Startup | Dev tools (Linear, Vercel) | `@stigmer/theme/presets/startup.css` | `stgm-theme-startup` |
| Friendly | Consumer SaaS (Notion, Intercom) | `@stigmer/theme/presets/friendly.css` | `stgm-theme-friendly` |
| Fintech | Premium financial (Stripe, Mercury) | `@stigmer/theme/presets/fintech.css` | `stgm-theme-fintech` |

Each preset overrides the full token surface — radius, all surface colors, borders, sidebar, and accent palette — for both light and dark modes.

### Using a Preset

1. Import the base tokens and the preset CSS:

```css
@import "@stigmer/theme/tokens.css";
@import "@stigmer/theme/presets/corporate.css";
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
import { THEME_PRESETS } from "@stigmer/theme";
// or
import { THEME_PRESETS } from "@stigmer/theme/presets";

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

A complete design language preset overrides the entire token surface:

- **Shape**: `--stgm-radius` (sharp `0.25rem` to very rounded `0.875rem`)
- **Surfaces**: `--stgm-background`, `--stgm-card`, `--stgm-popover`, `--stgm-muted`, `--stgm-secondary`, `--stgm-accent`
- **Text**: `--stgm-foreground`, `--stgm-card-foreground`, `--stgm-muted-foreground`, etc.
- **Accent**: `--stgm-primary` / `--stgm-primary-foreground`, `--stgm-ring`
- **Borders**: `--stgm-border`, `--stgm-input`
- **Sidebar**: `--stgm-sidebar`, `--stgm-sidebar-primary`, `--stgm-sidebar-accent`, `--stgm-sidebar-border`
- **Charts**: `--stgm-chart-1` through `--stgm-chart-5`

You can also create minimal presets that override only a subset of tokens.

### Color Format

All built-in tokens use [OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch) for perceptually uniform color manipulation. You can use any CSS color format in your overrides.

## Utilities

### `cn()` — Class Name Merge

Combines class names with Tailwind conflict resolution (powered by `clsx` + `tailwind-merge`):

```typescript
import { cn } from "@stigmer/theme";

<div className={cn("px-4 py-2", isActive && "bg-primary text-primary-foreground")} />
```

## Exports

| Export | Content |
|--------|---------|
| `@stigmer/theme` | `cn()`, `ClassValue`, `THEME_PRESETS`, `ThemePreset` |
| `@stigmer/theme/tokens.css` | Base CSS custom properties (light + dark) |
| `@stigmer/theme/presets` | `THEME_PRESETS` array and `ThemePreset` type |
| `@stigmer/theme/presets/corporate.css` | Corporate (Enterprise SaaS) design language |
| `@stigmer/theme/presets/startup.css` | Startup (Modern dev tools) design language |
| `@stigmer/theme/presets/friendly.css` | Friendly (Consumer SaaS) design language |
| `@stigmer/theme/presets/fintech.css` | Fintech (Premium financial) design language |

## License

Apache-2.0
