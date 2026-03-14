# Rename Seedpack System Organization from "default" to "stigmer"

**Date**: March 14, 2026

## Summary

Replaced the `default` organization with `stigmer` as the system organization in the seedpack. This establishes naming consistency across OSS and Cloud deployments — the system org is now `stigmer` everywhere, eliminating migration friction when moving between modes. The change was purely data-driven; no Go logic was modified.

## Problem Statement

The seedpack bootstrapped a `default` organization, but the Cloud deployment targets `stigmer`. This naming mismatch created unnecessary friction:

### Pain Points

- Moving from OSS to Cloud required renaming the org from `default` to `stigmer` — a migration step that shouldn't exist
- The name `default` carried no semantic meaning; `stigmer` communicates system identity
- Proto documentation claimed "Defaults to 'default' org" — architecturally misleading since no code hardcodes a default; the seedpack YAML provides it

## Solution

Renamed the system org from `default` to `stigmer` across seedpack YAML, tests, and proto documentation. The rename leveraged the existing architecture: `embed.go` uses directory-level embeds, `seedpack.go` walks the FS generically, and `resolveApplyOrganization` reads org from YAML — so no Go control flow was touched.

## Implementation Details

**4 files changed:**

| File | Change |
|------|--------|
| `seedpack/organizations/default.yaml` → `stigmer.yaml` | Slug `default` → `stigmer`, name `Default Organization` → `Stigmer`, description updated to "System organization" |
| `seedpack/stigmer.yaml` | `org: default` → `org: stigmer`, description "Default skills" → "System skills" |
| `seedpack/seedpack_test.go` | Expected path `organizations/default.yaml` → `organizations/stigmer.yaml` |
| `apis/.../metadata.proto` | Org field comment corrected to reflect actual mechanism |

**Files confirmed safe (no changes needed):**
- `embed.go` — directory-level embed, file rename is transparent
- `seedpack.go` — generic FS walker, no filename references
- `daemon.go` bootstrap — references `organizations/` directory, not individual files
- `resolveApplyOrganization` — reads org from YAML/flags/context, no hardcoded name
- `validator.go` — already has `stigmer` in reserved project names

## Benefits

- **Zero migration friction**: OSS and Cloud use the same system org name (`stigmer`)
- **Semantic clarity**: `stigmer` communicates system identity; `default` was meaningless
- **Documentation accuracy**: proto comment now correctly describes the org mechanism
- **Architectural validation**: confirmed the codebase is already org-agnostic in code — org is purely a data concern

## Impact

- **Existing installations**: `ContentHash()` produces a different hash, triggering re-bootstrap. New `stigmer` org is created alongside the old `default` org (orphaned). Users can clear `~/.stigmer/data/` for a clean slate.
- **Seedpack resources**: All system agents, skills, and MCP servers will bootstrap under `stigmer` org instead of `default`
- **No breaking API changes**: org resolution logic is unchanged

## Related Work

- Part of project `20260314.02.org-portability-seedpack-apply` (Task 1 of 5)
- Next: Task 2 (org inheritance in apply flow), Task 3 (cross-org reference schemas), Task 4 (agent-fleet org update)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
