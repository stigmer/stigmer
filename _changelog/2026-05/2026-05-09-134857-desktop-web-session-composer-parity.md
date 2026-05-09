# Fix: Desktop / Web Session Composer Parity

**Date**: May 9, 2026

## Summary

Fixed a harness desync bug on the desktop app's session follow-up composer and established a formal client-app parity protocol in the SDK architecture rule. The desktop's `SessionPage` was missing the `harness` prop when rendering `SessionComposer`, causing the `ModelSelector` to default to the "native" harness instead of respecting the session's actual harness (e.g., "cursor"). Also aligned the desktop's loading skeleton with the SDK's `ThreadSkeleton` and moved the architecture rule to cover both client apps.

## Problem Statement

After applying the localStorage validation gate fix (2026-05-08) to the SDK — which corrected model/harness/runner desync on the web — the desktop app still exhibited the model selection bug during follow-up messages within an existing session.

### Pain Points

- **Follow-up harness desync on desktop**: When a user created a session with the "cursor" harness and then sent a follow-up, the desktop's `ModelSelector` defaulted to "native" because the `SessionComposer` never received the session's harness. The model list showed wrong models.
- **Architecture rule blind spot**: The `sdk-console-architecture.mdc` rule only referenced `client-apps/web`. The desktop app was not covered by globs or mentioned in any design decision, creating no process to catch this class of parity bug.
- **Skeleton divergence**: The desktop used a custom hand-rolled loading skeleton while the web used the SDK's `ThreadSkeleton`, an unnecessary divergence from SDK-first principles.

## Solution

Three targeted changes that close the parity gap and prevent recurrence:

1. Add `harness={flow.harness}` to the desktop's `SessionPage` follow-up `SessionComposer` — matching the web's wiring exactly.
2. Move the architecture rule to `.cursor/rules/client-apps/sdk-console-architecture.mdc`, extend globs to cover desktop, and add DD-016 (client app parity) + Dont-Do 9 (no single-client fixes).
3. Replace the desktop's custom `SessionSkeleton` with the SDK's `ThreadSkeleton`.

## Implementation Details

### Part 1: Desktop SessionPage Harness Fix

Added `harness={flow.harness}` to the `SessionComposer` in `client-apps/desktop/src/pages/SessionPage.tsx`. The `useSessionPageFlow` hook already derived the harness from `conv.session.spec.harness` — it just wasn't being passed through.

With `showHarnessSelector` defaulting to `false` on the session page, the `ComposerToolbar` passes `harness` directly to `ModelSelector` as a locked value. This ensures the model list is scoped to the session's harness.

**File**: `client-apps/desktop/src/pages/SessionPage.tsx`

### Part 2: Architecture Rule — Client App Parity Protocol

Moved `sdk-console-architecture.mdc` from `.cursor/rules/client-apps/web/` to `.cursor/rules/client-apps/` and made these changes:

- Extended globs to `client-apps/desktop/src/**/*.{tsx,ts}` alongside web and SDK
- Updated the layered architecture table to include `client-apps/desktop`
- Added **DD-016 — Client app parity**: all client apps consuming the same SDK component must be reviewed and updated together when prop wiring changes
- Added **Dont-Do 9 — No single-client-app bug fixes**: a fix applied to web but not desktop (or vice versa) is an incomplete fix
- Added item 6 to the "Before Writing Any Component" checklist

**File**: `.cursor/rules/client-apps/sdk-console-architecture.mdc`

### Part 3: Skeleton Alignment

Replaced the desktop's custom `SessionSkeleton` (hand-rolled `animate-pulse` divs) with the SDK's `ThreadSkeleton` component, matching the web's implementation. Uses the same `pl-[220px]` layout wrapper for consistency with the loaded state.

**File**: `client-apps/desktop/src/pages/SessionPage.tsx`

## Benefits

- Eliminates the "wrong model list on follow-up" bug on desktop
- Establishes a formal process (DD-016, Dont-Do 9) to prevent future web/desktop divergence
- Architecture rule now triggers on desktop file edits, not just web
- Desktop loading state uses the same SDK component as web — one fewer custom implementation to maintain

## Impact

- **Desktop users**: Model selection during follow-up messages now correctly reflects the session's harness
- **AI agents working on this codebase**: The architecture rule now fires for desktop edits and explicitly requires cross-client-app review
- **Future development**: Any new client app consuming `@stigmer/react` is covered by the parity protocol

## Related Work

- Follows the localStorage validation gate fix (2026-05-08) which established the "localStorage is a hint, not truth" pattern in the SDK
- The SDK-first architecture (DD-001) is validated: the core fix lives in SDK code and propagates to both apps automatically — only the thin-shell prop wiring was the gap

---

**Status**: Production Ready
**Timeline**: Single session
