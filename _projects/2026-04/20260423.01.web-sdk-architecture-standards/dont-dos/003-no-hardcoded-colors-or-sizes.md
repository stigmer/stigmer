# Dont-Do 003: No Hardcoded Colors or Sizes

**Related**: DD-005 (Theme Token Compliance)

## The Rule

Never use hardcoded color values, font sizes, spacing values, border radii, or shadows in Stigmer components. Every visual property must flow through `--stgm-*` design tokens referenced via Tailwind utility classes.

## Why

Stigmer components are embedded into host applications that have their own design systems. A hardcoded `#3b82f6` (blue) or `text-[14px]` bypasses the token system and cannot be overridden by:

- Platform builders applying a custom theme to match their product's brand
- Preset switching (default, corporate, startup, friendly, fintech) that changes the entire visual identity
- Dark mode toggling that requires every color to have a corresponding dark variant

A component that "looks right" in the default preset with hardcoded values will break visually in any other context. This is not a cosmetic issue — it's a functional failure that makes the component unusable for platform builders.

## Detection

```bash
# Hardcoded colors (hex, rgb, hsl)
rg "#[0-9a-fA-F]{3,8}" sdk/react/src/ --glob '*.tsx' --glob '*.ts' --glob '!*.test.*'
rg "rgb\(|rgba\(|hsl\(|hsla\(" sdk/react/src/
rg "rgb\(|rgba\(|hsl\(|hsla\(" client-apps/web/src/ --glob '*.tsx'

# Hardcoded sizes in Tailwind arbitrary values
rg "\[[\d]+px\]|\[[\d]+rem\]" sdk/react/src/ --glob '*.tsx'
```

ESLint rules `stigmer/no-token-opacity-modifiers` and `stigmer/no-main-tokens-in-sidebar` catch the most common violations. `make lint` runs both.

## What To Do Instead

| Hardcoded Pattern | Token Alternative |
|---|---|
| `text-[#3b82f6]` | `text-primary` |
| `bg-[#f1f5f9]` | `bg-muted` |
| `text-[14px]` | `text-sm` (maps to `--stgm-font-size-sm`) |
| `border-[#e2e8f0]` | `border-border` |
| `rounded-[8px]` | `rounded-lg` (maps to `--stgm-radius`) |
| `shadow-[0_2px_4px_rgba(0,0,0,0.1)]` | `shadow-sm` |
| `text-gray-500` | `text-muted-foreground` |
| `bg-white` / `bg-black` | `bg-background` / `bg-foreground` |

If no suitable token exists for the visual property you need, propose a new token in `sdk/theme/src/tokens.css` with values defined for all presets. Do not work around a missing token with a hardcoded value.
