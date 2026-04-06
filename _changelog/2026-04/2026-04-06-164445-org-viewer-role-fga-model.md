# Organization Viewer Role — FGA Model and Proto Foundation

**Date**: April 6, 2026

## Summary

Added `viewer` as the fourth role in the organization permission hierarchy (`owner > admin > member > viewer`), updated 5 shared org-scoped resource FGA models to inherit from `viewer from organization`, added `viewer` to the organization's `grantable_roles` in proto metadata, and regenerated SDK codegen. Discovered and resolved a critical cost-exposure issue where `can_execute` on agent and workflow derived from `viewer`, which would have allowed org viewers to execute agents — contradicting the core design goal of a zero-cost-exposure read-only role.

## Problem Statement

The organization FGA model had only three roles: `owner`, `admin`, and `member`. The least-privileged role (`member`) can create environments, trigger agent executions, and create sessions — all of which carry cost implications. There was no way to grant someone read-only access to an organization without exposing the org to cost-bearing actions.

### Pain Points

- Public invite links (planned for the invitation flow) had no safe default role — `member` as the minimum created unacceptable cost exposure
- Platform builders embedding Stigmer had no way to give external stakeholders visibility into an org without granting write/execute permissions
- The role hierarchy gap between "member with full resource access" and "no access at all" was too wide for real-world access control needs

## Solution

Introduced `viewer` as the lowest role in the organization hierarchy, with carefully scoped permissions that grant visibility without execution or creation capabilities. The change spans FGA models (authorization), proto metadata (SDK validation surface), and codegen (TypeScript SDK).

## Implementation Details

### FGA Model Changes (stigmer-cloud — 6 files)

**`organization.fga`** — New role and permission updates:
- Added `viewer: [identity_account] or member` below `member` in the hierarchy
- Changed `can_view: member` → `can_view: viewer`
- Changed `can_view_access: member` → `can_view_access: viewer`
- All cost-bearing permissions unchanged: `can_create_environment: member`, `can_create_execution_in: member`

**5 shared org-scoped resources** (`agent.fga`, `skill.fga`, `workflow.fga`, `mcp_server.fga`, `project.fga`):
- Changed viewer relation from `member from organization` → `viewer from organization`
- This ensures org viewers can see shared resources (agents, skills, workflows, MCP servers, projects) without requiring member-level access

### Critical Discovery: `can_execute` Cost Exposure

During implementation, identified that `agent.fga` and `workflow.fga` both defined `can_execute: viewer`. After changing the viewer relation to include `viewer from organization`, org viewers would have inherited execution permissions — directly contradicting the zero-cost-exposure goal.

**Resolution**: Separated `can_execute` from `viewer` on both agent and workflow:
```
# Before (dangerous after viewer role addition)
define can_execute: viewer

# After (explicit enumeration, excludes org viewers)
define can_execute: [identity_account, identity_account:*] or owner or member from organization
```

This preserves public agent execution (wildcard), org member execution, and direct grants — while excluding org viewers from cost-bearing operations.

### Proto and SDK Changes (stigmer — proto + codegen)

- Added `viewer` to organization's `grantable_roles` in `api_resource_kind.proto`
- Regenerated Go proto stubs via `make go-stubs`
- Regenerated `sdk/typescript/src/gen/authorization-config.ts` via `make codegen-clients`
- No manual SDK changes needed: `iam-role.ts` already had viewer display metadata, `RoleSelector` auto-populates from codegen output

## Benefits

- **Safe invite defaults**: The upcoming invitation system can default to `viewer` for public org invite links with zero cost exposure
- **Granular access control**: Platform builders can grant read-only visibility to stakeholders, auditors, or external collaborators
- **Backward compatible**: The `member` role remains unchanged — existing members inherit `viewer` through the hierarchy (`member` → `viewer`), so all current permissions are preserved
- **SDK-ready**: `RoleSelector` for organizations now shows four options (Owner, Admin, Member, Viewer) with no code changes needed in the React components

## Impact

- **Authorization model**: 6 FGA files across 2 bounded contexts (tenancy, agentic)
- **Proto**: 1 file + regenerated Go stubs
- **SDK codegen**: 1 regenerated TypeScript file
- **Downstream**: `RoleSelector` component, `getGrantableRoles()`, `isRoleGrantable()` all automatically reflect the new role
- **No backend Java changes**: FGA models are loaded at runtime

## Related Work

- Part of the [org-invitation-flow project](../_projects/2026-04/20260406.01.org-invitation-flow/) (Track 0 — prerequisite for invitation resource)
- Builds on the [IAM role/permission separation](2026-04-05-101218-iam-role-permission-separation-and-package-relocation.md) and [grantable roles validation](2026-04-05-114936-grantable-role-validation-on-iam-policy-create.md) work

---

**Status**: ✅ Production Ready
**Timeline**: Single session
