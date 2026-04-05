# Next Task: 20260405.01.iam-role-permission-separation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260405.01.iam-role-permission-separation

**Description**: Split the monolithic ApiResourceIamPermission enum into separate IamRole and IamPermission enums, add grantable_roles to AuthorizationConfig per ApiResourceKind, and update all dependents across protos, backend, and SDKs.
**Goal**: Separate what-you-assign (roles) from what-the-system-checks (permissions) from internal-FGA-wiring (structural relations). Add admin as a first-class role. Make each ApiResourceKind declare its grantable roles so the web app can render role selectors dynamically and SDKs can validate at creation time.
**Tech Stack**: Protobuf, Java (backend FGA tuple creation), TypeScript/Go/Python/Java (SDK codegen)
**Components**: apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/ (split enum), apis/ai/stigmer/commons/apiresource/apiresourcekind/ (add grantable_roles to AuthorizationConfig and ApiResourceKind), all command/query .proto files using permission annotations, stigmer-cloud/backend/ Java FGA tuple creation code, SDK codegen outputs

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
- **Last Session**: 2026-04-05 — Completed Phase 1 (enum split) and Phase 2 (package relocation)
- **Active Task**: T01 plan phases 1-4 complete; phases 5-7 remain

## Session Progress (2026-04-05)

- Split `ApiResourceIamPermission` into `IamRole` (4 values) and `IamPermission` (20 values)
- Removed structural FGA relations, stale `create` permission, reserved slots
- Relocated enums to `iam/iampolicy/v1/enum.proto` (following domain pattern)
- Moved `RpcAuthorizationConfig` and method option extensions to `commons/rpc/`
- Deleted entire `rpcauthorization/` subfolder (3 files)
- Updated import paths and option annotations in 36 command/query proto files
- Updated Java imports in 64 files across stigmer-cloud (handlers, services, tests, libraries)
- Replaced hardcoded `"organization"` string with `ApiResourceKind.organization.name()`
- Replaced `ApiResourceIamPermission.owner/viewer` references with `IamRole.owner/viewer`

## Next Steps

1. Run protobuf codegen to regenerate stubs in all languages
2. Verify backend compiles and tests pass after import changes
3. Phase 5: Add `grantable_roles` repeated field to `AuthorizationConfig` in `authorization_config.proto`
4. Phase 6: Populate `grantable_roles` for each `ApiResourceKind` that supports role assignments
5. Phase 7: Update SDK codegen and web app role selectors to use `grantable_roles`

## Context for Resume

- `IamPermission` now lives at package `ai.stigmer.iam.iampolicy.v1` (was `rpcauthorization` sub-package)
- `IamRole` is new — values: owner (1), admin (2), member (3), viewer (4)
- `RpcAuthorizationConfig` and method options moved to `ai.stigmer.commons.rpc` package
- The `RequestAuthorizationConfigRegistryTest.java` may need a rewrite — it references planton-era imports and non-existent permissions
- Java generated stubs will change path: remove `rpcauthorization` segment from package

## Blockers (if any)

- None — proto changes compile-ready, awaiting codegen run

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-04/20260405.01.iam-role-permission-separation/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
