# Task T01: Delete Auth0 Webhook Identity Provisioning Pipeline

**Created**: 2026-05-03 09:57
**Status**: PENDING REVIEW
**Type**: Dead Code Removal
**Repos**: stigmer-cloud (primary), stigmer (proto cleanup)

## Objective

Delete the entire Auth0 webhook-based identity provisioning pipeline from Stigmer Cloud. This is dead code — the system already has synchronous JIT/SSO auto-provisioning via `FederatedAutoProvisionerImpl` running during the authentication pipeline. Clean delete, no deprecation, no backward compatibility.

## Context

Planton completed this same cleanup in [PR #1763](https://github.com/plantonhq/planton/pull/1763). Stigmer Cloud had independently built the replacement (`FederatedAutoProvisionerImpl`) but never removed the old webhook pipeline.

**Key decision**: Personal orgs are NOT relevant for federated users. Federated users are end-users of platforms built on Stigmer — they authenticate via an IdentityProvider, are managed by platform owners, and never log into the Stigmer console. No gap to fill.

## Deletion Checklist

### Step 1: Delete auth0-webhooks-receiver Cloudflare Worker

**Repo: stigmer-cloud**

- [ ] Delete `backend/services/auth0-webhooks-receiver/` (entire directory)
- [ ] Delete `_ops/planton/service-hub/services/auth0-webhooks-receiver.yaml`
- [ ] Delete `_ops/planton/service-hub/variables-group/auth0-webhooks-receiver-vars.yaml`

### Step 2: Delete Temporal Workflow + Activities

**Repo: stigmer-cloud**

- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/temporal/` (entire directory)
- [ ] Delete `backend/services/stigmer-service/src/test/java/ai/stigmer/domain/iam/identityaccount/temporal/` (entire directory)

Files being deleted:
- `IdentityAccountTemporalConfig.java`
- `IdentityAccountTemporalWorkerConfig.java`
- `IdentityAccountTemporalWorkflowTypes.java`
- `workflows/CreateIdentityAccountFromAuth0Workflow.java`
- `workflows/CreateIdentityAccountFromAuth0WorkflowImpl.java`
- `activities/CreateIdentityAccountFromAuth0Activities.java`
- `activities/CreateIdentityAccountFromAuth0ActivitiesImpl.java`
- `activities/PersonalOrganizationActivities.java`
- `activities/PersonalOrganizationActivitiesImpl.java`
- `activities/CreatePersonalOrgInput.java`
- Tests: `CreateIdentityAccountFromAuth0WorkflowTest.java`, `PersonalOrganizationActivitiesImplTest.java`

### Step 3: Delete SimulateSignupWebhook RPC

**Repo: stigmer-cloud**

- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/request/handler/SimulateSignupWebhookHandler.java`

**Repo: stigmer (OSS)**

- [ ] Remove `simulateSignupWebhook` RPC from `apis/ai/stigmer/iam/identityaccount/v1/command.proto`
- [ ] Regenerate stubs (all languages)

### Step 4: Delete Auth0 Management API Code

**Repo: stigmer-cloud**

- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/config/auth0/Auth0Config.java`
- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/config/auth0/Auth0ManagementApiTokenFetcher.java`
- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/config/auth0/Auth0ManagementApiTokenHolder.java`
- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/config/auth0/Auth0ManagementApiTokenRotatorCron.java`
- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/request/handler/library/UserOnAuth0Getter.java`
- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/dto/Auth0WebhookDto.java`
- [ ] Delete `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/identityaccount/dto/Auth0WebhookDataDto.java`

### Step 5: Cleanup Kustomize / Ops Config

**Repo: stigmer-cloud**

- [ ] Remove `AUTH0_MGMT_CLIENT_ID` and `AUTH0_MGMT_CLIENT_SECRET` from `backend/services/stigmer-service/_kustomize/base/service.yaml`
- [ ] Remove `AUTH0_MGMT_CLIENT_SECRET` from `backend/services/stigmer-service/_kustomize/overlays/prod/service.yaml`
- [ ] Remove `prod.mgmt-client-id` entry from `_ops/planton/service-hub/variables-group/auth0-config.yaml`
- [ ] Remove `prod.mgmt-client-secret` entry from `_ops/planton/service-hub/secrets-group/auth0-credentials.yaml`

### Step 6: Remove Auth0 SDK Dependency

**Repo: stigmer-cloud**

- [ ] Remove `com.auth0` SDK dependency from `BUILD.bazel` (only consumer was `UserOnAuth0Getter` and activities impl)

### Step 7: Fix Compilation + Verify Build

- [ ] Fix any remaining references to deleted code (imports, injection sites)
- [ ] Run backend build
- [ ] Run tests

## What to KEEP

- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_API_AUDIENCE`, `AUTH0_CLIENT_SECRET` — needed for JWT validation
- Auth0 web/mobile client secrets — authentication flows
- `FederatedAutoProvisionerImpl` and all JIT/SSO code — the live provisioning path
- `RequestCallerIdentityMapper` + `FederatedIdentityResolver` — live auth pipeline
- `IdpIdToIdentityAccountIdCacheProxy` — resolves direct Auth0 JWT tokens to existing accounts
- `application-auth0.yaml` config for non-management properties (domain, audience, etc.)

## Success Criteria

- All Auth0 webhook pipeline code deleted
- No references to `auth0-webhooks-receiver`, `CreateIdentityAccountFromAuth0Workflow`, `SimulateSignupWebhook`, `UserOnAuth0Getter`, or Auth0 Management API remain in active code
- Backend builds and tests pass
- `FederatedAutoProvisionerImpl` continues working unchanged

## Notes

- Dev-stage product, only 2 users, both already provisioned
- No in-flight workflow concerns
- No external consumers of the deleted code
- Auth0 Event Streams on Auth0 dashboard will start 404-ing — silent failure, cleanup is a manual ops task
