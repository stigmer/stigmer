# @stigmer/react README — Integration Guide for Platform Builders

**Date**: March 16, 2026

## Summary

Created the `@stigmer/react` README, providing platform builders with a complete integration guide for embedding Stigmer's pre-built agent UI components into their React applications. This is the final task in the theme-system-gaps project, documenting everything built across the preceding five tasks.

## Problem Statement

The `@stigmer/react` package had no README. Platform builders — React developers integrating Stigmer components into their products — had zero guidance on installation, provider setup, theming, or available components.

### Pain Points

- No install instructions or peer dependency list — builders had to reverse-engineer `package.json`.
- The `StigmerProvider` component and its `preset` prop (added in Task 2 of this project) were undocumented.
- The style isolation architecture (`@layer stgm`, `.stgm` container scoping, `--stgm-*` namespacing) existed only in code comments — builders had no way to know their host styles were safe.
- The six subpath exports (`@stigmer/react/agent`, `session`, `agent-execution`, `catalog`, `skill`, `mcp-server`) and their 20+ components and hooks were not listed anywhere.
- Custom theming via `--stgm-*` token overrides — including the new shadow, transition, and z-index tokens from Tasks 3–5 — had no React-level documentation.
- The `@stigmer/theme` README covered the CSS-level API but not the React integration surface.

## Solution

Created `sdk/react/README.md` with nine sections following the tone and structure of the existing `@stigmer/theme` README — concise, code-heavy, no marketing fluff.

## Implementation Details

### README Structure

1. **Package description** — one-liner positioning the package.
2. **Install** — `npm install` command and peer dependencies table (10 peers with version constraints).
3. **Quick Start** — minimal working example: `Stigmer` client instantiation, `StigmerProvider` with preset, `AgentPicker` component, stylesheet import.
4. **Provider** — `StigmerProviderProps` reference table (`client`, `preset`, `className`) and `useStigmer()` hook usage with error behavior.
5. **Theming** — four subsections:
   - Built-in presets table (default, corporate, startup, friendly, fintech) with archetype descriptions.
   - Custom token overrides with a CSS example demonstrating color, radius, shadow, and transition tokens with both light and dark mode selectors.
   - Dark mode explanation covering the descendant selector pattern (`&:is(.dark *)`).
   - Token categories summary table covering all categories including the new shadow/transition/z-index tokens.
6. **Style Isolation** — three-point explanation: CSS layer scoping, container scoping, token namespacing.
7. **Components and Hooks** — per-subpath tables for all six domain exports with every exported component, hook, and utility.
8. **Exports** — quick-reference table of all eight import paths.
9. **License**.

### Cross-referencing Strategy

The README deliberately does not duplicate the full token reference table from `@stigmer/theme`. Instead, it provides a categories summary and links to the theme README via relative path (`../theme/README.md`). This avoids maintenance drift between the two documents.

### Accuracy Verification

Every export listed in the component tables was verified against the actual barrel export files (`src/agent/index.ts`, `src/session/index.ts`, `src/agent-execution/index.ts`, `src/catalog/index.ts`, `src/skill/index.ts`, `src/mcp-server/index.ts`). Peer dependency versions match `package.json` exactly.

## Benefits

- Platform builders can integrate `@stigmer/react` without reading source code.
- The theming section demonstrates the full customization surface — presets, custom tokens, dark mode — in one place.
- Style isolation documentation gives builders confidence that Stigmer won't break their host application.
- The component catalog provides discoverability for the SDK's full surface area.

## Impact

- **Who**: Platform builders embedding Stigmer agent UIs into their React applications.
- **What**: Complete integration documentation where none existed before.
- **Scope**: 1 new file (`sdk/react/README.md`, ~250 lines), 2 updated project tracking files.

## Related Work

- [Theme Color Presets](2026-03-16-163628-theme-color-presets-for-stigmer-components.md) — the preset system documented in the theming section
- [React Style Isolation](2026-03-16-145326-react-style-isolation-for-embeddable-components.md) — the `@layer stgm` architecture documented in the style isolation section
- [Shadow Elevation Tokens](2026-03-16-182033-shadow-elevation-tokens-for-theme-system.md) — shadow tokens referenced in the token categories table
- [Transition Tokens](2026-03-16-183714-transition-tokens-for-theme-system.md) — transition tokens referenced in the token categories table
- [Z-index Popover Token](2026-03-16-185134-z-index-popover-token-for-theme-system.md) — z-index token referenced in the token categories table
- [StigmerProvider Preset Prop](2026-03-16-180112-stigmer-provider-preset-prop-and-dark-mode-css-fix.md) — the `preset` prop documented in the provider section

---

**Status**: ✅ Production Ready
**Timeline**: Single session — final task in the theme-system-gaps project (6 of 6)
