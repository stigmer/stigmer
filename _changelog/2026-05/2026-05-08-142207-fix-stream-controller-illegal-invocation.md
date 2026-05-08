# Fix StreamController "Illegal invocation" Error

**Date**: May 8, 2026

## Summary

Fixed a critical bug in the React SDK's `StreamController` where unbound `requestAnimationFrame` and `cancelAnimationFrame` references caused "Illegal invocation" (Chrome) and "Can only call Window.requestAnimationFrame on instances of Window" (WebKit/Tauri) errors, completely breaking real-time execution streaming in both the web app and desktop app.

## Problem Statement

Users on the web app (Chrome) and desktop app (Tauri/WebKit) were seeing error banners during agent execution streaming. The streaming connection would fail immediately upon receiving the first non-terminal snapshot, rendering the session page unusable.

### Pain Points

- Every session that started streaming an agent execution would fail with an opaque browser error
- The "Reconnect" button triggered the same failure, offering no recovery path
- The error message shown to users ("Illegal invocation" or "Can only call...") was a raw browser error with no actionable guidance
- Affected both the Stigmer web console and the Tauri desktop app, as well as any platform embedding `@stigmer/react`

## Solution

The `StreamController` constructor stored `requestAnimationFrame` and `cancelAnimationFrame` as bare function references in its default parameters. These are `Window.prototype` methods that require `window` as their `this` context. When later called via `this._scheduleFlush(cb)`, the receiver was the `StreamController` instance, not `window`, causing the browser to reject the call.

The fix wraps the native APIs in arrow functions so the call expression `requestAnimationFrame(cb)` preserves the implicit `window` receiver through normal global scope resolution.

## Implementation Details

### Core fix (`sdk/react/src/internal/stream-controller.ts`)

Changed the constructor default parameters from bare references to arrow-function wrappers:

```typescript
// Before (broken — unbound reference loses window context)
scheduleFlush = typeof requestAnimationFrame !== "undefined"
  ? requestAnimationFrame
  : (cb) => setTimeout(cb, 16) as unknown as number,

// After (fixed — arrow function preserves window receiver)
scheduleFlush = typeof requestAnimationFrame !== "undefined"
  ? (cb: () => void) => requestAnimationFrame(cb)
  : (cb: () => void) => setTimeout(cb, 16) as unknown as number,
```

The same pattern was applied to `cancelAnimationFrame` / `clearTimeout`.

### Test coverage (`sdk/react/src/internal/__tests__/stream-controller.test.ts`)

Added a new `"default constructor (browser rAF binding)"` test group that exercises the default constructor path using `vi.stubGlobal`. This ensures the default parameter wiring is validated — the existing tests all injected a mock scheduler, which is why this bug was never caught.

### Defensive error sanitization (`sdk/typescript/src/errors.ts`)

Added two patterns to `INFRA_NOISE_PATTERNS` so that if a similar unbound-native-API error surfaces elsewhere, the user sees "A browser API call failed. Please try again." instead of the raw browser error.

## Benefits

- Execution streaming works correctly across all environments (Chrome, Firefox, Safari, Tauri WebView)
- Users see real-time agent execution updates instead of an error banner
- The "Reconnect" button now functions as intended
- Future browser API binding errors produce a user-friendly message via error sanitization

## Impact

- **Severity**: Critical — execution streaming was completely broken
- **Scope**: All platforms consuming `@stigmer/react` (web console, desktop app, Planton embedding)
- **Files changed**: 3 (1 fix, 1 test, 1 error handling)
- **Tests**: 455 React SDK tests + 48 SDK error tests all passing

## Related Work

- `2026-05-03-124923-react-sdk-stream-controller-state-machine.md` — original StreamController introduction
- `2026-05-03-144353-react-sdk-auto-scroll-state-machine.md` — related rAF usage (correct pattern, no fix needed)

---

**Status**: ✅ Production Ready
