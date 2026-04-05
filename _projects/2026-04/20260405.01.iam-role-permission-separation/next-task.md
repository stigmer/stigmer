# Next Task: 20260405.01.iam-role-permission-separation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260405.01.iam-role-permission-separation

**Description**: Split the monolithic ApiResourceIamPermission enum into separate IamRole and IamPermission enums, add grantable_roles to AuthorizationConfig per ApiResourceKind, and update all dependents across protos, backend, and SDKs.
**Goal**: Separate what-you-assign (roles) from what-the-system-checks (permissions) from internal-FGA-wiring (structural relations). Add admin as a first-class role. Make each ApiResourceKind declare its grantable roles so the web app can render role selectors dynamically and SDKs can validate at creation time.
**Tech Stack**: Protobuf, Java (backend FGA tuple creation), TypeScript/Go/Python/Java (SDK codegen)
**Components**: apis/ai/stigmer/iam/v1/ (IamRole + IamPermission enums, leaf package), apis/ai/stigmer/commons/apiresource/apiresourcekind/ (AuthorizationConfig with grantable_roles), apis/ai/stigmer/commons/rpc/ (RpcAuthorizationConfig + method options), stigmer-cloud/backend/ Java FGA tuple creation code, SDK codegen outputs

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
- **Last Session**: 2026-04-05 (Session 3) — Codegen validation, Go cycle fix, backend verified
- **Active Task**: T01 plan phases 1-6 validated end-to-end; phase 7 remains

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

## Session Progress (2026-04-05, Session 3)

- Ran `make protos` in stigmer repo — surfaced Go import cycle
- Root cause: `IamRole`/`IamPermission` lived in `iampolicy/v1` (a fat package with many files importing apiresource/apiresourcekind), creating circular Go package dependencies when `authorization_config.proto` imported the enum
- Fix: Moved both enums to a dedicated leaf package `ai.stigmer.iam.v1` at `apis/ai/stigmer/iam/v1/enum.proto` (zero imports, pure leaf)
- Updated 2 proto imports (`authorization_config.proto` in apiresourcekind and rpc)
- Regenerated all stubs (Go, Java, Python, TypeScript) and SDK codegen — all passed
- Ran `make protos` in stigmer-cloud — all stubs regenerated cleanly
- Built Java backend — fixed 51 Java import paths (`protos.ai.stigmer.iam.iampolicy.v1` → `protos.ai.stigmer.iam.v1`)
- Fixed pre-existing Temporal SDK bug in `CleanupSandboxWorkflowImpl.java`
- All 7 backend tests passed

## Next Steps

1. Phase 7: Update backend FGA tuple code and SDK/web role selectors to consume `grantable_roles`
2. Consider documenting the leaf-package pattern as a coding guideline

## Context for Resume

- `IamPermission` and `IamRole` now live at package `ai.stigmer.iam.v1` in `apis/ai/stigmer/iam/v1/enum.proto` (leaf package, zero imports)
- `IamRole` values: owner (1), admin (2), member (3), viewer (4)
- `IamPermission` has 20 `can_*` values + `login_to_back_office`
- `RpcAuthorizationConfig` and method options live in `ai.stigmer.commons.rpc` package
- `AuthorizationConfig.grantable_roles` is field number 7, typed as `repeated ai.stigmer.iam.v1.IamRole`
- Java stubs generate as `protos.ai.stigmer.iam.v1.IamPermission` and `protos.ai.stigmer.iam.v1.IamRole`
- Backend `AuthorizationConfigResolver` and `IamPolicyCreationService` do NOT yet read `grantable_roles` — the field is metadata for clients (web app, SDKs), not runtime tuple creation
- Codegen and backend build are fully validated — all stubs, SDK clients, and tests pass
- Go import cycle lesson: vocabulary types (enums imported by many packages) must live in leaf packages to avoid Go's package-level import cycle rules

## Blockers (if any)

- None — phases 1-6 fully validated, ready for phase 7

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-04/20260405.01.iam-role-permission-separation/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
