# Auth0 Webhook Pipeline Cleanup

**Date**: May 3, 2026

## Summary

Removed the entire Auth0 webhook-based identity provisioning pipeline from stigmer-cloud and stigmer (OSS). This pipeline was dead code — replaced by the synchronous JIT/SSO auto-provisioning via `FederatedAutoProvisionerImpl` that runs during the authentication pipeline. The cleanup spans two repos, deleting ~40 files and ~6,300 lines of code, and simplifying the bootstrap migration to remove the Auth0 Management API dependency.

## Problem Statement

The codebase carried an obsolete Auth0 webhook identity provisioning pipeline consisting of:

- A Cloudflare Worker (`auth0-webhooks-receiver`) that received Auth0 signup events
- Temporal workflows and activities that created identity accounts from Auth0 webhook payloads
- A `SimulateSignupWebhook` RPC for manually triggering account provisioning
- Auth0 Management API integration (token fetcher, rotator cron, config classes)
- Associated DTOs, kustomize configs, ops secrets, and setup guides

### Pain Points

- Dead code creating maintenance burden and confusion
- Auth0 Management API credentials (`AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`) deployed but unused
- Temporal identity account task queue registered but no workflows consuming it
- Setup guides documenting a webhook flow that was already replaced
- Auth0 SDK (`com.auth0:auth0`, `com.auth0:java-jwt`) in BUILD.bazel with no runtime consumers

## Solution

Clean deletion with no deprecation period — dev-stage product with 2 users, both already provisioned. The replacement (`FederatedAutoProvisionerImpl`) was already in production.

## Implementation Details

### stigmer-cloud (71 files changed, 164 insertions, 6,328 deletions)

**Deleted (40+ files):**
- `backend/services/auth0-webhooks-receiver/` — entire Cloudflare Worker (19 files)
- `backend/services/stigmer-service/.../temporal/` — Temporal workflow/activities (10 main + 2 test files)
- `SimulateSignupWebhookHandler.java` — dead RPC handler
- `config/auth0/` — `Auth0Config`, `Auth0ManagementApiTokenFetcher`, `Auth0ManagementApiTokenHolder`, `Auth0ManagementApiTokenRotatorCron`
- `UserOnAuth0Getter.java`, `Auth0WebhookDto.java`, `Auth0WebhookDataDto.java`
- `_ops/planton/service-hub/services/auth0-webhooks-receiver.yaml`
- `_ops/planton/service-hub/variables-group/auth0-webhooks-receiver-vars.yaml`
- `_ops/setup-guides/02-auth0-webhooks.md`

**Simplified:**
- `U20250102_InsertBootstrapIdentityAccounts.java` — removed operator account creation and Auth0 Management API dependency. Machine + system account creation retained (runtime dependencies for internal service-to-service auth and audit trails). Uses `@Value("${auth0.client-id}")` instead of `Auth0Config`.

**Cleaned:**
- `application-auth0.yaml` — removed `management-api:` section
- `application-temporal.yaml` — removed dead `identity-account` task queue
- 3 kustomize files — removed `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`, `TEMPORAL_IDENTITY_ACCOUNT_TASK_QUEUE`
- `auth0-config.yaml`, `auth0-credentials.yaml` — removed management API entries
- `BUILD.bazel` — removed `@maven//:com_auth0_auth0` and `@maven//:com_auth0_java_jwt`
- `package.json`, `Makefile`, `.cursor/rules/verify-stigmer-cloud-changes.mdc`
- `_ops/scripts/scan-infra-requirements.sh`, services README
- `_ops/setup-guides/04-day0-bootstrap.md` — rewritten with manual operator creation steps
- Regenerated all stubs via `make protos`

### stigmer (OSS) (25 files changed, 103 insertions, 589 deletions)

- Removed `simulateSignupWebhook` RPC from `command.proto` (+ unused `empty.proto` import)
- Updated codegen schema `identityaccount.json`
- Ran `make codegen` — regenerated all stubs (Go, Java, Python, TypeScript, Dart), SDK client wrappers, and docs
- Updated 3 documentation files to remove webhook references

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Simplify migration, not delete | Machine + system accounts are hard runtime dependencies — `IdpIdToIdentityAccountIdCacheProxy` throws `IdentityAccountNotFoundException` for `@clients` subjects if MongoDB record missing |
| Remove operator creation from migration | Operator account has no runtime dependency — used only for manual admin tasks |
| Delete `Auth0Config` entirely | JWT validation uses `security.authentication.*` properties; machine-account uses `@Value` bindings in `MachineAccountJwtProvider` |
| Same Mongock change unit ID | Prevents re-execution on existing environments |

## Benefits

- ~6,300 lines of dead code removed across two repos
- Auth0 Management API credentials no longer deployed
- Auth0 SDK dependency removed from stigmer-service
- Temporal identity account worker no longer registered
- Cleaner bootstrap migration without external API calls
- Setup guides accurately reflect the current provisioning architecture

## Impact

- **stigmer-cloud**: Backend service, ops config, setup guides
- **stigmer (OSS)**: Proto API contract, all generated stubs, SDK client wrappers, documentation
- **Runtime**: No behavioral change — deleted code was not executing. Bootstrap migration produces same machine + system accounts without Auth0 Management API dependency.
- **Manual ops required**: Disable Auth0 Log Stream and delete Cloudflare Worker deployment

## Related Work

- Planton completed the same cleanup in [PR #1763](https://github.com/plantonhq/planton/pull/1763)
- `FederatedAutoProvisionerImpl` (the replacement) was already in production

---

**Status**: Complete
**Timeline**: Single session (~1 hour)
