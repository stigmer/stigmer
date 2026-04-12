# Vendor OAuth Approval Status Gating

**Date**: April 12, 2026

## Summary

Added a vendor approval lifecycle status to OAuth apps so that MCP servers backed by vendor OAuth (Slack, Figma, Salesforce) can gate the sign-in button while the platform's OAuth app is pending marketplace approval. Users see an informational banner with a documentation link and can still connect using their own tokens via the manual override path.

## Problem Statement

Vendor OAuth apps require marketplace review before third-party OAuth flows can be used publicly. Slack, Figma, and Salesforce each have multi-week approval processes. During this period, users clicking "Sign in to connect" would hit errors because the OAuth app is not yet authorized by the vendor.

### Pain Points

- No way to indicate that a platform-managed OAuth app is still pending vendor approval
- The sign-in button was enabled even when the OAuth flow would fail
- Users had no guidance on how to connect while waiting for approval
- No structured place to track vendor approval lifecycle across OAuth apps

## Solution

Introduced a `VendorApprovalStatus` enum on `OAuthAppSpec` with four states: `UNSPECIFIED` (treated as approved for backwards compatibility), `PENDING`, `APPROVED`, and `REJECTED`. Added a `vendor_approval_docs_url` field for linking to documentation on bringing your own tokens.

The status is surfaced on `McpServerAuth` as a read-only enrichment at query time — the backend resolves the referenced `OAuthApp` and copies the approval fields before returning the MCP server to the frontend, avoiding an extra API round trip.

## Implementation Details

### Proto Layer (stigmer repo)
- `OAuthAppSpec`: Added `VendorApprovalStatus vendor_approval_status` (field 9) and `string vendor_approval_docs_url` (field 10)
- `McpServerAuth`: Added read-only `vendor_approval_status` (field 5) and `vendor_approval_docs_url` (field 6) resolved from the referenced `OAuthApp`
- Full stub regeneration across Go, TypeScript, Python, Java, and JSON schemas

### Backend (stigmer-cloud repo)
- `McpServerVendorApprovalEnricher` service: resolves `oauth_app_ref`, loads the `OAuthApp`, copies approval fields onto `McpServerAuth`
- Pipeline enrichment steps added to `McpServerGetHandler` and `McpServerGetByReferenceHandler`
- Migration `U20260412b_SetVendorOAuthApprovalPending` (order 016): sets all three vendor OAuth apps to `PENDING` with a placeholder docs URL

### Frontend (stigmer repo)
- `useMcpServerCredentials`: new `isVendorApprovalPending` and `vendorApprovalDocsUrl` fields
- `McpServerDetailView` ConnectBar: amber "Pending approval" pill, disabled sign-in button, informational banner with docs link
- `McpServerConfigPanel` `InlineOAuthSignIn`: disabled sign-in with amber status and docs link
- `McpServerPicker`: passes vendor approval props through to config panel
- Manual override ("Enter token manually") remains available in all states

### Documentation
- `docs/guides/bring-your-own-oauth.mdx`: placeholder guide explaining the situation, workaround steps, and vendor-specific token generation links

## Benefits

- Users see a clear explanation instead of cryptic OAuth errors during the approval period
- The manual token path is highlighted as a workaround, unblocking users immediately
- Platform operators can update the approval status per-vendor as approvals complete
- `UNSPECIFIED = approved` ensures zero impact on existing OAuth apps without the field

## Impact

- All three vendor OAuth MCP servers (Slack, Figma, Salesforce) now show "Pending approval" with the sign-in button disabled
- Users can still connect via manual token entry
- When a vendor approves the OAuth app, a single field update (`PENDING` -> `APPROVED`) enables the sign-in flow

## Related Work

- Vendor OAuth bootstrap migration (`U20260411_SeedVendorOAuthApps`)
- Manual token override feature (`feat(sdk): add manual token override for OAuth MCP servers`)
- Slack marketplace submission project (`20260412.01.slack-marketplace-submission`)

---

**Status**: Production Ready
**Timeline**: Single session
