# Fix Invitation getByToken Public Endpoint Authentication

**Date**: May 22, 2026

## Summary

Fixed the `getByToken` invitation preview endpoint to be truly public (no authentication required). The endpoint was incorrectly configured with `is_skip_authorization` (which only skips FGA checks) instead of `is_public` (which skips authentication entirely), causing "Invitation not found" errors for users visiting invite links.

## Problem Statement

Users visiting invitation links (`/invite/<token>`) were seeing "Invitation not found" errors despite the invitation data existing and being valid in MongoDB.

### Pain Points

- The `getByToken` RPC was documented as a "public, unauthenticated endpoint" but actually required authentication
- The proto option `is_skip_authorization = true` only skips FGA authorization checks — it does NOT skip the authentication interceptor
- Unauthenticated users were rejected with `grpc-status: 16` (UNAUTHENTICATED) before the handler could run
- The web app's auth redirect flow created a confusing UX where users had to log in before they could even preview an invitation

## Solution

Changed the proto method option from `is_skip_authorization` to `is_public` on the `getByToken` RPC in `ai/stigmer/iam/invitation/v1/query.proto`. The `is_public` option is checked by the `GrpcSecurityConfigBase` authentication interceptor and causes it to skip token validation entirely for the annotated endpoint.

## Implementation Details

- Modified `apis/ai/stigmer/iam/invitation/v1/query.proto`:
  - Replaced `option (ai.stigmer.commons.rpc.is_skip_authorization) = true` with `option (ai.stigmer.commons.rpc.is_public) = true`
  - Updated the method comment to reference `is_public` instead of `is_skip_authorization`
- Regenerated all proto stubs (Go, TypeScript, Java, Python, Dart) in both repositories

## Benefits

- Invitation preview now works without authentication, matching the documented design intent
- New users can see the organization name, role, and invitation validity before signing in
- Smoother invite acceptance UX: preview first, then "Sign in to accept"

## Impact

- **Frontend**: The `useInvitationPreview` hook will now succeed for unauthenticated users
- **Backend**: The authentication interceptor skips token validation for `getByToken`
- **Security**: No risk — the `InvitationPreview` response is a safe projection that omits token values, redemption history, and internal metadata

---

**Status**: ✅ Production Ready
