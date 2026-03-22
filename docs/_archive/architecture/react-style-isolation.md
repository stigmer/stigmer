# React Style Isolation

How `@stigmer/react` prevents CSS side effects when embedded in third-party applications.

## Problem

Stigmer's React components use Tailwind CSS internally. When a host application imports `@stigmer/react/styles.css`, three categories of style leakage can occur:

1. **Cascade conflicts** — Stigmer utility classes override host styles at equal specificity
2. **Token collisions** — Generic CSS custom properties like `--background` clash with host variables
3. **Preflight leakage** — Tailwind's CSS reset strips margins, borders, and list styles from the entire page

## Solution

Three complementary mechanisms prevent all three categories:

### CSS Cascade Layers

All Stigmer CSS is wrapped in `@layer stgm`. CSS Cascade Layers give un-layered CSS automatic precedence over layered CSS at equal specificity. Since host applications typically write un-layered CSS, their styles always win.

```
Host CSS (un-layered)     → wins at equal specificity
@layer stgm (Stigmer)     → lower cascade priority
```

This is achieved through granular Tailwind imports:

```css
@layer stgm;

@import "tailwindcss/theme.css" layer(stgm);
@import "tailwindcss/utilities.css" layer(stgm);
@import "@stigmer/theme/tokens.css" layer(stgm);
```

### Namespaced Design Tokens

All CSS custom properties in `@stigmer/theme` use a `--stgm-` prefix:

```css
:root {
  --stgm-background: oklch(1 0 0);
  --stgm-primary: oklch(0.55 0.12 190);
  --stgm-radius: 0.625rem;
  --stgm-border: oklch(0.922 0 0);
}
```

Host applications can define `--background`, `--primary`, or any generic variable without collisions. Stigmer components reference their tokens through Tailwind's `@theme inline` mapping:

```css
@theme inline {
  --color-background: var(--stgm-background);
  --color-primary: var(--stgm-primary);
}
```

### Scoped Preflight

Tailwind's `preflight.css` is **not imported**. Instead, a minimal reset applies only within the `.stgm` container:

```css
@layer stgm {
  .stgm {
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .stgm *,
  .stgm *::before,
  .stgm *::after {
    box-sizing: border-box;
    border-width: 0;
    border-style: solid;
  }
}
```

The host page's global typography, margins, and list styles are never affected.

## StigmerProvider Container

`StigmerProvider` renders a `<div class="stgm">` wrapper that serves as the scoping boundary:

```tsx
import { StigmerProvider } from '@stigmer/react';
import '@stigmer/react/styles.css';

function App() {
  return (
    <StigmerProvider client={stigmerClient}>
      <AgentChatWidget agentId="my-agent" />
    </StigmerProvider>
  );
}
```

All Stigmer components must be descendants of this provider. The scoped reset and design tokens only apply within the `.stgm` boundary.

## Theming

Override Stigmer's visual appearance by setting `--stgm-*` variables on the `.stgm` container or any ancestor:

```css
.stgm {
  --stgm-primary: oklch(0.6 0.2 270);
  --stgm-radius: 0.5rem;
}
```

Dark mode is activated by adding the `dark` class to an ancestor element, following the same pattern as the Stigmer console.

## Guarantees

| Category | Guarantee |
|----------|-----------|
| Cascade | Host CSS at equal specificity always wins over Stigmer CSS |
| Tokens | No generic CSS variable names — all prefixed with `--stgm-` |
| Preflight | No global reset — scoped to `.stgm` container only |
| Bundle | CSS file preserved by bundlers via `sideEffects: ["*.css"]` |

## Technical Details

- Built on [CSS Cascade Layers](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer) (supported in all modern browsers)
- Uses Tailwind CSS v4's granular import system (`tailwindcss/theme.css`, `tailwindcss/utilities.css`)
- The `@layer stgm` declaration must appear before any imports to establish layer order
- Components use standard Tailwind utility classes internally — no special syntax required
