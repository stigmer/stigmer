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
- **Last Session**: 2026-04-05 (Session 8) — Library scope filtering: `cross_org_public` across proto, Go/Java backends, codegen, SDKs, React hooks
- **Active Task**: End-to-end testing, email-based invite, environment-level access management

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

## Session Progress (2026-04-05, Session 4)

- Added `hasGrantableRoles` and `getGrantableRoles` query methods to `AuthorizationConfigResolver` (api-shape library)
- Added `ValidateGrantableRole` pipeline step to `IamPolicyCreateHandler` (user-facing `create` path only)
- Step validates that the requested relation is a grantable role for the target resource kind
- Step placed after `authorize` (principle of least information) and before `checkIfDuplicate`
- Returns `INVALID_ARGUMENT` with descriptive messages for: unknown resource kinds, no grantable roles (system-managed), and non-grantable roles (includes allowed list)
- Bootstrap path (`IamPolicyBootstrapPolicyHandler`) is NOT affected — it continues to write structural/creator/owner tuples freely
- Build passed (`make build-java`), all 7 backend tests passed (`make test-backend`)

## Session Progress (2026-04-05, Session 5)

- Wrote 7 unit tests for `ValidateGrantableRole` pipeline step in `IamPolicyCreateHandlerTest.java`
- Used pure JUnit 5 with real protobuf objects — no Mockito dependency needed
- Tests cover: 4 happy paths (owner/viewer on agent, admin/member on organization), unknown resource kind, system-managed resource (no grantable roles), non-grantable role with allowed list in error message
- Tests double as contract tests for the authorization model (use real proto metadata as ground truth)
- Wired test into Bazel `BUILD.bazel` as `iam_policy_create_handler_test` target with strict deps (`grpc-request`, `grpc_api`)
- Fixed pre-existing `FormatString` bug in `ValidateSsoFields.java` (`.formatted(org)` applied to wrong string due to operator precedence — wrapped concatenated strings in parentheses)
- All 8 backend tests pass (`make test-backend`)

### Discovery: Mockito Not Wired in Bazel

- Several existing test files (`IdentityProviderDeleteHandlerTest`, `SearchHandlerTest`, etc.) import Mockito but have no `java_junit5_test` target in `BUILD.bazel`
- Mockito (`org.mockito`) is not declared in `MODULE.bazel` as a Maven artifact
- These tests are dead code — they exist but are never compiled or run by Bazel
- Pipeline construction tests (verifying step count and ordering) require Mockito, so they are deferred until Mockito is wired into the build

## Session Progress (2026-04-05, Session 6)

- **Track 2: Backend RPCs** — Implemented all 4 new RPCs from the IAM grantable-roles client strategy plan
- Analyzed Planton reference implementation (Postgres: JPA, JdbcTemplate, WITH RECURSIVE CTEs, json_agg) and adapted patterns for MongoDB
- Architectural decisions (confirmed with user):
  1. Role metadata via `IamRoleMetadata` Java utility class (not a MongoDB collection)
  2. In-application enrichment from `IdentityAccountRepo` (not denormalized `api_resource_index`)
  3. Application-level hierarchy traversal (not MongoDB `$graphLookup`)
- **Proto changes (stigmer repo)**:
  - 3 query RPCs: `listResourceAccessByPrincipal`, `getPrincipalResourceRoles`, `getPrincipalsCount`
  - 1 command RPC: `revokeOrgAccess`
  - All stubs regenerated, committed: `aba762e0`
- **Backend implementation (stigmer-cloud repo)**:
  - `IamRoleMetadata.java` — static role display metadata (api-shape lib)
  - `ResourceHierarchyResolver.java` — ownership chain walker using scope tuples
  - `PrincipalEnricher.java` — batch display enrichment for identity accounts
  - `IamPolicyRepo.java` — +5 query methods including MongoDB aggregation for count
  - 4 handler classes following `CustomOperationHandlerV2` pipeline pattern
  - Full Bazel build passed (57 targets), committed: `da4b45bb`

## Session Progress (2026-04-05, Session 7)

- **Track 1: Client-Side Consumption** — Full 6-phase implementation (codegen through Console integration)
- Phase 0: Created `sdk_kind_meta_ts.go` codegen — generates `resource-availability.ts` and `authorization-config.ts` from proto `kind_meta` extensions
- Phase A: SDK utils — `authorization-config.ts` (getGrantableRoles, hasGrantableRoles, isRoleGrantable), `iam-role.ts` (display names, enum-string conversion), re-exported `IamRole` from `@stigmer/sdk`
- Phase B: React hooks — `useGrantableRoles`, `useCreateIamPolicy`, `useDeleteIamPolicy`
- Phase C: React components — `useRoleSelector` (headless), `RoleSelector` (styled), `GrantAccessForm`
- Phase D: Track 2 RPC hooks — `useResourceAccess`, `usePrincipalsCount`, `useRevokeOrgAccess`, `useWhoAmI`
- Phase E: `OrgMembersPanel` — self-contained members management component with avatar, role badges, self-protection, change role, remove member, add member
- Phase F: Console integration — `MembersSection` on `/settings` page, wired to `OrgContext`, cloud-only gate

## Session Progress (2026-04-05, Session 8)

