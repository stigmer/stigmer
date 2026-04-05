# Next Task: 20260405.01.iam-role-permission-separation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260405.01.iam-role-permission-separation

**Description**: Split the monolithic ApiResourceIamPermission enum into separate IamRole and IamPermission enums, add grantable_roles to AuthorizationConfig per ApiResourceKind, and update all dependents across protos, backend, and SDKs.
**Goal**: Separate what-you-assign (roles) from what-the-system-checks (permissions) from internal-FGA-wiring (structural relations). Add admin as a first-class role. Make each ApiResourceKind declare its grantable roles so the web app can render role selectors dynamically and SDKs can validate at creation time.
**Tech Stack**: Protobuf, Java (backend FGA tuple creation), TypeScript/Go/Python/Java (SDK codegen)
**Components**: apis/ai/stigmer/iam/iampolicy/v1/ (IamRole + IamPermission enums), apis/ai/stigmer/commons/apiresource/apiresourcekind/ (AuthorizationConfig with grantable_roles), apis/ai/stigmer/commons/rpc/ (RpcAuthorizationConfig + method options), stigmer-cloud/backend/ Java FGA tuple creation code, SDK codegen outputs

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260405.01.iam-role-permission-separation/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

- **Status**: in-progress
- **Last Session**: 2026-04-05 (Session 2) — Completed Phase 5 (grantable_roles field) and Phase 6 (per-kind population)
- **Active Task**: T01 plan phases 1-6 complete; phase 7 remains

## Session Progress (2026-04-05, Session 1)

- Split `ApiResourceIamPermission` into `IamRole` (4 values) and `IamPermission` (20 values)
- Removed structural FGA relations, stale `create` permission, reserved slots
- Relocated enums to `iam/iampolicy/v1/enum.proto` (following domain pattern)
- Moved `RpcAuthorizationConfig` and method option extensions to `commons/rpc/`
- Deleted entire `rpcauthorization/` subfolder (3 files)
- Updated import paths and option annotations in 36 command/query proto files
- Updated Java imports in 64 files across stigmer-cloud (handlers, services, tests, libraries)
- Replaced hardcoded `"organization"` string with `ApiResourceKind.organization.name()`
- Replaced `ApiResourceIamPermission.owner/viewer` references with `IamRole.owner/viewer`

## Session Progress (2026-04-05, Session 2)

- Added `repeated IamRole grantable_roles = 7` to `AuthorizationConfig` message
- Added import of `ai/stigmer/iam/iampolicy/v1/enum.proto` to `authorization_config.proto`
- Populated `grantable_roles` for 12 resource kinds with direct role assignments:
  - `organization`: `[owner, admin, member]` (three-tier hierarchy)
  - 11 org-scoped resources: `[owner, viewer]` each (agent, agent_instance, session, skill, mcp_server, workflow, workflow_instance, workflow_execution, environment, identity_provider, project)
- Left 7 resource kinds with empty default (no grantable roles):
  - api_resource_version, iam_policy, identity_account, api_key, platform, agent_execution, execution_context
- Resolved open question: chose `repeated IamRole` (type-safe enum) over `repeated string`
- Updated message-level documentation with new example configurations

## Next Steps

1. Run protobuf codegen to regenerate stubs in all languages (validates phases 1-6)
2. Verify backend compiles and tests pass after all changes
3. Phase 7: Update SDK codegen and web app role selectors to use `grantable_roles`

## Context for Resume

- `IamPermission` now lives at package `ai.stigmer.iam.iampolicy.v1` (was `rpcauthorization` sub-package)
- `IamRole` is new — values: owner (1), admin (2), member (3), viewer (4)
- `RpcAuthorizationConfig` and method options moved to `ai.stigmer.commons.rpc` package
- `AuthorizationConfig.grantable_roles` is field number 7, typed as `repeated IamRole`
- `authorization_config.proto` now imports `ai/stigmer/iam/iampolicy/v1/enum.proto` (verified no circular dependency)
- Backend `AuthorizationConfigResolver` and `IamPolicyCreationService` do NOT yet read `grantable_roles` — the field is metadata for clients (web app, SDKs), not runtime tuple creation
- The `RequestAuthorizationConfigRegistryTest.java` may need a rewrite — it references planton-era imports and non-existent permissions

## Blockers (if any)

- None — proto changes are complete, awaiting codegen run

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-04/20260405.01.iam-role-permission-separation/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
