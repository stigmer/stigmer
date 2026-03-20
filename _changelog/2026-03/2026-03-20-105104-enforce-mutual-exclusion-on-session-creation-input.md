# Enforce Mutual-Exclusion on Session Creation Input

**Date**: March 20, 2026

## Summary

Refactored `CreateSessionInput` in `@stigmer/react` from a flat interface with two optional agent fields (implicit priority) to a TypeScript discriminated union that enforces exactly one agent resolution path at compile time. This eliminates an ambiguous API surface where callers could pass both fields or neither, and aligns the hook with the two-path session model (saved instance vs agent reference) needed by the upcoming unified save-or-use-once flow.

## Problem Statement

`useCreateSession` accepted `agentInstanceId` and `agentRef` as two independent optional fields. When both were provided, `agentInstanceId` silently won. When neither was provided, the backend picked a "platform default" agent. Both behaviors were invisible at the call site.

### Pain Points

- **Ambiguous call sites** — `SessionLauncher` passed both fields simultaneously, relying on undocumented priority logic inside the hook
- **Silent default agent** — omitting both fields created a session bound to an agent the caller never named, violating visibility-of-system-status (Nielsen heuristic #1) for platform builders
- **Type system couldn't help** — TypeScript saw two independent `string | undefined` fields with no constraint between them, so invalid combinations compiled without error
- **T02 blocker** — the upcoming `useAgentSetup` hardening (T02) needs the session API to clearly distinguish "saved instance" from "agent reference" paths; the flat type couldn't express this

## Solution

Applied the `?: never` mutual-exclusion pattern to create a two-variant union type:

```typescript
type CreateSessionInput = SharedSessionFields &
  (
    | { agentInstanceId: string; agentRef?: never }
    | { agentRef: ResourceRef; agentInstanceId?: never }
  );
```

Callers must now provide exactly one of the two fields. Passing both or neither is a compile-time error. The "backend default" path is removed from the React hook — platform builders who genuinely need it can drop one layer down to `@stigmer/sdk`'s `session.create()`, where `agentInstanceId` remains optional per the proto.

## Implementation Details

### `sdk/react/src/session/useCreateSession.ts`

- Extracted `SharedSessionFields` (internal, not exported) to keep the union readable
- Changed `CreateSessionInput` from `export interface` to `export type` with the union
- Replaced `let agentInstanceId = input.agentInstanceId` + implicit-priority pattern with explicit `if/else if/else` branches using `resolvedInstanceId: string` (always assigned before use)
- Added defensive runtime guard in the `else` branch with an actionable error message for JavaScript callers
- Updated JSDoc: "three strategies" → "two strategies", removed the "no agent" example, fixed `@link` to `useCreateAgentExecution`

### `client-apps/web/src/components/session/SessionLauncher.tsx`

- Added agent-selection guard before `createSession` call: `if (!agentInstanceId && !agentRef)` throws with "Select an agent before starting a session"
- Replaced simultaneous field passing with a ternary that calls `createSession` with exactly one union variant per branch

## Benefits

- **Compile-time safety** — invalid input shapes are caught by TypeScript before runtime
- **Self-documenting API** — the type signature communicates "pick one path" without needing to read JSDoc or source code
- **Cleaner implementation** — `resolvedInstanceId: string` is always assigned, no `undefined` possible
- **T02-ready** — the two-variant union maps directly to the saved/one-time paths that T02 will implement
- **Layered architecture** — the React hook adds a well-reasoned opinion (require explicit agent) while the SDK layer faithfully mirrors the proto's optionality

## Impact

- **`@stigmer/react` consumers** — `CreateSessionInput` type shape changed. Any caller passing both fields or neither will see a compile error. This is a breaking change to the type, but pre-1.0 and the only real caller (`SessionLauncher`) is updated in the same commit.
- **`@stigmer/sdk` consumers** — no change. `SessionInput.agentInstanceId` remains optional per the proto.
- **Proto/backend** — no change.

## Related Work

- T01 of secrets-flow-hardening: [Fix CLI commands in secrets documentation](2026-03-20-095019-fix-cli-commands-in-secrets-documentation.md)
- T02 (upcoming): `useAgentSetup` hardening with unified save-or-use-once model — depends on this clean session API for dual-path routing
- T03 (upcoming): Naming consistency (`env_refs` → `environment_refs`)

---

**Status**: ✅ Production Ready
**Project**: 20260319.06.secrets-flow-hardening (T04)
**Commit**: `5636cf5a`
