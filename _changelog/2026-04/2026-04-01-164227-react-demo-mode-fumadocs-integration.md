# React Demo Mode: Fumadocs Integration

**Date**: April 1, 2026

## Summary

Integrated `@stigmer/react` components into the Fumadocs documentation site
using the demo infrastructure from Phases 1 & 2. Documentation pages can now
embed live, interactive Stigmer UI components backed by in-memory mock data —
no live backend required. Also diagnosed and resolved a pre-existing `next build`
failure caused by a Node.js 23 webpack bug.

## Problem Statement

The documentation site needed to show real `@stigmer/react` components in action
rather than static screenshots or code snippets. Phases 1 & 2 built the mock
transport and fixture infrastructure inside `@stigmer/react/demo`, but the docs
site had no way to consume those packages or render the components.

### Pain Points

- The `site/` package was standalone (yarn 4), completely disconnected from the
  monorepo's npm workspace packages
- No mechanism existed to import `@stigmer/react`, `@stigmer/theme`, or
  `@stigmer/sdk` into the site
- Stigmer design tokens and component styles were not loaded in the docs CSS
  pipeline
- MDX pages had no way to embed custom React components from the SDK
- The `next build` command was silently failing on Node.js 23 (pre-existing)

## Solution

Bridged the standalone site to workspace packages using yarn `file:` protocol
dependencies with Next.js `transpilePackages`, created a reusable MDX wrapper
pattern for demo components, and pinned the Node.js version to resolve the build
failure.

## Implementation Details

### Dependency Bridge

Added `@stigmer/react`, `@stigmer/sdk`, `@stigmer/theme`, and `@stigmer/protos`
to `site/package.json` using `file:` protocol (`"@stigmer/react": "file:../sdk/react"`).
Yarn 4 creates portal links that resolve directly to workspace source. Added
`transpilePackages` in `next.config.ts` so Next.js runs SWC on the TypeScript
source files.

### CSS Integration

Imported `@stigmer/theme/tokens.css` (design tokens) and `@stigmer/react/styles.css`
(component styles) in `globals.css` after Fumadocs CSS. Added a `@source` directive
so Tailwind CSS v4 scans `@stigmer/react` component files for utility classes.

### MDX Wrapper Pattern

Created `DemoSessionComposer` as a `"use client"` component in
`site/src/components/docs/demos/`. The pattern:

1. Create an empty `DemoScenario` (or use `buildScenario()` with fixtures)
2. Instantiate a `createDemoClient(scenario)` via `useMemo`
3. Wrap the target component in `StigmerProvider`
4. Use `not-prose` class to escape Fumadocs typography

Registered the component in `getMDXComponents` so it's available as
`<DemoSessionComposer />` in any MDX file.

### Build Fix

Diagnosed a pre-existing `next build` failure: Node.js v23.1.0 causes the webpack
client compiler to exit immediately after starting (event loop drains). The server
compiler completes (~8s, producing 67 chunks) but the client compiler dies with
exit code 0. Used `DEBUG=next:*` to trace the exact failure point. Fix: pinned
`engines` to `^20.11.0 || ^22.0.0` in `package.json`.

## Benefits

- **Live component demos in docs**: Documentation pages show real, interactive
  Stigmer UI components instead of static images
- **Zero backend dependency**: Demo components render entirely from in-memory
  mock data via the Phase 1/2 infrastructure
- **Reusable pattern**: The MDX wrapper pattern scales to any `@stigmer/react`
  component — create a wrapper, register it, use it in MDX
- **Build reliability**: Pinned Node.js version prevents silent build failures
- **Style isolation**: Stigmer tokens and styles load cleanly alongside Fumadocs
  via `@layer stgm` scoping

## Impact

- **Documentation team**: Can now embed live component demos in any MDX page
- **Platform builders**: See real components in documentation, not mockups
- **CI/CD**: Build is reliable with the Node.js version constraint
- **Parent project**: Unblocks Phase 3 of the content-strategy project, which
  depends on this integration being functional

## Related Work

- [React Demo Mode: Transport & Client Factory](2026-04-01-151243-react-demo-mode-transport-and-client-factory.md) — Phase 1
- [React Demo Mode: Composable Fixture Infrastructure](2026-04-01-154201-react-demo-mode-composable-fixture-infrastructure.md) — Phase 2
- Parent project: `_projects/2026-03/20260331.01.content-strategy`

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (including build diagnosis)
