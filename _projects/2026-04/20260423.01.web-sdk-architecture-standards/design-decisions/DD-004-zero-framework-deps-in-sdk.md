# DD-004: Zero Framework Dependencies in SDK

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — Mandate #1 (SDK-First Development), third bullet

## Context

`@stigmer/react` is consumed by platform builders who run React in diverse environments: Next.js (App Router and Pages Router), Vite, Remix, Gatsby, Create React App, Electron, and custom webpack setups. Each environment has its own routing system, auth patterns, server-side rendering behavior, and build pipeline.

If SDK components import from framework-specific packages (e.g., `next/router`, `next/image`, `next-themes`), they break in every non-Next.js environment. Even within Next.js, assumptions about App Router vs. Pages Router create compatibility issues. The SDK becomes tightly coupled to one consumer's infrastructure choices.

This coupling also flows in reverse: if SDK components depend on Console-specific context (auth state, org context, layout hooks), they cannot function outside the Console without mocking that entire context tree.

## Decision

`@stigmer/react` has zero dependencies on:

- **Next.js** — No imports from `next/*` (`next/router`, `next/navigation`, `next/image`, `next/link`, `next/font`, `next-themes`)
- **Console routing** — No assumptions about URL structure, route params, or navigation patterns. Components receive identifiers as props, not from route context.
- **Console auth** — No imports from Console auth modules. SDK components receive an authenticated `Stigmer` client via `useStigmer()` — they do not know or care how authentication was performed.
- **Console layout** — No assumptions about sidebar, top bar, page shell, or responsive breakpoints managed by the Console. SDK components are self-contained within their rendered boundaries.
- **Console-specific contexts** — No imports from `client-apps/web/src/contexts/` or any `@/` path aliases that resolve to Console internals.

The only React dependency is `react` and `react-dom` as peer dependencies. The only Stigmer dependencies are `@stigmer/sdk` (for API clients) and `@stigmer/theme` (for design tokens).

## Consequences

- **SDK components work in any React environment.** A platform builder using Vite + React Router gets the same components as the Stigmer Console on Next.js.
- **Navigation is the consumer's responsibility.** An SDK component that needs to link somewhere (e.g., "View Agent Details") emits an event or calls a callback prop — it does not call `router.push()`. The Console (or any host app) handles the navigation.
- **Image optimization is the consumer's responsibility.** SDK components use standard `<img>` elements or accept image components as props. They do not use `next/image`.
- **SSR compatibility is explicit.** SDK components that require browser APIs (WebSocket, DOM measurement) must handle SSR gracefully with `useEffect` guards or explicit `"use client"` directives at the component level — not by depending on a framework's SSR infrastructure.
- **The Console bridges the gap.** `client-apps/web/src/providers/` contains the bridge code that connects Console infrastructure (Next.js auth, routing, environment config) to the SDK's framework-agnostic interface. This bridge code is Console-only and never published.

## Enforcement

- ESLint rule: `sdk-import-boundaries` — forbids `next/*` and `@/` imports inside `sdk/react/src/` (Workstream C)
- Detection: `rg "from 'next/" sdk/react/src/` must return zero results
- Detection: `rg "from '@/" sdk/react/src/` must return zero results
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-004)
