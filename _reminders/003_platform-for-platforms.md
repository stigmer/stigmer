# Reminder: Stigmer Is a Platform for Platforms

Every line of UI code must answer one question: **"Would a platform builder embedding Stigmer into their product need this?"** If yes, it belongs in the SDK packages — not client-apps/web.

## Layered Architecture (Non-Negotiable)

| Layer | Package | Responsibility |
|---|---|---|
| **API clients** | `@stigmer/sdk` | Typed API clients from protobuf. Never raw fetch, never hand-rolled types. |
| **React hooks + components** | `@stigmer/react` | Data hooks, behavior hooks, then styled components. Headless-first. Zero Console dependencies (no Next.js routing, no app-shell auth, no layout assumptions). |
| **Design tokens** | `@stigmer/theme` | All visual properties flow through `--stgm-*` tokens, scoped to `.stgm` container and `@layer stgm`. No hardcoded colors, sizes, or fonts. |
| **Console** | `client-apps/web` | Console-only concerns: routing, app shell, page layout. It consumes the SDK; it is not the product. |

**The Console is a reference implementation. The SDK packages are the product.**

## Build Order

Build every feature component in `@stigmer/react` first, consume it from the Console second. Export hooks alongside styled components — a platform builder who wants `useSession()` without `<SessionViewer />` must be able to import just the hook.

## Integration Ergonomics

Integration ergonomics matter as much as end-user ergonomics.

- A component that is beautiful but requires 200 lines of glue code to embed is a failure.
- Clean props, sensible defaults, minimal required configuration.
- If a developer cannot get a component running in under 5 minutes, the DX has failed.

## SDK APIs Are User Interfaces

Method names, hook return types, component props, error messages, and TypeScript intellisense are all UX surfaces.

- Naming is critical — it becomes part of the platform builder's codebase and is expensive to change.
- Treat every exported hook, component, and type as a public API contract.

## Error Messages Are UX

- "Cannot read property of null" is a failure.
- "useStigmer must be used within a StigmerProvider" is a design decision.
- State what happened, why, and what to do.

## Before Writing Any Component

Ask three things:

1. **Does it belong in the SDK or the Console?** Default to SDK — extraction later is harder.
2. **Can it be themed via `--stgm-*` tokens** without leaking styles into the host app?
3. **Does it work identically** embedded in a third-party dashboard as it does in the Stigmer Console?
