# Next Task: 20260218.01.stigmer-planton-cloud-integration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260218.01.stigmer-planton-cloud-integration

**Description**: Research and design the integration architecture for Stigmer as an agent-execution provider within Planton Cloud. Both are SaaS products with their own organizations, user accounts, and authentication. This project investigates identity federation, organization synchronization, user authentication across boundaries, and whether Stigmer should remain a standalone SaaS or become an embedded/white-label service for platforms like Planton Cloud.
**Goal**: Determine the right architecture and mechanisms for integrating Stigmer into Planton Cloud — covering identity/auth federation, organization mirroring, cross-platform user authentication, and Stigmer's product positioning (standalone SaaS vs embedded provider vs hybrid).
**Tech Stack**: Architecture design, gRPC APIs, OAuth2/OIDC, API keys, service accounts, identity federation protocols, Stigmer platform, Planton Cloud platform
**Components**: Stigmer identity/auth system, Stigmer organization management, Stigmer agent execution API, Planton Cloud identity/auth system, Planton Cloud organization management, integration API layer

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260218.01.stigmer-planton-cloud-integration/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-18 13:08
**Last Session**: 2026-02-19 — Phase 1 proto layer complete
**Current Task**: T01 Phase 1 proto — Complete. Phase 1 cloud implementation next.
**Status**: Phase 1 protos done. Next: ServiceCredential + Organization CRUD in `stigmer-cloud`.

## Session Progress (2026-02-19)

### Completed (stigmer OSS — proto layer)
- Created `ManagementMode` enum (`management_mode_unspecified`, `self_managed`, `platform_managed`) in `apis/ai/stigmer/tenancy/organization/v1/enum.proto`
- Extended `OrganizationSpec` with `management_mode`, `service_credential_ref` (`ApiResourceReference`), `external_org_id`
- Created full `ServiceCredential` proto package at `apis/ai/stigmer/iam/servicecredential/v1/` (api, spec, status, enum, io, command, query)
- Added `service_credential = 21` to `ApiResourceKind` enum (`TIER_CLOUD_ONLY`, `AUTHORIZATION_SCOPE_TYPE_ORGANIZATION`)
- Generated Go stubs for all new/updated protos

### Key Design Decisions Made
- `service_credential_ref` uses `ApiResourceReference` (org + kind + slug), consistent with `skill_refs`/`mcp_server_ref` in AgentSpec
- ServiceCredential is **org-scoped** (Planton creates `planton` org, creates `ServiceCredential` inside it)
- `external_org_id` kept: reverse-lookup key for when Stigmer slug differs from Planton's original slug
- `ServiceCredentialLifecycleState` enum for status (active / suspended / revoked)
- All Phase 1 implementation goes in `stigmer-cloud` — Organization and ServiceCredential are `TIER_CLOUD_ONLY`
- No Go controllers added to OSS server (correctly excluded)

## Next Steps
1. **[stigmer-cloud]** Implement `ServiceCredential` CRUD: Temporal workflow, MongoDB repository, FGA tuple creation, gRPC controller
2. **[stigmer-cloud]** Extend Organization CRUD: handle `management_mode` + `service_credential_ref` immutability on update
3. **[stigmer-cloud]** Validation: platform_managed requires active `service_credential_ref`; self_managed rejects it
4. **[stigmer-cloud]** Guard: block ServiceCredential deletion when orgs reference it
5. Proceed to Phase 2 once Phase 1 cloud implementation is complete

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
