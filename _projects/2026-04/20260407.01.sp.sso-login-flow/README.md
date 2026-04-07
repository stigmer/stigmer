# Sub-Project: 20260407.01.sp.sso-login-flow

## Parent Project

- **Parent**: 20260405.02.identity-provider-flow
- **Parent Path**: [../../20260405.02.identity-provider-flow/](../../20260405.02.identity-provider-flow/)
- **Spawned From Task**: N/A

---

## Overview
Implement org-aware SSO login flow in the web app, add updateFederatedAccount and deprovisionFederatedAccount lifecycle RPCs, add SSO auto-provisioning for self-managed orgs, and surface a copyable SSO login URL in the IdP management screen.

**Created**: 2026-04-07
**Status**: Active

## Sub-Project Information

### Goal
Enable org-specific SSO authentication in the Stigmer web app: org discovery on the login page, dynamic OIDC flow with the org's SSO provider, auto-provisioning for self-managed SSO orgs, federated account lifecycle RPCs (update and deprovision), and a visible SSO login URL on the IdP detail panel for admins to copy and share.

### Technology Stack
Protobuf, Java (backend services, MongoDB migrations, FGA), TypeScript/React (SDK react, web app), MongoDB

### Project Type
Feature Development

### Affected Components
stigmer-cloud/backend/ (MongoDB migration for email index, FederatedIdentityProvisionerImpl removal, new authorized identity account creation RPC, FGA permissions), apis/ (org spec for self-managed SSO, identity account command proto for new RPC, new FGA permissions), sdk/react/ (new identity-provider and iam-policy feature folders), client-apps/web/ (IdP management pages in settings), docs/ (federation flow documentation)

### Additional Context
Phase 4 of the parent project built the SSO data model (is_sso_provider, oidc_client_id, getSsoProvider RPC, SsoProviderInfo, ValidateSsoFields). Phase 6-7 built the React SDK and web app IdP management pages. This sub-project builds the runtime SSO login flow on top of that foundation. Key design decisions from our planning discussion: (1) URL-based org discovery (login?org=acme) + manual input fallback, (2) SSO-specific auto-provisioning for self-managed orgs (not platform-managed), (3) SsoProviderInfo needs expected_audience field added, (4) SSO login URL should be visible/copyable on the IdentityProviderDetailPanel when is_sso_provider is true.

## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260405.02.identity-provider-flow/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
