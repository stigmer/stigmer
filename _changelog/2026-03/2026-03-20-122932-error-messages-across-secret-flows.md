# Improve Error Messages Across Secret Flows

**Date**: March 20, 2026

## Summary

Wired up the existing but unused error classification infrastructure (`getUserMessage`, `classifyError`, `isRetryableError`) across all 18 React SDK hooks, upgraded error state from lossy `string | null` to `Error | null` preserving full `StigmerError` metadata, moved the structured `ErrorMessage` component from Console to the SDK for platform builder reuse, and added contextual recovery guidance for missing environment variable failures.

## Problem Statement

The codebase had a well-designed error handling infrastructure in `@stigmer/sdk` that was completely bypassed by the React SDK. Every hook extracted `err.message` as a raw string, discarding the `StigmerError` object and all its metadata.

### Pain Points

- Infrastructure noise (`ECONNREFUSED`, `no healthy upstream`) leaked to end-users as-is
- Error classification (category icons, titles, retry decisions) was impossible with string-only errors
- The `ErrorMessage` component using the classification system lived in `client-apps/web` — unusable by platform builders
- Secret-flow failures showed developer-facing API messages ("Add it to AgentInstance.environment_refs") with no actionable UI guidance
- `useRevealSecretValue` errors were captured but never rendered in the UI

## Solution

A five-phase approach that wires existing infrastructure rather than building new abstractions:

1. **Upgrade hook error types** — `Error | null` everywhere, `getUserMessage()` only at rendering boundaries
2. **Move `ErrorMessage` to SDK** — decoupled from Console dependencies, available to platform builders
3. **Add `SecretFlowErrorGuide`** — contextual recovery guidance for missing env var `FAILED_PRECONDITION` errors
4. **Surface reveal errors** — `useRevealSecretValue.error` now visible in `EnvironmentVariableEditor`
5. **Full verification** — zero new TypeScript errors, all 85 tests passing

## Implementation Details

### Hook Error Type Upgrade (Phase 1)

Changed all 18 React hooks from `error: string | null` to `error: Error | null`:

- Created `sdk/react/src/internal/toError.ts` — normalizer that preserves `StigmerError` identity
- Updated `agentSetupReducer` state machine to carry `Error` objects
- Updated `useSessionConversation` composition (propagates `Error | null` from sub-hooks)
- All JSX rendering now uses `getUserMessage(error)` which sanitizes infra noise and applies category-based fallbacks

### ErrorMessage Component (Phase 2)

Moved from `client-apps/web/src/components/ui/error-message.tsx` to `sdk/react/src/error/ErrorMessage.tsx`:

- Replaced lucide-react icons with inline SVGs (SDK components avoid icon library dependencies)
- Replaced Console `Button` component with a plain `<button>` styled via Tailwind utilities
- Console re-exports from `@stigmer/react` — zero drift between SDK and Console versions
- Renders category icons, titles, `getUserMessage()` output, expandable RPC metadata, and conditional retry buttons

### SecretFlowErrorGuide (Phase 3)

New `sdk/react/src/error/SecretFlowErrorGuide.tsx`:

- Detects `FAILED_PRECONDITION` + `StigmerError` with "requires environment variable" pattern
- Extracts and groups missing variables by MCP server name
- Renders actionable guidance: "Add to personal environment" or "provide as one-time secret"
- `isSecretFlowError()` utility enables conditional rendering alongside `ErrorMessage`
- Wired into `SessionComposer` (agent setup errors) and `SessionPage` (execution send errors)
- Zero Console dependencies — platform builders get identical guidance

### Reveal Error Surfacing (Phase 4)

`VariableRow` in `EnvironmentVariableEditor` now destructures `error` from `useRevealSecretValue()` and merges it with mutation errors via `const error = mutationError ?? revealError`.

## Benefits

- **Infra noise eliminated**: Users no longer see raw `ECONNREFUSED` or `no healthy upstream` messages
- **Structured errors everywhere**: Every error can be classified, retried, and inspected via `classifyError`, `isRetryableError`, `getRpcMetadata`
- **Platform builder parity**: `ErrorMessage` and `SecretFlowErrorGuide` available via `@stigmer/react` — embeddable in any host app
- **Actionable secret errors**: Missing environment variables now show concrete recovery steps instead of developer-facing API references
- **Developer debugging preserved**: Expandable "Technical details" section still shows RPC method and path

## Impact

- **18 hooks** changed to preserve full error objects
- **5 SDK components** updated to use `getUserMessage()` at rendering boundaries
- **3 Console pages** upgraded with `getUserMessage()` and `SecretFlowErrorGuide` integration
- **4 new files** created (toError utility, ErrorMessage, SecretFlowErrorGuide, error barrel)
- **32 files modified** total across `@stigmer/react` and `client-apps/web`
- **0 new TypeScript errors**, 85/85 tests passing, 0 linter errors

## Related Work

- Part of the `20260319.06.secrets-flow-hardening` project (T06, final task)
- Builds on T05 (one-time secrets input) which introduced the `runtimeEnv` path
- The `SecretFlowErrorGuide` references the one-time secrets flow introduced in T05
- Error infrastructure in `sdk/typescript/src/errors.ts` was built earlier — this work wires it into the React layer

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
