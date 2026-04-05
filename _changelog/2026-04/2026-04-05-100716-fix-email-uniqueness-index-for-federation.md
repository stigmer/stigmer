# Fix MongoDB Email Uniqueness Index for Federation Support

**Date**: April 5, 2026

## Summary

Replaced the unique sparse index on `spec.email` in the `identity_account` collection with a non-unique ascending index. This eliminates `E11000 duplicate key` errors that would occur when a federated user from a platform shares an email address with a direct Stigmer user — a legitimate scenario in Stigmer's multi-tenant federation model.

## Problem Statement

The original migration (`U20250101_IdentityAccountIndexes`) created a `unique(true).sparse(true)` index on `spec.email`. This design assumed that email addresses would be globally unique across all identity accounts.

### Pain Points

- A federated user provisioned through a platform's identity provider and a direct Stigmer user can legitimately share the same email address — they are separate accounts with separate trust boundaries.
- The unique constraint would cause `E11000 duplicate key` errors when creating the second account, blocking the entire federation flow.
- Email is not an identity key in Stigmer's domain model — `spec.idpId` (the external identity provider's subject identifier) serves that role. The email index should only exist for query performance, not for uniqueness enforcement.

## Solution

Created a corrective Mongock migration (`U20260405_FixEmailUniqueness`, order `"008"`) that:

1. Drops the existing `spec.email_1` unique sparse index (idempotent — handles the case where it doesn't exist)
2. Recreates it as a standard non-unique ascending index for query performance

The original migration (`U20250101`) is not modified — Mongock migrations are immutable once applied.

## Implementation Details

**New file**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/U20260405_FixEmailUniqueness.java`

Key design decisions:

- **Dropped `sparse`**: The original index was both unique and sparse (excluding null emails from the index). The replacement is a standard non-sparse index, allowing future queries for accounts without email addresses (e.g., data quality audits).
- **Idempotent execution**: The `dropIndex` call is wrapped in try/catch, so the migration is safe to re-run.
- **Honest rollback**: The rollback attempts to restore the unique sparse index but documents that it will fail if duplicate emails were inserted after the forward migration — an acceptable and expected outcome.

Existing indexes on `identity_account` are unaffected:
- `metadata.id_1` (unique)
- `spec.idpId_1` (non-unique)
- `metadata.org_1` (non-unique)
- `status.audit.createdAt_-1` (descending)
- `search_text_index` (text index including `spec.email` from `U20260308`)

## Benefits

- Unblocks the identity provider federation flow — federated and direct users can now share email addresses without errors
- Preserves query performance for `findByEmail` and `findByIdOrEmail` lookups via the non-unique ascending index
- Foundation for Phase 2 (remove JIT provisioning) and Phase 3 (explicit federated account creation RPC)

## Impact

- **Backend**: Single migration file in `stigmer-cloud`. No changes to query logic, proto definitions, or application code.
- **Production data**: Safe to apply — `dropIndex` is a metadata operation, no data is modified.
- **Risk**: Minimal. The brief window between drop and recreate (milliseconds) may cause email queries to fall back to collection scan, with no functional impact.

## Related Work

This is Phase 1 of the Identity Provider Flow project (`20260405.02.identity-provider-flow`). Subsequent phases:
- Phase 2: Remove JIT provisioning
- Phase 3: New `createFederatedAccount` RPC with compound unique index on `(identity_provider_ref, idp_id)`
- Phase 4: Self-managed SSO design

---

**Status**: Production Ready
