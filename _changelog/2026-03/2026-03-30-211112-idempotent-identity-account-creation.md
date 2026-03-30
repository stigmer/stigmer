# Idempotent Identity Account Creation from Auth0

**Date**: March 30, 2026

## Summary

Made the `CreateIdentityAccount` Temporal activity idempotent by handling MongoDB duplicate key errors on `spec.email`. When a user signs in via a different Auth0 provider but with the same email as an existing account, the activity now returns the existing account instead of failing and getting stuck.

## Problem Statement

The `CreateIdentityAccountFromAuth0Workflow` was getting stuck in production when an identity account creation hit a MongoDB `E11000` duplicate key error on the `spec.email` unique index.

### Pain Points

- The workflow's existing idempotency check (`findExistingIdentityAccount`) only looks up by IDP ID (`findByIdpId`), but the unique constraint is on email — a user logging in via a different Auth0 connection (e.g., Google OAuth2) with an email that already exists under another IDP ID would pass the IDP check but fail the insert.
- The duplicate key error was marked `nonRetryable=false`, so Temporal burned through all retry attempts on a deterministic failure.
- After exhausting retries, the workflow threw `RuntimeException: Identity account creation failed`, which caused an `InternalWorkflowTaskException` during replay, leaving the workflow permanently stuck (Attempt=8+).
- The stuck workflow continuously logged warnings: *"If seen continuously the workflow might be stuck."*

## Solution

Wrapped the `identityAccountGrpcRepo.create()` call in the `createIdentityAccount` activity with a try/catch that detects MongoDB duplicate key errors (`E11000`) and falls back to an email-based lookup via `identityAccountGrpcRepo.getByEmail()`, returning the existing account as if the create succeeded.

## Implementation Details

**File changed**: `CreateIdentityAccountFromAuth0ActivitiesImpl.java`

- Added `StatusRuntimeException` catch block around `identityAccountGrpcRepo.create()`
- Added `isDuplicateKeyError()` helper that checks for `E11000` and `duplicate key` in the gRPC error message
- On duplicate detection: falls back to `identityAccountGrpcRepo.getByEmail(email)` and returns the existing account
- If the email lookup also fails (unexpected edge case): throws `ApplicationFailure.newNonRetryableFailure` so Temporal does not retry an unrecoverable error
- No workflow-level changes needed — downstream steps (`writeFgaTuples` is a no-op, `createPersonalOrganization` is idempotent) work correctly with the returned existing account

## Benefits

- **No more stuck workflows**: Duplicate email scenarios resolve gracefully instead of causing permanent workflow task failures
- **No wasted retries**: Deterministic duplicate errors are either handled or marked non-retryable
- **Safe for in-flight workflows**: Change is in the activity implementation only — no Temporal workflow determinism concerns
- **Multi-provider support**: Users can sign in via different Auth0 connections (Google, GitHub, email/password) without triggering creation failures

## Impact

- **Production stability**: Eliminates the class of stuck workflows caused by duplicate email signups
- **User experience**: Users signing in from a new auth provider with an existing email get seamlessly matched to their account
- **Operations**: Reduces the need for manual workflow termination via Temporal CLI

## Related Work

- Existing idempotency: `findExistingIdentityAccount` (IDP ID check) remains the primary guard; this fix covers the email-collision edge case
- Personal org backfill: Already idempotent, unaffected by this change

---

**Status**: ✅ Production Ready
