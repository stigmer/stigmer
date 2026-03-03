# Implement Organization List, Get, and Delete CLI Handlers

**Date**: March 3, 2026

## Summary

Implemented the missing `list`, `get`, and `delete` command handlers for the Organization resource type in the Stigmer CLI. Although organization was registered in the type system and marked as supporting these verbs, the actual command routing never dispatched to organization-specific handlers, causing all three operations to return "not implemented" errors.

## Problem Statement

After adding Organization as a first-class resource in the CLI type registry, running `stigmer list organizations`, `stigmer get organization default`, or `stigmer delete organization <slug>` all returned "not implemented for Organization" errors.

### Pain Points

- `stigmer list org` → "Error: list not implemented for Organization"
- `stigmer get organization default` → "Error: get not implemented for Organization"
- `stigmer delete organization <slug>` → "Error: delete not implemented for Organization"
- The type registry and verb support matrix correctly declared Organization as supporting `get`, `list`, and `delete`, but the command routers (`routeList`, `routeGet`, `routeDelete`) had no cases for `ApiResourceKind_organization`

## Solution

Organizations are a top-level resource that don't require an existing org context for lookups (unlike agents, workflows, etc. which are scoped within an org). This means `stigmer list organizations` should work even before the user has set an active org via `stigmer context set`.

The solution follows the same special-case pattern used for executions and sessions: intercept the organization type early in `executeList`, `executeGet`, and `executeDelete` — before `resolveOrganization` is called — and route to dedicated handlers that use the `FindMyOrganizations` and `Delete` RPCs directly.

## Implementation Details

### New files: `client-apps/cli/internal/cli/organization/`

- **`get.go`**: `GetFromBackend` uses `FindMyOrganizations` to enumerate all accessible orgs, then matches by slug first, then by ID. `ListFromBackend` returns all accessible organizations.
- **`display.go`**: `DisplayGetResult` renders a single organization (table/yaml/json). `DisplayListResult` renders a table with NAME, SLUG, DESCRIPTION, and ID columns.
- **`delete.go`**: `Delete` and `DeleteFromBackend` use the `OrganizationCommandController.Delete` RPC by organization ID.

### Modified command routers

- **`list.go`**: Added `isOrganizationType` helper and `executeListOrganizations` special case before `resolveOrganization`. Updated help text and error messages to include organizations.
- **`get.go`**: Added `isGetOrganizationType` check and `executeGetOrganization` handler. Updated help text and error messages.
- **`delete.go`**: Added `isDeleteOrganizationType` check and `executeDeleteOrganization` handler with confirmation prompt warning about cascading resource deletion. Updated error messages.

### Design decisions

- **Slug-first matching**: `GetFromBackend` matches by slug before ID, since CLI users almost always reference orgs by slug.
- **Helpful error messages**: When an org slug isn't found, the error lists all available organizations.
- **No org context required**: All three handlers bypass `resolveOrganization`, using `FindMyOrganizations` directly. This is correct because organizations are the top-level tenant boundary, not scoped within another org.

## Benefits

- All declared verb support for Organization now actually works
- Users can discover, inspect, and manage organizations through the standard CLI verbs
- Consistent UX: `stigmer list org`, `stigmer get org default`, `stigmer delete org my-org` all work as expected
- Organization operations work even before an org context is set

## Impact

- **CLI users**: Can now use `list`, `get`, and `delete` for organizations, completing the CRUD surface alongside the existing `apply`
- **Files changed**: 3 new files, 3 modified files (184 lines added)

## Related Work

- Organization command/query controllers (backend)
- Organization apply handler (already existed in `apply_file_handlers.go`)
- CLI context set command (uses `FindMyOrganizations` internally)

---

**Status**: ✅ Production Ready
