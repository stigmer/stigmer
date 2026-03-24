# Automate Day-0 Bootstrap: Auth0 Operator Account Creation

**Date**: March 24, 2026

## Summary

Fully automated the day-0 bootstrap process for Stigmer's identity and authorization setup. The migration now auto-creates the `operator@stigmer.ai` user in Auth0 via the Management API, resolves or reuses the IDP ID, and writes all identity accounts, IAM policies, and FGA tuples without any manual configuration. This eliminates 3 manual steps from the setup workflow and removes 2,200+ lines of obsolete documentation and scripts.

## Problem Statement

Setting up a new Stigmer environment required multiple manual steps after deploying the backend service: creating an Auth0 user for the operator, copying the Auth0 user ID into a Planton variables group, configuring it through kustomize overlays, and restarting the service. The setup guides also contained obsolete documentation and hardcoded credentials.

### Pain Points

- Manual Auth0 user creation for `operator@stigmer.ai` in every environment
- Environment-specific `BOOTSTRAP_OPERATOR_IDP_ID` had to be configured in 3 places (iam-config.yaml, kustomize overlay, application-iam.yaml)
- `BootstrapConfig` Java class existed solely to shuttle one environment variable
- 6 setup guide documents when only 4 were necessary
- Obsolete developer account scripts with hardcoded credentials
- Email domains inconsistently using `stigmer.com` instead of `stigmer.ai`

## Solution

Made the migration self-sufficient by having it call the Auth0 Management API directly to resolve or create the operator user. The operator IDP ID is now determined at runtime from Auth0, eliminating all external configuration.

## Implementation Details

**Migration changes** (`U20250102_InsertBootstrapIdentityAccounts.java`):
- Added `resolveOrCreateOperatorOnAuth0()` method that fetches a Management API token via `Auth0ManagementApiTokenFetcher`, queries Auth0 for the operator by email, and creates the user if not found
- Random password generated via `SecureRandom` + Base64 (operator resets via Auth0 "Forgot Password")
- Replaced `BootstrapConfig` injection with `Auth0ManagementApiTokenFetcher`
- Graceful degradation: if Auth0 Management API fails, operator account is skipped but service still starts
- Fixed all `.com` domain references to `.ai` (emails and API versions)

**Config cleanup**:
- Deleted `BootstrapConfig.java`
- Removed `stigmer.bootstrap.*` block from `application-iam.yaml`
- Removed `BOOTSTRAP_OPERATOR_IDP_ID` env var from kustomize overlay
- Removed `prod.bootstrap-operator-idp-id` from `iam-config.yaml`

**Documentation cleanup**:
- Deleted `05-developer-accounts.md` (665 lines, obsolete)
- Deleted `06-temporal-search-attributes.md` (472 lines, worker auto-creates attributes)
- Deleted `UPDATES_SUMMARY.md` (stale changelog with hardcoded credentials)
- Deleted `scripts/` directory (5 files: Python bootstrap, shell scripts, requirements)
- Updated `01-auth0-setup.md`: removed manual operator step, renumbered to 6 steps
- Updated `04-day0-bootstrap.md`: documents automated Auth0 user creation flow

## Benefits

- **Zero manual Auth0 user management**: Operator account is auto-provisioned on first deployment
- **No environment-specific IDP IDs**: The Auth0 user ID is resolved at runtime
- **3 fewer manual steps** in environment setup
- **2,200+ lines removed**: Obsolete docs, scripts, and config
- **4 focused setup guides** (down from 6 + scripts directory)
- **Consistent `.ai` domain**: All emails and API versions use `stigmer.ai`
- **Idempotent**: Safe to run on every restart — existing Auth0 users are reused

## Impact

- **DevOps**: Simpler environment provisioning — no Auth0 user creation or IDP ID configuration needed
- **Backend**: Migration is fully self-contained with external service calls (Auth0 + OpenFGA)
- **Documentation**: Setup guides are leaner and reflect the actual automated workflow

## Related Work

- Previous session: Initial FGA tuple automation in the migration ([FGA Bootstrap Automation](../2026-03/))
- OpenFGA model update applied in same session

---

**Status**: Production Ready
**Repo**: stigmer-cloud
**Commit**: `dd90398c` on `main`
