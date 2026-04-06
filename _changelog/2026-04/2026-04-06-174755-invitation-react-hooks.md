# Invitation React Hooks (Phase 4A)

**Date**: April 6, 2026

## Summary

Added 5 React hooks for the invitation resource to `@stigmer/react`, completing Phase 4A of the org invitation flow. These hooks provide the headless data and behavior layer that platform builders need to build custom invitation UIs, and that the Stigmer Console will consume in Phase 4B. All hooks follow the established codebase patterns exactly — no new abstractions, no deviations.

## Problem Statement

Track 3 (SDK Codegen) produced a generated `InvitationClient` in `@stigmer/sdk` with typed methods for create, revoke, redeem, get, listByOrg, and getByToken. However, React consumers need hooks that manage loading states, error handling, cancellation, and re-fetching — the same patterns used by every other resource in `@stigmer/react`. Without these hooks, platform builders would have to wire up `useState`/`useEffect` boilerplate themselves for every invitation operation.

### Pain Points

- No React-level abstraction for invitation operations
- Platform builders would need to manually handle loading, error, and cancellation patterns
- Missing hooks block Phase 4B (styled components) and Phase 5 (Console integration)

## Solution

Created a new `sdk/react/src/invitation/` domain folder with 5 hooks that wrap the generated `InvitationClient` methods, following the exact patterns established by `api-key/`, `organization/`, and `iam-policy/`.

## Implementation Details

### New Files

| File | Hook Type | Wraps |
|------|-----------|-------|
| `useOrgInvitations.ts` | Data (fetch + refetch) | `invitation.listByOrg()` |
| `useCreateInvitation.ts` | Mutation | `invitation.create()` |
| `useRevokeInvitation.ts` | Mutation | `invitation.revoke()` |
| `useInvitationPreview.ts` | Data (fetch + refetch) | `invitation.getByToken()` |
| `useRedeemInvitation.ts` | Mutation | `invitation.redeem()` |
| `index.ts` | Barrel | All 5 hooks + return type interfaces |

### Pattern Adherence

Every hook follows the codebase-wide conventions:
- `"use client"` directive, `Use*Return` exported interface with `readonly` fields
- `useStigmer()` for client access, `toError()` for error normalization
- Data hooks: `useState`/`useEffect` with cancellation flag, `fetchKey` + `refetch()`
- Mutation hooks: `useCallback` with `try/catch/finally`, re-throw after error state, `clearError()`
- Nullable parameters on data hooks (`string | null`) to skip fetching

### Key Design Decisions

- **Parameter simplification**: Hooks accept primitives (`string`, `string | null`), construct proto messages internally. `useRedeemInvitation` takes `token: string`, not `RedeemInvitationInput`.
- **No success-state tracking**: No `isRedeemed` on mutation hooks — callers handle success via the resolved promise, consistent with all existing mutation hooks.
- **No `useInvitationGet(id)`**: Not needed by Phase 4B components. Avoidance of unused API surface.
- **Public endpoint documented**: `useInvitationPreview` JSDoc explains that `getByToken` requires no auth but still needs `StigmerProvider` for transport configuration.

### Barrel Exports

Updated `sdk/react/src/index.ts` with a new `// Invitation` section exporting all 5 hooks and their return types, placed between Identity Provider and Error sections.

## Benefits

- Platform builders can now build custom invitation UIs using hooks alone (headless-first)
- Consistent DX: invitation hooks work identically to api-key, organization, and iam-policy hooks
- Clean separation: data/behavior hooks ready for Phase 4B component consumption
- Zero new dependencies or patterns introduced

## Impact

- **Platform builders**: Can import `useCreateInvitation`, `useRedeemInvitation`, etc. from `@stigmer/react` to build custom invitation flows
- **Phase 4B**: Unblocked — `InvitationManager` and `InvitationRedemption` components can now consume these hooks
- **Phase 5**: Console integration will compose Phase 4B components, which are built on these hooks

## Related Work

- Preceded by: Invitation proto layer (Track 1), SDK codegen (Track 3)
- Enables: React SDK components (Track 4B), Console integration (Track 5)
- Parallel: Invitation backend (Track 2) in stigmer-cloud repo

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
