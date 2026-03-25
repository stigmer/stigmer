# Harden On-Behalf-Of Interceptor: Security and Correctness

**Date**: March 25, 2026

## Summary

Hardened the on-behalf-of gRPC impersonation infrastructure with three targeted fixes: explicit failure on denied impersonation attempts, correct identity fields on impersonated callers, and dead code removal. These changes close correctness gaps identified during a post-implementation audit of the OBO infrastructure.

## Problem Statement

After implementing the OBO impersonation infrastructure (projects 20260325.02 and 20260325.03), an architectural review identified three issues in the server-side interceptor that could affect security, debugging accuracy, and code hygiene.

### Pain Points

- When `x-on-behalf-of` was present but the caller was unauthorized, the header was silently discarded and the request continued as the machine account — risking the exact ownership bug the feature was built to prevent
- After OBO identity override, `RequestCallerIdentity` carried the machine account's `idpId` and `accessToken` alongside the impersonated user's `identityAccountId`, creating a semantic mismatch that produced misleading debug logs across seven context factory classes
- Dead code from pre-OBO development (`printProtoAsJson`, unused `methodName` field, orphaned protobuf imports) added noise to the interceptor

## Solution

Three surgical changes to `GrpcRequestContextBuilderInterceptor` and `RequestCallerIdentity`, keeping the scope tight and the blast radius minimal.

## Implementation Details

### Explicit Failure on Denied Impersonation

In `GrpcRequestContextBuilderInterceptor.applyOnBehalfOfOverride`, both unauthorized paths (non-machine-account caller, and machine account lacking `can_impersonate`) now throw `StatusRuntimeException(Status.PERMISSION_DENIED)` instead of silently returning the original caller identity. Both cases use an identical error description ("on-behalf-of impersonation is not authorized for this caller") to avoid leaking which check failed. Server-side `log.warn` lines are preserved with enriched context (target identity + method name) for diagnostics.

This matches Kubernetes behavior — unauthorized `Impersonate-User` returns 403, not silent fallthrough.

### Correct Identity Fields on Impersonated Caller

The impersonated `RequestCallerIdentity` now sets `idpId` and `accessToken` to `null` instead of copying the machine account's values. These fields are semantically wrong for the impersonated identity — no downstream handler code reads `getCaller().getAccessToken()` (confirmed by full codebase audit), and `getIdpId()` is only used by `IdentityAccountWhoAmIHandler` (never called through impersonated channels) and debug logging in context factories.

Javadoc on `RequestCallerIdentity` updated to document the null contract for `idpId`, `accessToken`, and `isImpersonated`.

### Dead Code Removal

Removed `printProtoAsJson` (unused private method), `methodName` field from `GrpcForwardingServerCallListener` (stored but never read), and three orphaned protobuf imports (`InvalidProtocolBufferException`, `MessageOrBuilder`, `JsonFormat`).

## Benefits

- Unauthorized impersonation attempts now fail loudly instead of silently producing wrong ownership — eliminating a class of bugs that would be extremely hard to diagnose in production
- Debug logs across all seven context factories now show `null` for impersonated callers instead of the machine account's IDP ID, making it immediately obvious when a request is impersonated
- The interceptor is 20 lines shorter with zero dead code

## Impact

**Files changed**: 2 (both in stigmer-cloud)

| File | Change |
|------|--------|
| `GrpcRequestContextBuilderInterceptor.java` | Error handling, identity correctness, dead code removal |
| `RequestCallerIdentity.java` | Javadoc updates documenting null contract for impersonated identities |

No API changes, no proto changes, no FGA model changes. Pure server-side hardening.

## Related Work

- [On-behalf-of gRPC impersonation infrastructure](2026-03-25-113851-on-behalf-of-grpc-impersonation-infrastructure.md) — the original infrastructure this hardens
- [Wire OBO impersonation into runners and FGA hardening](2026-03-25-140735-wire-obo-impersonation-into-runners-and-fga-hardening.md) — the runner wiring this complements
- [OBO implementation audit](2026-03-25-150422-obo-implementation-audit-and-runner-verification.md) — the audit that identified these gaps

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
