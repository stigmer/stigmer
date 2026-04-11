# Add `scope_parameter_name` to OAuthAppSpec

**Date**: April 11, 2026

## Summary

Added a `scope_parameter_name` field to `OAuthAppSpec` to support OAuth vendors that use non-standard query parameter names for scopes in their authorization URL. This fixes the `invalid_scope` error when connecting to Slack, which requires user token scopes to be sent as `user_scope` instead of the standard `scope` parameter.

## Problem Statement

Slack's V2 OAuth API uses `user_scope` as the query parameter for user token scopes, rather than the OAuth 2.0 standard `scope`. Our `buildAuthorizationURL` functions in both Go and Java were hard-coded to always emit `&scope=...`, causing Slack to reject the authorization request with `invalid_scope` for user-only scopes like `search:read`.

### Pain Points

- OAuth Connect flow for Slack MCP server failed with `invalid_scope` error
- User-only Slack scopes (`search:read`) are not valid as bot scopes, so sending them via the standard `scope` parameter caused immediate rejection
- No mechanism existed to customize the scope query parameter per vendor

## Solution

Added an optional `scope_parameter_name` field to the `OAuthAppSpec` proto. When empty (the default), both Go and Java handlers use the standard `"scope"` parameter. When set (e.g., `"user_scope"` for Slack), the authorization URL uses the specified parameter name instead. This keeps the fix generic and extensible for any future vendor with non-standard scope parameters.

## Implementation Details

### Proto (stigmer)

- Added `string scope_parameter_name = 8` to `OAuthAppSpec` in `apis/ai/stigmer/iam/oauthapp/v1/spec.proto`
- Regenerated all stubs (Go, Java, Python, TypeScript, Dart) via `make codegen`

### Go Handler (stigmer)

- `buildAuthorizationURL` in `initiate_oauth_connect.go` now accepts a `scopeParamName` parameter
- `initiateVendorOAuth` reads the value from `oauthApp.GetSpec().GetScopeParameterName()`
- `initiateDCR` passes `"scope"` explicitly (DCR always uses standard OAuth)

### Java Handler (stigmer-cloud)

- `buildAuthorizationUrl` in `McpServerInitiateOAuthConnectHandler.java` now accepts a `scopeParameterName` parameter
- Vendor OAuth path reads the value from the OAuthApp spec
- DCR path passes `"scope"` explicitly

### Mongock Migration (stigmer-cloud)

- New migration `U20260411b_PatchSlackOAuthAppScopeParam.java` (order `"014"`) patches the existing Slack OAuthApp document with `spec.scopeParameterName = "user_scope"`
- Idempotent, does not modify the original seeding migration (order `"013"`)

## Benefits

- Slack OAuth Connect flow now works correctly, sending scopes as `user_scope`
- Generic solution: any future vendor with non-standard scope parameters can be supported by setting this field on their OAuthApp
- Backward compatible: empty value defaults to standard `"scope"`, so Figma, Salesforce, and all DCR servers are unaffected
- Minimal change footprint: one proto field, two handler edits, one targeted migration

## Impact

- **Users**: Slack MCP server OAuth Connect flow unblocked
- **Platform**: No breaking changes; all existing OAuthApps continue to work with default behavior
- **Architecture**: OAuthApp aggregate correctly owns vendor-specific OAuth configuration, consistent with DDD placement principles

## Related Work

- `2026-04-11-115305-t05-vendor-oauth-bootstrap-migration.md` — Original Slack OAuthApp seeding
- `2026-04-11-132434-fix-oauth-connect-error-simplify-ux.md` — Earlier OAuth Connect UX fixes
- Project: `_projects/2026-04/20260410.03.mcp-oauth-connect/`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
