# Seedpack Bootstrap and Organization Hierarchy Fix

**Date**: March 3, 2026

## Summary

Fixed a chicken-and-egg problem in the seedpack bootstrap where system agents were unreachable after the org-tenancy migration. Established Organization as a prerequisite (not a project member) and implemented two-phase seedpack bootstrap to enforce the resource hierarchy.

## Problem Statement

After the org-tenancy migration (T01.1–T01.9), running `stigmer draft skill` or `stigmer list agents` returned "No Agent found". System agents existed under org `local` (pre-migration), but the CLI context resolved to `default` (post-migration).

### Pain Points

- `stigmer draft skill` failed with "skill-creator agent not found" — blocking skill regeneration
- `stigmer list agents` showed no agents under org `default` — confusing for users
- Organization resources were applied alongside (and after) agents in alphabetical filesystem order — no hierarchy enforcement
- The seedpack bootstrap had no concept of prerequisite ordering — treated all resources equally

## Solution

Enforced the resource hierarchy **Organization → Project → Members** at the CLI level:

1. Organization is no longer applied as part of project declarative apply
2. Seedpack bootstrap runs in two phases: organizations first, then project members
3. `stigmer apply -f` works for Organization resources without requiring an org context (they are self-identifying by slug)
4. Draft command errors now show which org was searched and provide recovery steps

## Implementation Details

### Organization removed from declarative project apply

`detectResourceItems` in `apply_declarative.go` now skips Organization kind with a clear warning directing users to `stigmer apply -f`. A project should never create its parent.

### Conditional org resolution in file-mode apply

New `requiresOrgContext()` helper in `apply_file.go`. When all items in a `stigmer apply -f` invocation are Organization kind, `resolveOrganization` is skipped entirely. This is safe because the OSS server identifies Organizations by slug (not by parent org).

### Two-phase seedpack bootstrap

`EnsureSeedpackBootstrapped` in `daemon.go` now runs:

- **Phase 1**: `stigmer apply -f <tmpDir>/organizations/` — creates the default Organization with no org context needed
- **Phase 2**: `stigmer apply --config <tmpDir>` — applies agents, skills, MCP servers under the org from `stigmer.yaml`. Organization YAMLs are harmlessly skipped by the declarative flow.

### Improved draft diagnostics

`displayDraftAgentNotFoundError` now shows the org that was searched and provides numbered troubleshooting steps: verify agents, check context, re-bootstrap.

## Benefits

- Seedpack bootstrap works correctly on first run and after upgrades
- Clear enforcement of resource hierarchy — eliminates ordering bugs
- `stigmer apply -f` is now the canonical way to manage Organizations
- Users get actionable error messages instead of generic "not found"
- Clean recovery path via existing `stigmer server reset` command

## Impact

- **CLI apply pipeline**: Organization kind excluded from declarative project apply, supported in file-mode apply without org context
- **Seedpack bootstrap**: Two-phase with guaranteed ordering
- **Draft commands**: Better diagnostics for system agent lookup failures
- **Existing installations**: Users run `stigmer server reset && stigmer server` to re-bootstrap under org `default`

## Related Work

- T01.2: Organization apply pipeline (`client-apps/cli/internal/cli/organization/`)
- T01.5: Organization OSS controllers (`backend/services/stigmer-server/pkg/domain/organization/controller/`)
- T01.6: Seedpack updates (organizations/default.yaml, stigmer.yaml metadata.org)
- T01.7: Unified organization context and CLI defaults

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
