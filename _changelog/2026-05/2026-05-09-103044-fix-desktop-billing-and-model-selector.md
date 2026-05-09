# Fix Desktop Billing Page and Model Selector

**Date**: May 9, 2026

## Summary

Fixed two broken features in the Stigmer desktop app: the Billing settings page was showing a hardcoded "coming soon" placeholder instead of the fully-implemented `BillingSection` component, and the Model Selector was showing "No models found" because the model registry API fetch used the browser's native `fetch()` instead of the Tauri HTTP plugin, causing silent failures from CORS/CSP restrictions in the Tauri webview.

## Problem Statement

After shipping the billing UI (Phases 1–5) and migrating the model registry from static JSON to an authenticated API endpoint, neither feature was working in the desktop app:

### Pain Points

- Billing settings page showed "Billing — This feature is coming soon" with a CreditCard icon placeholder, despite the `BillingSection` component being fully implemented in `@stigmer/react` and working correctly in the web app
- Model Selector dropdown showed "No models found" for both Stigmer and Cursor harnesses, making it impossible to select a model for new sessions
- Both issues were silent failures — no error messages, no console errors visible to the user

## Solution

### Billing: Wire the real component

Replaced the hardcoded placeholder in the desktop router with a proper `BillingPage` wrapper component that renders `<BillingSection>` from `@stigmer/react`, matching the web app's implementation. The component handles Stripe checkout return flow (`?checkout=success` query param) using react-router-dom's `useSearchParams`.

### Model Selector: Fix the `fetch` mismatch

The root cause was an architectural inconsistency: the desktop app constructs the `Stigmer` SDK client with `tauriFetch` from `@tauri-apps/plugin-http` (which routes HTTP through the native Rust client, bypassing browser CORS), but the model registry fetch in `provider.tsx` called `fetchModelRegistry()` which used the browser's global `fetch()`. In the Tauri webview, this global `fetch` is restricted by CSP/CORS policies, causing the API call to fail silently and leaving the model list empty.

The fix threads the client's custom `fetch` implementation through the call chain:
1. Exposed `readonly fetch` on the `Stigmer` class (preserving the config value)
2. Added optional `customFetch` parameter to `fetchModelRegistry()` (backward-compatible)
3. The `StigmerProvider` now passes `client.fetch` to the registry fetch

## Implementation Details

### New File: `client-apps/desktop/src/pages/settings/BillingPage.tsx`
- Wrapper component with `useSearchParams` from react-router-dom for checkout success handling
- Renders `<BillingSection>` with `checkoutSuccess` and `onDismissCheckoutSuccess` props
- Lazy-loaded in the router for code splitting

### Modified: `client-apps/desktop/src/routes.tsx`
- Replaced inline placeholder JSX with `<LazyPage><BillingPage /></LazyPage>`
- Removed unused `CreditCard` import from lucide-react
- Added lazy import for `BillingPage`

### Modified: `sdk/typescript/src/stigmer.ts`
- Added `readonly fetch: typeof globalThis.fetch | undefined` property
- Set from `config.fetch` in the constructor

### Modified: `sdk/react/src/models/registry.ts`
- `fetchModelRegistry()` now accepts optional `customFetch` parameter
- Uses `customFetch ?? globalThis.fetch` internally — no behavioral change for existing callers

### Modified: `sdk/react/src/provider.tsx`
- `useModelRegistryFetch` passes `client.fetch` as the third argument to `fetchModelRegistry()`

## Benefits

- Desktop users can now manage billing (credit balance, purchase credit packs, payment methods, auto-recharge, transaction history) directly in the desktop app
- Model Selector populates correctly in both Stigmer and Cursor harnesses, unblocking session creation
- The `BillingSection` component's built-in deployment mode gate handles local vs cloud gracefully — local mode shows a `CloudFeatureNotice` banner instead of broken billing UI
- The `fetch` threading pattern ensures any future non-transport HTTP calls in the SDK can also use the client's configured fetch implementation

## Impact

- **Desktop app**: Both Billing and Model Selector now functional
- **SDK (TypeScript)**: New public `fetch` property on `Stigmer` class (additive, non-breaking)
- **SDK (React)**: `fetchModelRegistry` signature expanded with optional parameter (backward-compatible)
- **Web app**: No changes — already working correctly

## Related Work

- Model Registry API Migration (2026-05-08) — migrated all consumers from static JSON to authenticated API
- Pricing Page Rewrite (2026-05-08) — marketing pricing page and cost calculator
- Billing Phases 1–5 (2026-05-03 through 2026-05-07) — full billing system implementation
- Dark Mode Portal Token Cascade (2026-05-08) — related Tauri portal rendering fix

---

**Status**: Production Ready
**Timeline**: Single session
