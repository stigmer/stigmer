# Dont-Do 004: No Opacity Modifiers on Design Tokens

**Related**: DD-005 (Theme Token Compliance)

## The Rule

Never use Tailwind opacity modifiers (`/60`, `/50`, `/10`, etc.) on design-token color classes to create color variants. Use dedicated token variants instead.

## Why

Opacity modifiers hard-bake a mathematical relationship between a base token and its variant. When a preset defines `sidebar-foreground` as a dark color, applying `/60` produces a 60%-opacity version — which may be appropriate. But when a different preset defines `sidebar-foreground` as a light color (e.g., in a dark-sidebar theme), that same `/60` produces a washed-out, low-contrast result.

Each preset needs independent control over the exact color value of muted, hover, active, and other variant states. Opacity modifiers remove that control by deriving the variant from the base, rather than letting each preset define the variant directly.

This is not a theoretical concern — it manifests concretely in the Corporate and Fintech presets, which use contrasting sidebar and main-area surfaces.

## Detection

```bash
# Opacity modifiers on token-based Tailwind classes
rg "text-sidebar-[a-z-]+/\d+" sdk/react/src/ client-apps/web/src/
rg "bg-sidebar-[a-z-]+/\d+" sdk/react/src/ client-apps/web/src/
rg "text-[a-z]+-foreground/\d+" sdk/react/src/ client-apps/web/src/
rg "bg-[a-z]+/\d+" sdk/react/src/ client-apps/web/src/
```

ESLint rule `stigmer/no-token-opacity-modifiers` catches this automatically via `make lint`.

## What To Do Instead

| Wrong | Right |
|---|---|
| `text-sidebar-foreground/60` | `text-sidebar-muted-foreground` |
| `bg-sidebar-foreground/10` | `bg-sidebar-muted` |
| `text-foreground/50` | `text-muted-foreground` |
| `bg-primary/20` | `bg-primary/20` only if `primary` is NOT a design token — but if it is, propose a `bg-primary-muted` token |
| `border-border/50` | Propose a `border-border-muted` token if one doesn't exist |

**When no variant token exists**: Propose adding one to `sdk/theme/src/tokens.css`. Define its value for all presets (default, corporate, startup, friendly, fintech) and for both light and dark modes. Then add the Tailwind bridge in `globals.css`. This is more work than appending `/60`, but it produces a result that works correctly across all presets.
