# Optional Org in ApiResourceReference

**Date**: March 3, 2026

## Summary

Made the `org` field optional in `ApiResourceReference`, the proto message used across the platform for cross-resource references. This enables YAML authors to omit `org` in same-org references, making resource definitions portable across organizations and deployments.

## Problem Statement

Every cross-reference in agent specs required an explicit `org` field, even when referencing resources within the same organization. This created unnecessary coupling between resource definitions and their deployment context.

### Pain Points

- Seedpack agents hardcoded `org: local` in every `skill_refs` and `mcp_server_ref` entry
- Resources authored for one organization couldn't be used in another without rewriting cross-references
- User YAML was cluttered with redundant `org` fields that repeated the parent resource's org

## Solution

Relaxed the `org` field validation in `ApiResourceReference` from required to optional, following the established `^$|^pattern$` convention already used by `version` (in the same message) and `SearchRequest.org` (in search/v1).

When `org` is empty, it signals a relative reference — the server resolves it to the parent resource's organization at write time. All stored and returned references remain fully qualified (absolute form).

## Implementation Details

**Single proto change** in `apis/ai/stigmer/commons/apiresource/io.proto`:

- Removed `(buf.validate.field).required = true` from the `org` field
- Changed pattern from `^[a-z][a-z0-9-]*$` to `^$|^[a-z][a-z0-9-]*$`
- Removed redundant `min_len = 1` (enforced by the non-empty branch of the pattern)
- Retained `max_len = 63`
- Updated field documentation to describe relative vs absolute reference semantics

Regenerated Go and Python stubs via `make protos`.

## Benefits

- **Portable resources**: YAML definitions work across organizations without modification
- **Cleaner authoring**: Same-org references (the common case) no longer need `org`
- **Backward compatible**: All existing references with explicit `org` continue to work
- **Consistent pattern**: Follows the same `^$|^pattern$` convention used elsewhere in the proto schema

## Impact

- **Proto schema**: `ApiResourceReference.org` field validation relaxed (backward compatible)
- **Generated stubs**: Go and Python stubs regenerated (mechanical diff, no behavioral change)
- **Server**: No changes — `load_by_reference.go` already handles empty org with slug-only lookup
- **CLI**: No changes — CLI always populates org from context before sending requests
- **Users**: Can now omit `org` in cross-references (once T01.4 server-side resolution is implemented)

## Related Work

- Part of T01 (Portable Org Tenancy) initiative
- T01.1: Project proto migration to tenancy domain (complete)
- T01.2: Organization added to CLI apply pipeline (complete)
- T01.3: This change — optional org in cross-references (complete)
- T01.4: Server-side org resolution at write time (next)

---

**Status**: Production Ready
