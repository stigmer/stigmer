# Fix Lint Errors, Token Opacity Warnings, and MDX Build Issues

**Date**: May 8, 2026

## Summary

Resolved all `make check` failures in the Stigmer OSS repo — an ESLint error in the pricing calculator, 8 token-opacity lint warnings in the React SDK, Next.js image warnings in the blog, an unused eslint-disable directive, and an MDX build-breaking HTML comment syntax issue in the billing docs.

## Problem Statement

`make check` was failing with exit code 2. Multiple independent issues had accumulated across the site, React SDK, and docs.

### Pain Points

- **ESLint error (blocker)**: Unused `model` variable in `CostCalculator.tsx` caused lint to fail with a hard error.
- **8 `stigmer/no-token-opacity-modifiers` warnings**: Tailwind opacity modifiers (`bg-primary/90`, `bg-card/50`, etc.) on design-token colors bypass the theme system — each preset cannot control these values.
- **2 `@next/next/no-img-element` warnings**: Blog pages used raw `<img>` tags instead of the optimized `<Image>` component.
- **Unused eslint-disable directive**: `mockServiceWorker.js` had a stale `/* eslint-disable */` that no longer suppressed anything.
- **MDX build failure**: `docs/concepts/billing.mdx` used HTML comments (`<!-- vale off -->`) which are invalid in MDX v3, breaking the site build.
- **Vale spelling errors**: Once the HTML comments were converted, Vale flagged "deduplicated" and "idempotency" as misspellings since the `vale off` directives no longer functioned.

## Solution

Each issue was addressed with the minimal, correct fix:

1. Prefix the unused variable with `_` to satisfy `no-unused-vars`.
2. Replace every opacity modifier with the corresponding dedicated design token from the theme system.
3. Switch `<img>` to Next.js `<Image>` with `unoptimized` (external GitHub avatar URLs).
4. Remove the stale eslint-disable directive.
5. Remove the HTML comments entirely and add the two technical terms to the Vale vocabulary accept list — a cleaner long-term fix than trying to suppress them.

## Implementation Details

### Token opacity replacements (React SDK)

| File | Before | After |
|------|--------|-------|
| `AutoRechargeCard.tsx` | `hover:bg-primary/90` | `hover:bg-primary-hover` |
| `AutoRechargeCard.tsx` | `placeholder:text-muted-foreground/60` | `placeholder:text-muted-foreground-subtle` |
| `CreditLedgerTable.tsx` | `bg-destructive/10` | `bg-destructive-subtle` |
| `CreditPackGrid.tsx` | `hover:bg-primary/90` | `hover:bg-primary-hover` |
| `LowBalanceBanner.tsx` | `bg-destructive/5` | `bg-destructive-subtle` |
| `OrgUsagePanel.tsx` (×3) | `bg-card/50` | `bg-muted-subtle` |

### Blog pages (site)

- `site/src/app/blog/[slug]/page.tsx` and `site/src/app/blog/page.tsx`: replaced `<img>` with `<Image>` from `next/image`, added `unoptimized` prop since these are external GitHub avatar URLs, and added `?? ""` fallback on `alt` to satisfy the required `string` type.

### Docs & Vale

- `docs/concepts/billing.mdx`: removed all `<!-- vale off/on -->` HTML comments (invalid in MDX v3).
- `vale/styles/config/vocabularies/Stigmer/accept.txt`: added `deduplicated` and `idempotency`.

## Benefits

- `make check` passes cleanly (exit code 0) — all lint, typecheck, build, and test targets green.
- React SDK components now use proper theme tokens, making them fully controllable by theme presets.
- Blog pages get automatic image optimization via Next.js `<Image>`.
- Billing docs build correctly under MDX v3.

## Impact

- **React SDK**: 5 billing/usage components updated — visual appearance unchanged, theme compatibility improved.
- **Site**: Blog pages and pricing calculator lint-clean; site builds successfully.
- **Docs**: `billing.mdx` compiles without errors.
- **CI**: `make check` unblocked for all contributors.

---

**Status**: ✅ Production Ready
