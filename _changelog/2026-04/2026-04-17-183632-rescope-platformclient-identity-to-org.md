# Rescope PlatformClient Identity Resolution to Org-Level

**Date**: April 17, 2026

## Summary

Changed PlatformClient JIT provisioning so that IdentityAccount resolution is scoped by organization rather than by individual PlatformClient. The same end user presenting the same `user_id` via any PlatformClient owned by the same org now resolves to a single IdentityAccount with one set of FGA grants. This matches the overwhelmingly common embedding pattern where a customer has multiple apps (dashboard, mobile, admin) for the same user population.

## Problem Statement

The original PlatformClient design scoped identity resolution per-PlatformClient: the composite `idp_id` was `stgm_pc|{platform_client_id}|{external_user_id}`. This meant that if Acme had three PlatformClients (dashboard, mobile, admin) and John signed in through all three, Stigmer created three separate IdentityAccounts for the same human. Each had its own FGA grants, its own audit trail, and its own IAM policy entries.

### Pain Points

- A customer's user list showed 3x the actual user count
- Revoking access required deleting three separate grants per user
- Audit trail was fragmented across three principal identities
- FGA role grants had to be issued once per PlatformClient, not once per user
- The common multi-app scenario (dashboard + mobile + admin for the same user base) was the default case, not the exception

## Solution

Rescoped the composite `idp_id` from `stgm_pc|{platform_client_id}|{external_user_id}` to `stgm_pc|{org}|{external_user_id}`. Since org slugs are globally unique in Stigmer, this preserves the global uniqueness invariant while collapsing same-org, same-user entries into a single IdentityAccount.

## Implementation Details

### Proto docstrings (stigmer, source of truth)

- `apis/ai/stigmer/iam/identityaccount/v1/spec.proto` --- updated both `idp_id` documentation blocks (message-level and field-level) to describe the new org-scoped composite format
- `apis/ai/stigmer/iam/platformclient/v1/spec.proto` --- added identity resolution paragraph above the three provisioning modes
- `apis/ai/stigmer/iam/platformclient/v1/token.proto` --- tightened `user_id` field comment from "unique within the platform" to "unique within the org"
- Generated stubs regenerated across Go, Java, TypeScript, Python, Dart via `make codegen` (stigmer) and `make protos` (stigmer-cloud)

### Java handler changes (stigmer-cloud)

- `PlatformClientIdentityEncoding.composeIdpId(org, externalUserId)` replaces `composeIdpId(platformClientId, externalUserId)` --- the value object's parameter, javadoc, and format example all updated
- `PlatformClientAccountProvisionerImpl.resolveOrProvision()` now extracts `org` from `platformClient.getMetadata().getOrg()` instead of `clientId` from spec
- `PlatformClientProvisioningException.UnknownUserException` now reports the org name, not the PlatformClient ID, in its error message

### Tests

- `PlatformClientIdentityEncodingTest` --- rewritten for org-scoped parameters, added test proving same-org-different-clients produces identical composites
- `PlatformClientAccountProvisionerImplTest` --- `expectedIdpId()` now uses org, added `OrgScopedResolutionTests` nested class with three new tests: cross-client idempotency, cross-org isolation, and idp_id-contains-org-not-clientId assertion

### Documentation

- `docs/guides/platform-client-auth.mdx` --- added paragraph in JIT provisioning section explaining org-scoped identity resolution and the need for consistent, stable user identifiers across apps

## Benefits

- One IdentityAccount per end user per customer org, regardless of how many PlatformClients the customer operates
- One set of FGA grants per user --- no duplicate role assignments
- Unified audit trail per user across all of a customer's apps
- Accurate user counts in the Console
- Single revocation point per user

## Impact

- **Who**: Platform builders embedding Stigmer via PlatformClient
- **Breaking**: Yes --- existing `idp_id` format changes. No production data exists (pre-GA feature on `feat/platform-client` branch). Dev/test data must be wiped.
- **Repos**: stigmer (proto docstrings + docs + generated stubs), stigmer-cloud (Java handlers + tests + generated stubs)

## Related Work

- [Platform Client Proto Definition](2026-04-17-110512-platformclient-proto-definition.md)
- [Platform Client Auth Chain and JIT Provisioning](2026-04-17-160746-platform-client-auth-chain-jit-provisioning.md)
- [Platform Client SDK Auth Helpers](2026-04-17-165012-platform-client-sdk-auth-helpers.md)
- [Platform Client Console UI](2026-04-17-171918-platform-client-console-ui.md)

---

**Status**: Production Ready (pre-GA, no migration needed)
**Timeline**: 1 session
