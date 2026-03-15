# @stigmer/theme

Design tokens (CSS custom properties) and utility functions for Stigmer UI components.

## Install

```bash
npm install @stigmer/theme
```

Peer dependencies: `clsx`, `tailwind-merge`

## Usage

### CSS tokens

Import the token stylesheet to get all Stigmer color variables (light and dark mode):

```css
@import "@stigmer/theme/tokens.css";
```

This provides `:root` and `.dark` CSS custom properties for all design tokens (`--background`, `--foreground`, `--primary`, etc.).

### `cn()` utility

Merge Tailwind CSS class names with conflict resolution:

```typescript
import { cn } from "@stigmer/theme";

<div className={cn("px-4 py-2", isActive && "bg-primary text-primary-foreground")} />
```

## Exports

- `cn(...inputs)` — class name merge utility (clsx + tailwind-merge)
- `ClassValue` — TypeScript type for `cn()` inputs
- `./tokens.css` — CSS custom properties for the Stigmer design system

## License

Apache-2.0
