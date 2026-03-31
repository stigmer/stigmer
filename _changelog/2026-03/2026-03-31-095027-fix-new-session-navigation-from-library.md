# Fix "New Session" Navigation From Library Page

**Date**: March 31, 2026

## Summary

Fixed a bug where clicking "New Session" in the sidebar while on the `/library` page did nothing. The `navigateToHome` function silently skipped navigation when there was no active session, even though the user was outside the session zone and clearly intended to navigate to the home/launcher screen.

## Problem Statement

Users on the Library page who clicked "New Session" in the sidebar were not redirected. The button appeared to be completely unresponsive.

### Pain Points

- Clicking "New Session" from `/library` had zero visible effect
- Users had to manually edit the URL or use Cmd/Ctrl-click as a workaround
- The bug was subtle: `preventDefault()` blocked the `<Link>` fallback, then `navigateToHome()` early-returned without doing anything

## Solution

Added an `isSessionZoneRef` to the `SessionNavigationProvider` and expanded the guard condition in `navigateToHome` so it also triggers when the user is outside the session zone (e.g., on `/library`).

## Implementation Details

**File**: `client-apps/web/src/contexts/session-navigation.tsx`

The root cause was in `navigateToHome`:

```typescript
// Before — only fires when a session is active
if (sessionIdRef.current !== null) { ... }

// After — also fires when outside the session zone
if (sessionIdRef.current !== null || !isSessionZoneRef.current) { ... }
```

A new `isSessionZoneRef` (mirroring the existing `sessionIdRef` pattern) keeps the callback identity stable while giving it access to current zone state.

The click handler in `Sidebar.tsx` calls `e.preventDefault()` on plain clicks to bypass Next.js Link navigation (required for the static-export `pushState` routing strategy). This meant the fallback `href="/"` never fired, and with `navigateToHome` being a no-op, nothing happened at all.

## Benefits

- "New Session" now works reliably from any page, not just from within active sessions
- Zero-cost fix: a single ref addition and one condition change
- Maintains the existing `pushState`-based navigation model without introducing Next.js router calls

## Impact

All users who navigate to the Library and then want to start a new session. This is a primary navigation path in the product.

## Related Work

- Session navigation provider (`session-navigation.tsx`) manages all client-side session routing for static-export mode
- Sidebar component (`Sidebar.tsx`) — click handler was correct, the bug was in the navigation function it called

---

**Status**: ✅ Production Ready
