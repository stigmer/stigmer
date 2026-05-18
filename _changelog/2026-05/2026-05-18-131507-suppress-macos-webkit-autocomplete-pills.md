# Suppress macOS WebKit Autocomplete Pills in Tauri Desktop Apps

**Date**: May 18, 2026

## Summary

Disabled macOS WebKit form autocomplete suggestion pills that were appearing below search and filter inputs in the Tauri-based desktop apps. The pills were caused by WKWebView's built-in form autofill behavior, which Tauri inherits on macOS, and were suppressed by adding standard HTML autocomplete/autocorrect/spellcheck attributes to all app-internal search inputs.

## Problem Statement

When typing in search/filter inputs within the Planton OS desktop app on macOS, a floating "pill" suggestion would appear below the input field -- for example, typing "wor" would trigger a macOS autocorrect suggestion of "For" with an dismiss button. This is WebKit's built-in form autofill and autocorrect behavior inherited from Safari's engine (WKWebView), which Tauri uses on macOS.

### Pain Points

- Distracting autocomplete pills overlap with the app's own search results and filter UI
- macOS autocorrect suggestions ("wor" -> "For") interfere with intentional search queries
- The pills suggest previously typed values that have no relevance to the app's search context
- Users unfamiliar with the behavior may mistake it for an app bug

## Solution

Added four HTML attributes to all app-internal search and filter inputs to suppress WebKit's autocomplete, autocorrect, auto-capitalization, and spellcheck behaviors:

- `autoComplete="off"` -- suppresses the form autofill pill
- `autoCorrect="off"` -- suppresses inline autocorrect suggestions
- `autoCapitalize="off"` -- suppresses automatic capitalization
- `spellCheck={false}` -- suppresses red spellcheck underlines

There is no `tauri.conf.json` setting for this -- suppression must be applied per-input in the HTML/React code.

## Implementation Details

### Shared SearchInput Component (ui-primitives)

The `SearchInput` component already had `autoComplete="off"` but was missing the other three attributes. Added `autoCorrect`, `autoCapitalize`, and `spellCheck` via `slotProps.htmlInput` on the underlying MUI `TextField`. This fix propagates to all consumers of `SearchInput` across both Planton and Planton OS desktop apps.

### Planton OS Desktop Search Bars (8 files)

Added `inputProps={{ autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false }}` to every MUI `InputBase` search input across:

- Skills list, Doors list, Support requests, Partners, Organizations, Accounts, Contacts, and Home page

### CRM Form Autocomplete Fields (2 files)

Added suppression attributes via `slotProps.htmlInput` on the `renderInput` TextField for:

- Linked Company search (edit-contact)
- Referring Partner search (edit-account)

Regular form fields (email, name, domain, phone) were intentionally left with browser autocomplete enabled.

## Benefits

- Clean, distraction-free search experience on macOS
- No more spurious autocorrect suggestions interfering with search queries
- Consistent input behavior across macOS, Windows, and Linux
- Shared component fix ensures all future `SearchInput` consumers inherit the fix

## Impact

- **Users**: All Planton OS desktop users on macOS will no longer see WebKit autocomplete pills in search inputs
- **Developers**: The shared `SearchInput` component now sets all four suppression attributes, so new search UIs built with it are automatically covered
- **Files changed**: 11 files (1 shared component + 8 search bars + 2 CRM form inputs)

## Related Work

- [WebKit Form Autocomplete Pill in Tauri Apps](https://takazudomodular.com/pj/zudo-tauri/docs/frontend/webkit-form-autocomplete/) -- community documentation confirming this is a WKWebView behavior, not a Tauri bug

---

**Status**: Production Ready
**Repo**: plantonhq/planton
**Commit**: `fix(desktop): suppress macOS WebKit autocomplete pills in search inputs`