- **Library scope filtering** — Fixed "All" library view to respect org boundaries
- Added `bool cross_org_public = 6` to `SearchRequest` in `io.proto`
- Go OSS backend: Extended `SearchCriteria`, replaced `buildOrgFilter`/`buildVisibilityFilter` with unified `buildScopeFilter` in `SQLiteSearchQueryStore`, updated 18 test cases
- Java Cloud backend: Extended `SearchCriteria` record, added `orOperator` compound query in `MongoSearchQueryStore.buildQuery()`
- SDK codegen: Updated all 4 language templates (TS, Go, Python, Java) to include `crossOrgPublic` in `ListParams` and search requests
- Rebuilt `tools/generator`, regenerated all SDK client files
- React SDK: Modified `useResourceList` and `useResourceSearch` — always pass `org` as active org, toggle `crossOrgPublic` based on scope ("all" vs "org")
- Updated JSDoc for `ResourceListScope` to reflect new semantics
- "All" now shows: current org's resources (any visibility) + public resources from other orgs
- "Org" unchanged: only the current org's resources

## Next Steps

1. End-to-end testing against running backend to verify the full flow
2. Email-based invite (using `identityAccount.getByEmail()`) — friendlier than raw principal ID
3. Environment-level access management (reusing `useResourceAccess` hook for different resource kinds)
4. Document the leaf-package pattern as a coding guideline
5. Wire Mockito into `MODULE.bazel` and enable existing dead test files + pipeline construction tests
6. Add enrichment paths to `PrincipalEnricher` for non-identity-account principal kinds (service accounts, teams) when those features are built

## Context for Resume

- `IamPermission` and `IamRole` now live at package `ai.stigmer.iam.v1` in `apis/ai/stigmer/iam/v1/enum.proto` (leaf package, zero imports)
- `IamRole` values: owner (1), admin (2), member (3), viewer (4)
- `IamPermission` has 20 `can_*` values + `login_to_back_office`
- `RpcAuthorizationConfig` and method options live in `ai.stigmer.commons.rpc` package
- `AuthorizationConfig.grantable_roles` is field number 7, typed as `repeated ai.stigmer.iam.v1.IamRole`
- Java stubs generate as `protos.ai.stigmer.iam.v1.IamPermission` and `protos.ai.stigmer.iam.v1.IamRole`
- `AuthorizationConfigResolver` now exposes `getGrantableRoles(kind)` and `hasGrantableRoles(kind)` for consumers
- `IamPolicyCreateHandler` validates `relation` against `grantable_roles` before persisting — invalid roles are rejected with `INVALID_ARGUMENT`
- `IamPolicyBootstrapPolicyHandler` is NOT validated — bootstrap creates structural relations (e.g., `"organization"`, `"creator"`) that are not user-grantable roles
- `IamPolicyCreationService` uses `bootstrapPolicy` (not `create`), so it is not affected by the new validation
- Codegen and backend build are fully validated — all stubs, SDK clients, and tests pass
- Go import cycle lesson: vocabulary types (enums imported by many packages) must live in leaf packages to avoid Go's package-level import cycle rules
- `ValidateGrantableRole` step has 7 unit tests in `IamPolicyCreateHandlerTest.java`, wired into Bazel as `iam_policy_create_handler_test`
- Tests are pure JUnit 5 (no Mockito) — use real protobuf objects and real proto metadata
- Mockito is NOT available in Bazel build graph — several existing Mockito-based test files are dead code (not wired as Bazel targets)
- **Track 2 new components**: `IamRoleMetadata` (api-shape), `ResourceHierarchyResolver`, `PrincipalEnricher`, 4 handlers, 5 repo methods — all in stigmer-cloud
- **PrincipalEnricher** currently only enriches `identity_account` kind — extensible for other principal kinds
- **ResourceHierarchyResolver** capped at 10 hops — hierarchy is typically 2-3 levels deep (platform -> org -> resource)
- **Track 1 codegen**: `sdk_kind_meta_ts.go` generates `sdk/typescript/src/gen/resource-availability.ts` and `sdk/typescript/src/gen/authorization-config.ts` from Go proto stubs
- **Track 1 SDK**: `@stigmer/sdk` exports `getGrantableRoles`, `hasGrantableRoles`, `isRoleGrantable`, `iamRoleDisplayName`, `iamRoleDescription`, `iamRoleToString`, `iamRoleFromString`, `IamRole`
- **Track 1 React hooks**: `useGrantableRoles`, `useCreateIamPolicy`, `useDeleteIamPolicy`, `useResourceAccess`, `usePrincipalsCount`, `useRevokeOrgAccess`, `useWhoAmI` — all in `sdk/react/src/iam-policy/`
- **Track 1 React components**: `RoleSelector` (styled radio-group), `GrantAccessForm` (principal ID + role), `OrgMembersPanel` (full members management) — all in `sdk/react/src/iam-policy/`
- **Console**: `MembersSection` on `/settings` page reads `activeOrg` from `OrgContext`, renders `OrgMembersPanel`
- **OrgMembersPanel** discovers current user via `useWhoAmI()` internally — self-protection disables edit/remove on own account
- **Open question**: Need to verify backend populates `PrincipalAccess.principal` display fields (`name`, `email`, `avatar`) — if sparse, members list degrades to ID-only

## Blockers (if any)

- None — backend validation, access-list RPCs, and client-side V1 are all complete
- Open risk: role change (delete+create) is not atomic; if create fails after delete, user temporarily loses access

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-04/20260405.01.iam-role-permission-separation/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
