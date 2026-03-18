# Fix Nested Form Hydration Error in WorkspaceEditor

**Date**: March 17, 2026

## Summary

Fixed a React hydration error caused by `WorkspaceEditor` (SDK component) rendering a `<form>` element inside `SessionLauncher`'s parent `<form>`. Replaced the inner `<form>` with a `<div>` and explicit event handlers, making the component safe to embed in any host element.

## Problem Statement

When clicking "Add workspace" in the session launcher, the browser console showed two errors:

> In HTML, `<form>` cannot be a descendant of `<form>`. This will cause a hydration error.

### Pain Points

- `WorkspaceEditor` used a `<form>` for its add-workspace panel
- `SessionLauncher` wraps its content in a `<form>` for the main submission flow
- Nesting produced invalid HTML and triggered React hydration mismatch
- As an SDK component, `WorkspaceEditor` must be embeddable in any host element -- including inside a `<form>`

## Solution

Replaced the `<form>` in `WorkspaceEditor` with a `<div>`. Moved submission logic from form `onSubmit` to explicit `onClick` on the Add button and `onKeyDown` on input fields. This preserves identical behavior (including Enter-to-submit) while eliminating the HTML nesting violation.

## Implementation Details

**File**: `sdk/react/src/workspace/WorkspaceEditor.tsx`

- Replaced `<form onSubmit={handleSubmit}>` with `<div>` (same className)
- Renamed `handleSubmit(FormEvent)` to `handleAdd()` (plain callback, no form event)
- Added `handleKeyDown` callback on all `<input>` elements to trigger `handleAdd` on Enter
- Changed Add button from `type="submit"` to `type="button"` with `onClick={handleAdd}`
- Removed `required` attributes from inputs (HTML form validation only works with `<form>` submission)
- Updated import from `FormEvent` to `KeyboardEvent`

## Benefits

- Eliminates hydration errors when WorkspaceEditor is embedded inside a form
- SDK component now honors the platform-for-platforms contract: safe to embed anywhere
- Keyboard accessibility preserved via explicit `onKeyDown` handlers

## Impact

- **SDK consumers**: `WorkspaceEditor` is now safe to use inside any host element
- **Console**: Session launcher no longer shows hydration errors in the browser console

## Related Work

- Session launcher (T01.5): `client-apps/web/src/components/session/SessionLauncher.tsx`
- SDK architecture: `_roles/004_web_ux_ui.md` (headless-first, platform-for-platforms)

---

**Status**: Production Ready
**Timeline**: Single session fix
