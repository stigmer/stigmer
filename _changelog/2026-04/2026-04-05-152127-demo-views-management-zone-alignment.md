# Demo Views — Management Zone Alignment

**Date**: April 5, 2026

## Summary

Updated the docs demo views and the api-key-setup scenario to reflect the Console's new management zone layout. Added a `ManagementShell` schematic view, inlined the single-consumer `ApiKeysView` directly into its scenario, and deleted both `SettingsView.tsx` and `ApiKeysView.tsx` as unnecessary view wrappers.

## Problem Statement

After the Console's settings layout refactor (zone separation + sub-page navigation), the `api-key-setup` demo scenario was showing stale navigation: the session sidebar was still visible during settings steps, and all settings sections were stacked on one page. This misrepresented the actual Console experience.

### Pain Points

- Demo showed session sidebar (New Session, Library, Recents) during Settings steps — the real Console swaps to a management sidebar
- Demo showed API Keys + Personal Environment stacked on one page — the real Console has them on separate routes
- `SettingsView.tsx` was a single-consumer view wrapper that duplicated SDK component composition unnecessarily

## Solution

Three changes to align demos with the Console:

1. **New `ManagementShell.tsx`** — Schematic management zone layout (org indicator, "Back to Sessions", Members/API Keys/Environments nav, user profile). Used by the api-key-setup scenario for settings steps. Mirrors the Console's `ManagementSidebar`.

2. **Inlined API Keys content** — The old `SettingsView` (later renamed `ApiKeysView`) was a single-consumer wrapper around SDK components. Its content was inlined directly into the `api-key-setup` scenario as local `ApiKeysPageChrome` and `PrefilledCreateForm` functions. The SDK components (`ApiKeyListPanel`, `CreateApiKeyForm`, `ApiKeyCreatedAlert`) are imported directly.

3. **Deleted unnecessary views** — Both `SettingsView.tsx` and `ApiKeysView.tsx` are gone. The principle: single-consumer views should be inlined; multi-consumer views (`ComposerView`, `ResourceListPage`, `WidgetsSidebar`) are legitimate shared components and remain.

## Implementation Details

### ManagementShell (new)

~130 lines of schematic layout. Structure mirrors the real `ManagementSidebar`:
- Org indicator ("Acme Corp")
- "Back to Sessions" with ArrowLeft icon
- Nav links: Members, API Keys, Environments (with `activeNav` prop for highlighting)
- User profile row
- Content area with framer-motion slide/fade transitions

### api-key-setup scenario (modified)

Steps 1-4 (session zone) still use `AppShell`. Steps 5-8 (management zone) now use `ManagementShell` with `activeNav="api-keys"`. SDK components are composed directly with local `ApiKeysPageChrome` wrapper for shared page chrome (section header, "New API key" button, zoom scaling, cursor targets).

## Benefits

- Demo accurately represents the Console's zone transition (session sidebar -> management sidebar)
- One fewer view file to maintain (`ApiKeysView.tsx` eliminated)
- SDK components are used directly — no unnecessary indirection layer
- Multi-consumer views (`ComposerView`, `ResourceListPage`, `WidgetsSidebar`) correctly retained

## Impact

- **Docs site visitors**: See the correct management zone navigation in the API key setup walkthrough
- **Other scenarios**: Completely unaffected — only api-key-setup touches Settings

## Files Changed

| File | Change |
|------|--------|
| `views/ManagementShell.tsx` | New — management zone schematic shell |
| `views/SettingsView.tsx` | Deleted — replaced by inlined content |
| `scenarios/api-key-setup/index.tsx` | Modified — uses ManagementShell, inlined API Keys content |

---

**Status**: Production Ready
**Timeline**: Single session
