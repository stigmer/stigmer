# DD-008: Single Provider Model

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — SDK Architecture section (package hierarchy table), Mandate #9 (Developer Experience for Integrators)

## Context

Platform builders integrating Stigmer into their products need to configure the SDK once and have all hooks and components work. The integration ceremony — the steps between `npm install` and a working component — must be minimal.

Multiple providers (one for auth, one for transport, one for theme, one for streaming) force platform builders to understand the SDK's internal architecture before they can use it. Provider ordering constraints, missing-provider errors that don't name which provider is missing, and "provider hell" (deeply nested provider stacks) are all friction points that compound against adoption.

The Stigmer Console itself needs the same simplicity. The provider composition root should be a single, understood layer — not a fragile tower of interdependent context providers.

## Decision

`StigmerProvider` is the single integration point for all `@stigmer/react` functionality. Platform builders configure it once:

```tsx
<StigmerProvider client={stigmerClient}>
  <App />
</StigmerProvider>
```

`useStigmer()` is the single hook that SDK components use to access the configured client. All data hooks, behavior hooks, and styled components internally call `useStigmer()` to obtain the `Stigmer` client instance — they do not accept a client prop, do not create their own clients, and do not access any other provider.

### What `StigmerProvider` Manages

- The `Stigmer` client instance (from `@stigmer/sdk`)
- Any SDK-internal context that hooks and components need (connection state, shared caches)

### What `StigmerProvider` Does NOT Manage

- Authentication — The consumer authenticates and passes a configured client. How auth is performed (OIDC, API key, session token) is the consumer's concern.
- Routing — The consumer handles navigation. SDK components emit events; the consumer decides what to do.
- Theme rendering — `@stigmer/theme` tokens are applied via CSS (the `.stgm` class and `@layer stgm`), not via a React provider. No `ThemeProvider` is needed inside the SDK.
- Console-specific context (org selection, deployment mode, feature flags) — These live in Console-only providers, outside the SDK.

## Consequences

- **Five-minute integration.** Install packages, create a client, wrap in `StigmerProvider`, import a component. Four steps to a working embed.
- **No provider ordering bugs.** With one provider, there is no ordering to get wrong.
- **Clean IoC boundary.** Everything inside `StigmerProvider` has access to the SDK. Everything outside does not. The boundary is a single, visible line in the component tree.
- **The Console's provider stack is Console-only.** The Console wraps `StigmerProvider` with its own providers (auth, org context, transport bridge). These Console-only providers are never published. Platform builders see only `StigmerProvider`.
- **SDK hooks cannot leak Console context.** Because SDK hooks access only `useStigmer()`, they cannot accidentally depend on Console-only providers. If a hook needs something that isn't in `useStigmer()`, that's a design signal that the data should either be a prop or should be added to the `Stigmer` client.

## Enforcement

- Code review: SDK hooks in `sdk/react/src/` must use `useStigmer()` for client access, not custom providers
- Code review: new React context providers in `sdk/react/src/` must be justified — default to using `useStigmer()` and props
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-008)
