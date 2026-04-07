# Design Decision 001: SSO Auto-Provisioning with Viewer Role

**Date**: 2026-04-07
**Status**: Approved
**Context**: Phase 3 of the SSO login flow sub-project

## Decision

When a user authenticates via an SSO-enabled IdP (`is_sso_provider = true`) and no federated identity account exists, Stigmer auto-creates the account and grants the **viewer** role on the organization — not the member role.

## Rationale

- The **member** role enables creating agent executions, which involves money (compute costs). Granting it automatically on first SSO login would be a financial risk.
- The **viewer** role gives the user access to see the org's resources without the ability to trigger billable actions.
- An org admin must explicitly upgrade a user from viewer to member after they sign in for the first time.
- This gives org admins a natural review step: users appear in the org's member list as viewers, and admins promote them when ready.

## Scope

- **Self-managed SSO orgs only**: Auto-provisioning applies when the IdP has `is_sso_provider = true`.
- **Platform-managed IdPs**: Unchanged. The platform explicitly creates accounts via `createFederatedAccount` and grants whatever role it wants. No auto-provisioning.

## Alternatives Considered

- **Member role**: Rejected — too permissive, enables billable actions without admin approval.
- **No role (just account creation)**: Rejected — the user would get 403 on every API call, which is a confusing UX after a successful login. Viewer gives them a meaningful session.
- **Require pre-provisioning (no auto-creation)**: Rejected — too much friction for enterprise SSO. Admins don't want to manually create accounts for every employee.
