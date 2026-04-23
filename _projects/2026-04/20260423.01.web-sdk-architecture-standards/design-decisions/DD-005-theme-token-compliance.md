# DD-005: Theme Token Compliance

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — Mandate #10 (Theme Token Compliance), "The Theme System" section; `.cursor/rules/client-apps/web/theme-token-guidelines.mdc`

## Context

Stigmer components are embedded into host applications with their own design systems — corporate dashboards, startup products, fintech platforms. Each host application has its own color palette, typography, spacing, and visual identity. If Stigmer components use hardcoded visual values, they clash with the host application and cannot be rebranded.

Beyond embeddability, Stigmer's own preset system (default, corporate, startup, friendly, fintech) requires that every visual property be overridable per-preset. A component that "looks right" in the default preset but hardcodes a color will break in presets with different surface contrasts (e.g., Corporate's dark sidebar against Fintech's light sidebar).

Style isolation is equally critical. Stigmer's CSS must not leak into the host application's global styles, and the host application's CSS must not accidentally override Stigmer internals.

## Decision

All visual properties in Stigmer components flow through the `--stgm-*` CSS custom property system:

- **Namespaced tokens** — Every CSS custom property uses the `--stgm-*` prefix to avoid collisions with host application styles.
- **Container scoping** — Stigmer styles are scoped to the `.stgm` container class. Components outside `.stgm` are unaffected.
- **Layer isolation** — Stigmer styles are placed in `@layer stgm`, a low-priority CSS layer that host application styles can override by simply writing unscoped CSS (which sits above all layers).
- **Token context awareness** — Components use the correct token family for their rendering context: `sidebar-*` tokens in the sidebar, standard tokens in the main content area, `popover-*` tokens in portaled content.
- **No hardcoded visual values** — Colors, font sizes, spacing, border radii, and shadows must reference `--stgm-*` tokens through Tailwind utility classes. A component that bypasses the token system will not respect the host application's theme.
- **No opacity modifiers on tokens** — Tailwind opacity modifiers (`/60`, `/50`) on token-based classes break preset independence. Each preset needs direct control over muted/variant values. Use dedicated token variants (e.g., `text-sidebar-muted-foreground`) instead.

## Consequences

- **Components are automatically theme-able.** Platform builders select a preset or override individual `--stgm-*` tokens to match their brand. No component code changes needed.
- **Preset switching is safe.** Because every visual property flows through tokens, switching from the default preset to corporate or fintech changes the entire visual appearance without breaking any component.
- **Style isolation is guaranteed.** The `.stgm` scope + `@layer stgm` combination ensures Stigmer's styles neither leak into nor are accidentally overridden by the host application.
- **Missing tokens must be proposed, not worked around.** If a component needs a visual variant that has no corresponding token, the correct action is to add a new token to `sdk/theme/src/tokens.css` with values for all presets — not to use an opacity modifier or hardcoded value as a shortcut.
- **Dark mode is host-controlled.** Dark mode activates via `.dark` ancestor class using `@custom-variant`, not media queries. The host application decides light vs. dark — Stigmer components react to that decision through token values.

## Enforcement

- ESLint rule: `stigmer/no-token-opacity-modifiers` — flags opacity modifiers on design-token classes
- ESLint rule: `stigmer/no-main-tokens-in-sidebar` — flags main-area tokens used in sidebar-context files
- `make lint` runs both rules as part of the standard development workflow
- Cursor rule: `.cursor/rules/client-apps/web/theme-token-guidelines.mdc` (detailed token reference)
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-005)

## Cross-References

For the complete token reference, context-specific patterns, and interactive element overrides, see `.cursor/rules/client-apps/web/theme-token-guidelines.mdc`. This design decision establishes the principle; that rule provides the operational details.
