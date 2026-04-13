# Fix Vendor Approval REJECTED Handling in MCP Server Picker

**Date**: April 13, 2026

## Summary

Fixed a bug in `McpServerPicker` where vendor approval `REJECTED` status was not handled, causing users to see no warning and encounter a cryptic backend error when attempting to sign in. Also replaced a hardcoded magic number with the proper `VendorApprovalStatus` enum.

## Problem Statement

The session-setup picker (`McpServerPicker`) only checked for `VendorApprovalStatus.PENDING` using a hardcoded magic number (`=== 1`). It never computed or passed `isVendorApprovalBlocked` to the config panel.

### Pain Points

- If a vendor **rejected** an OAuth app, the picker showed no warning — the user clicked "Sign in," the backend rejected the request, and the user saw a confusing error with no explanation
- The existing `InlineOAuthSignIn` component already handled the `isVendorApprovalBlocked` prop correctly (covering both PENDING and REJECTED), but the picker parent never supplied it
- The magic number `1` was fragile and inconsistent with the rest of the codebase, which uses the `VendorApprovalStatus` enum

## Solution

Three surgical edits to `McpServerPicker.tsx`:

1. Import `VendorApprovalStatus` enum from `@stigmer/protos`
2. Compute `isVendorApprovalBlocked` covering both PENDING and REJECTED — matching the existing pattern in `useMcpServerCredentials.ts`
3. Pass `isVendorApprovalBlocked` into `oauthSignInProps` so `InlineOAuthSignIn` can properly disable sign-in and show the blocked message

## Implementation Details

The fix mirrors how `useMcpServerCredentials.ts` already computes these values:

```typescript
const isVendorApprovalPending =
  hasOAuth &&
  oauthStatus?.vendorApprovalStatus === VendorApprovalStatus.PENDING;
const isVendorApprovalBlocked =
  hasOAuth &&
  (oauthStatus?.vendorApprovalStatus === VendorApprovalStatus.PENDING ||
    oauthStatus?.vendorApprovalStatus === VendorApprovalStatus.REJECTED);
```

The receiving component (`InlineOAuthSignIn`) uses `isVendorApprovalBlocked` with a fallback: `const blocked = isVendorApprovalBlocked ?? isVendorApprovalPending` — so existing callers that only pass `isVendorApprovalPending` continue to work.

## Architectural Decision: No BYOA in the Picker

During this work, the original follow-up from the OAuth BYOA integration project (T07) suggested wiring full BYOA support into the picker. After analysis, this was intentionally scoped down:

- **BYOA setup is an admin task**, not a session-setup task. It belongs on the MCP server detail page (where it already lives, fully wired)
- **The resolution chain works silently** — when an org admin sets up BYOA on the detail page, the backend's `OAuthAppResolutionService` automatically uses the org's OAuth app for all sign-in flows, including those initiated from the picker
- **connectionHealth requires per-server RPCs** — too expensive for a picker that may list many servers. Binary connected/not connected is sufficient for session setup
- **Disconnect is not a session-setup action** — it belongs on the management surface

## Benefits

- Users now see a clear "Pending approval" message when vendor approval is REJECTED (not just PENDING)
- Sign-in button is properly disabled, preventing futile OAuth attempts
- Magic number replaced with type-safe enum reference
- Consistent with the pattern already established in `useMcpServerCredentials.ts`

## Impact

- **File changed**: `sdk/react/src/mcp-server/McpServerPicker.tsx` (8 insertions, 1 deletion)
- **Users affected**: Anyone using the session-setup picker with an MCP server whose vendor OAuth app has been rejected
- **SDK surface**: No new exports, no API changes — purely internal wiring fix

## Related Work

- OAuth BYOA Integration project (20260413.01) — T06 frontend disconnect/health/error UX, T07 frontend BYOA experience
- Vendor OAuth approval gating (2026-04-12)

---

**Status**: Production Ready
