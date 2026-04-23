# DD-006: Error Messages as UX

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/006_ux_designer.md` — Mandate #6 (SDK DX Is a UX Discipline); `_roles/004_web_ux_ui.md` — Quality Standard #1 (Frontend Code Quality)

## Context

SDK packages have two kinds of users who encounter errors: end-users (seeing error states in rendered UI) and platform builders (seeing errors in their development workflow — missing providers, misconfigured props, broken streaming connections).

For platform builders, the error message is often the first contact with a failure mode. A generic JavaScript error like `Cannot read properties of undefined (reading 'client')` forces the developer to read SDK source code, search GitHub issues, or guess at the cause. This is friction that directly impacts adoption — a developer who hits three cryptic errors in their first integration attempt may abandon the SDK.

For end-users, error states in UI components (failed API calls, disconnected streams, permission errors) are part of the experience. A blank screen or a raw error code is an experience failure even if the component "handled" the error technically.

## Decision

Every error produced by SDK packages must state three things:

1. **What happened** — The specific failure, not a generic category
2. **Why it happened** — The likely cause or violated precondition
3. **What to do about it** — A concrete corrective action

### For Developer Errors (Hooks and Providers)

Hooks used outside their required provider must throw an error with explicit guidance:

```
useStigmer must be used within a StigmerProvider.
Wrap your component tree with <StigmerProvider client={stigmerClient}>.
```

Not:

```
Cannot read properties of null
```

### For Runtime Errors (API Failures, Streaming Disconnections)

Data hooks and behavior hooks must return structured error states that the consumer (styled component or platform builder's custom UI) can render meaningfully:

- The error object must include a human-readable message, not just a status code
- Streaming hooks must distinguish between recoverable errors (temporary disconnection, retrying) and terminal errors (invalid credentials, resource not found)
- Error states must be typed — the consumer should know at the TypeScript level what error shapes are possible

### For End-User-Facing Error States

Styled components must render error states that communicate the problem in user-appropriate language. The execution viewer does not show "gRPC status 14" — it shows "Connection lost. Reconnecting..." or "This execution could not be found."

## Consequences

- **Error messages are a design deliverable.** When building a new hook or component, the error messages are designed alongside the happy-path behavior — not bolted on as an afterthought.
- **Errors are part of the TypeScript API surface.** Error types are exported from `@stigmer/react` alongside hooks and components. Platform builders can pattern-match on error kinds.
- **Provider validation happens at hook initialization, not at first use.** Checking for a missing provider on first render is better than failing silently until the first API call.
- **Error messages reference the SDK's public API, not its internals.** An error message should never mention internal file paths, private function names, or implementation details. It speaks in terms of the exports the developer interacts with.

## Enforcement

- Code review: new hooks must include provider validation with descriptive error messages
- Code review: new data/behavior hooks must return typed error states, not throw unstructured exceptions
- Code review: styled components must render meaningful error states, not blank screens
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-006)
