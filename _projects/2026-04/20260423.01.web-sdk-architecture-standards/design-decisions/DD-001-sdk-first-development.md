# DD-001: SDK-First Development

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — Mandate #1 (SDK-First Development)

## Context

Stigmer is a platform for platforms. Its primary value is delivered through SDK packages (`@stigmer/sdk`, `@stigmer/react`, `@stigmer/theme`) that platform builders embed into their own products. The Stigmer Console (`client-apps/web`) is one consumer of those packages — an important one, but not the product itself.

Without a clear build-order discipline, the natural tendency is to build features directly in the Console (where they're immediately visible and testable in context) and extract them to the SDK later. This "build-in-app, extract-later" pattern consistently produces components with hidden dependencies on Console infrastructure — routing, auth state, layout context, environment assumptions — that make extraction painful or incomplete. The result is SDK components that are technically published but practically unusable outside the Console.

## Decision

Every feature component is built in `@stigmer/react` first, then consumed by `client-apps/web` second.

The build order is:

1. **Data hook** in `@stigmer/react` — fetches and manages API data via `@stigmer/sdk` resource clients
2. **Behavior hook** in `@stigmer/react` — encapsulates interaction logic (streaming, state machines, approval flows)
3. **Styled component** in `@stigmer/react` — composes the hooks with `@stigmer/theme` tokens
4. **Page wiring** in `client-apps/web` — routes to the component, provides page layout, handles Console-specific orchestration

If a piece of UI logic is needed and there is genuine uncertainty about whether it belongs in the SDK or the Console, default to the SDK. Moving code from SDK to Console is trivial (delete the export). Moving code from Console to SDK requires decoupling from Console infrastructure, which is always harder than expected.

## Consequences

- **The Console is always behind the SDK.** A new feature exists as an SDK hook or component before it appears in the Console. The Console page is a thin wrapper that imports and renders the SDK component.
- **SDK components are tested in isolation.** Because they are built outside the Console, they must work without Console infrastructure from day one. This is a feature, not a constraint — it guarantees embeddability.
- **Platform builders get features at the same time as Console users.** There is no "Console-only phase" followed by a delayed SDK extraction. The SDK is the delivery mechanism.
- **Code review must verify build order.** A PR that adds a feature component directly to `client-apps/web/src/` without a corresponding SDK component (or a documented justification for why it's Console-only) is incomplete.

## Enforcement

- Code review: PRs adding feature UI to `client-apps/web` must reference the SDK component they consume
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-001)
- Workstream C will add import-count metrics to track SDK consumption from the Console
