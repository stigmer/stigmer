# IAM Client-Side: Codegen, SDK Utilities, React Hooks, OrgMembersPanel, Console Integration

**Date**: April 5, 2026

## Summary

Implemented the complete client-side stack for IAM role/permission separation — from proto metadata codegen through SDK utilities, React hooks, a full-featured `OrgMembersPanel` styled component, and Console integration. This delivers organization members management as a self-contained, SDK-first feature that platform builders can embed in their own applications.

## Problem Statement

After separating `IamRole` from `IamPermission` at the proto level (Sessions 1-3), adding `grantable_roles` to `AuthorizationConfig` (Session 2), implementing backend validation (Session 4-5), and building access-list RPCs (Session 6), the client-side had no way to consume any of this. The web app couldn't render role selectors, list organization members, or manage access.

### Pain Points

- `CLOUD_ONLY_KINDS` in `resource-availability.ts` was hand-maintained — a new resource kind with `tier: cloud_only` required remembering to update a static set
- No TypeScript utilities for role display names, descriptions, or validation
- No React hooks for the new IAM policy RPCs (`listResourceAccessByPrincipal`, `getPrincipalsCount`, `revokeOrgAccess`)
- No component existed for managing organization members (listing, inviting, changing roles, removing)
- The Console settings page had API Keys and Environments but no members section

## Solution

A 6-phase implementation following the Stigmer layered architecture — each phase builds on the previous:

1. **Codegen** — Generate TypeScript from proto metadata, eliminating manual synchronization
2. **SDK utilities** — Pure functions for role validation and display in `@stigmer/sdk`
3. **React data/behavior hooks** — RPC wrappers in `@stigmer/react`
4. **Headless + styled components** — Reusable role selector and grant access form
5. **OrgMembersPanel** — Self-contained members management component
6. **Console integration** — Thin shell on the `/settings` page

## Implementation Details

### Phase 0: Codegen (`tools/codegen/generator/sdk_kind_meta_ts.go`)

New Go codegen file that reads `kind_meta` extensions from compiled proto stubs:
- Extracts `ResourceTier` → generates `sdk/typescript/src/gen/resource-availability.ts` with `CLOUD_ONLY_KINDS` set
- Extracts `grantable_roles` → generates `sdk/typescript/src/gen/authorization-config.ts` with `GRANTABLE_ROLES` map
- Hooked into `runSDKClientTSGeneration` via `sdk_client_ts.go`
- `resource-availability.ts` now imports from generated output instead of maintaining a static set

### Phase A: SDK Utilities (`@stigmer/sdk`)

- `authorization-config.ts`: `getGrantableRoles(kind)`, `hasGrantableRoles(kind)`, `isRoleGrantable(kind, role)` — consume the generated `GRANTABLE_ROLES` map
- `iam-role.ts`: `iamRoleDisplayName(role)`, `iamRoleDescription(role)`, `iamRoleToString(role)`, `iamRoleFromString(str)` — role enum ergonomics
- Re-exported `IamRole` from protos for single-import convenience

### Phase B-C: React Hooks and Components (`@stigmer/react`)

Hooks (all in `sdk/react/src/iam-policy/`):
- `useGrantableRoles(kind)` — local-read hook, no RPC
- `useCreateIamPolicy()` / `useDeleteIamPolicy()` — mutation hooks
- `useRoleSelector(kind)` — headless hook with `RoleOption[]` and selection state
- `useResourceAccess(resourceRef)` — data hook wrapping `listResourceAccessByPrincipal`
- `usePrincipalsCount(resourceRef)` — data hook wrapping `getPrincipalsCount`
- `useRevokeOrgAccess()` — behavior hook wrapping `revokeOrgAccess`
- `useWhoAmI()` — cached data hook wrapping `identityAccount.whoAmI()`

Components:
- `RoleSelector` — styled radio-group with role name, description, selection state
- `GrantAccessForm` — principal ID input + `RoleSelector` + submit

### Phase E: OrgMembersPanel (`@stigmer/react`)

Self-contained styled component for organization members management:
- Fetches members via `useResourceAccess` and member count via `usePrincipalsCount`
- `MemberRow` with avatar, name/email, role badges (direct vs inherited), action menu
- Self-protection via `useWhoAmI()` — disables edit/remove on current user's own row
- Change role flow: inline `RoleSelector`, sequential delete+create
- Remove member flow: inline confirmation, calls `revokeOrgAccess`
- Add member section using `GrantAccessForm` pre-wired for organization resource kind
- Loading skeleton, empty state, and error state

### Phase F: Console Integration

- `MembersSection.tsx` — thin Console shell reading `activeOrg` from `OrgContext`
- Cloud-only gate via `useResourceAvailable(ApiResourceKind.iam_policy)`
- Added as first section on `/settings` page (above API Keys and Environments)

## Benefits

- **Zero manual synchronization**: `CLOUD_ONLY_KINDS` and `GRANTABLE_ROLES` are generated from proto metadata — adding a new resource kind with grantable roles requires zero TypeScript changes
- **SDK-first**: All hooks and components live in `@stigmer/react`, reusable by platform builders
- **Headless-first**: Every styled component has a corresponding headless hook — `useRoleSelector` without `<RoleSelector />` is a first-class API
- **Self-protection**: Current user cannot accidentally remove themselves from an organization
- **Layered**: Console has zero business logic — it passes `orgId` to `OrgMembersPanel` and nothing else

## Impact

- **Platform builders**: Can now embed `<OrgMembersPanel orgId={...} />` in their own apps with one line
- **Console users**: Can manage organization members from the Settings page
- **SDK developers**: 8 new React hooks and 3 new components available for access management
- **Codegen pipeline**: Extended to generate authorization metadata alongside existing client/doc outputs

## Related Work

- [IAM Role/Permission Separation and Package Relocation](2026-04-05-101218-iam-role-permission-separation-and-package-relocation.md)
- [Add Grantable Roles to AuthorizationConfig](2026-04-05-103958-add-grantable-roles-to-authorization-config.md)
- [Grantable Role Validation on IAM Policy Create](2026-04-05-114936-grantable-role-validation-on-iam-policy-create.md)
- [ValidateGrantableRole Unit Tests](2026-04-05-120840-validate-grantable-role-unit-tests.md)
- [IAM Access-List Backend RPCs](2026-04-05-130700-iam-access-list-backend-rpcs.md)

---

**Status**: ✅ Production Ready (pending end-to-end testing against running backend)
**Timeline**: Session 7 of the IAM Role/Permission Separation project
