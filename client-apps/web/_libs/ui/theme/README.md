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

This defines CSS custom properties on `:root` (light) and `.dark` (dark mode). All properties use the `--stgm-*` namespace to avoid collisions with host application styles.

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

## Color Presets

Stigmer ships with 5 color presets. The **Default** preset is built into `tokens.css`. The remaining 4 are optional CSS files that override personality tokens (primary, ring, chart, sidebar-primary) while keeping structural tokens (background, foreground, border, etc.) unchanged.

| Preset | Import | CSS Class |
|--------|--------|-----------|
| Default | (built-in) | *(none)* |
| Rose | `@stigmer/theme/presets/rose.css` | `stgm-theme-rose` |
| Amber | `@stigmer/theme/presets/amber.css` | `stgm-theme-amber` |
| Violet | `@stigmer/theme/presets/violet.css` | `stgm-theme-violet` |
| Emerald | `@stigmer/theme/presets/emerald.css` | `stgm-theme-emerald` |

Each preset defines overrides for both light and dark modes (e.g., `.stgm-theme-rose` and `.stgm-theme-rose.dark`).

### Using a Preset

1. Import the base tokens and the preset CSS:

```css
@import "@stigmer/theme/tokens.css";
@import "@stigmer/theme/presets/rose.css";
```

2. Add the preset class to a root element:

```html
<html class="stgm-theme-rose">
```

For dark mode, both classes coexist:

```html
<html class="stgm-theme-rose dark">
```

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

.my-custom-theme.dark {
  --stgm-primary: oklch(0.75 0.18 220);
  --stgm-primary-foreground: oklch(0.145 0 0);
  --stgm-sidebar-primary: oklch(0.75 0.18 220);
  --stgm-sidebar-primary-foreground: oklch(0.145 0 0);
  --stgm-sidebar-ring: oklch(0.5 0.12 220);
}
```

Apply it the same way:

```html
<html class="my-custom-theme dark">
```

### Tokens That Define "Personality"

When creating a preset, focus on these tokens — they define the palette's character without affecting structural readability:

- `--stgm-primary` / `--stgm-primary-foreground`
- `--stgm-ring`
- `--stgm-sidebar-primary` / `--stgm-sidebar-primary-foreground`
- `--stgm-sidebar-ring`
- `--stgm-chart-1` through `--stgm-chart-5`

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
| `@stigmer/theme/presets/rose.css` | Rose preset overrides |
| `@stigmer/theme/presets/amber.css` | Amber preset overrides |
| `@stigmer/theme/presets/violet.css` | Violet preset overrides |
| `@stigmer/theme/presets/emerald.css` | Emerald preset overrides |

## License

Apache-2.0
