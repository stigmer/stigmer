# Seedpack Organization Bootstrap and Portable Cross-References

**Date**: March 3, 2026

## Summary

The seedpack now bootstraps a real Organization resource (`default`) on every Stigmer server start, and all hardcoded `org: local` references have been removed from seedpack YAML resource files. Cross-references between resources (skill_refs, mcp_server_usages) now use the relative reference pattern — empty org, resolved at write time by the server's NormalizeReferencesStep.

## Problem Statement

The seedpack contained hardcoded `org: local` in agent metadata and cross-references, tying resources to a specific organization slug that had no corresponding Organization resource. This created two issues:

### Pain Points

- Resources authored locally could not be applied to Stigmer Cloud without rewriting org references
- The `local` organization was a magic string with no real resource backing it — agents existed in a namespace that didn't correspond to an actual Organization
- Every resource had to repeat `org: local` in its metadata and every cross-reference, violating DRY

## Solution

Three coordinated changes make the seedpack self-contained and portable:

1. **Organization resource**: A real `default` Organization is now bootstrapped, giving the namespace a concrete backing resource
2. **Project-level org declaration**: `stigmer.yaml` declares `metadata.org: default`, and the CLI propagates this to all child resources — no per-resource org needed
3. **Relative cross-references**: Agent YAML files omit `org` from `skill_refs` and `mcp_server_usages` — the server's NormalizeReferencesStep fills it from `metadata.org` at write time

## Implementation Details

**New file** — `seedpack/organizations/default.yaml`:
- Organization with slug `default`, management_mode `self_managed`
- Labeled `stigmer.ai/system: "true"` following existing seedpack convention
- Proto validation satisfied: slug 2-15 chars, lowercase, starts with letter

**Seedpack project manifest** — `seedpack/stigmer.yaml`:
- Added `org: default` to metadata
- The CLI's `resolveApplyOrganization()` reads this and uses it as the org for all resources in the apply session

**Agent YAML files** (3 files, 9 line removals):
- `agent-creator.yaml`: removed `metadata.org: local`, `mcp_server_ref.org: local`, `skill_refs[0].org: local`
- `mcp-server-creator.yaml`: same three removals
- `skill-creator.yaml`: removed `skill_refs[0].org: local`

**Embedding infrastructure**:
- `embed.go`: added `//go:embed organizations` directive
- `BUILD.bazel`: added `"organizations/**"` to embedsrcs glob
- `seedpack_test.go`: added `organizations/default.yaml` to expected files

## Benefits

- **Portability**: Seedpack resources work identically on local and cloud deployments — no org rewriting needed
- **Self-contained project**: The seedpack demonstrates the correct pattern — declare org once in `stigmer.yaml`, not in every resource
- **Real Organization resource**: The `default` org is a real, queryable resource with proper metadata, not a magic string
- **Forward-compatible**: New resource types added to the seedpack inherit the org automatically

## Impact

- **Seedpack**: Content hash changes — next server start will trigger re-bootstrap (expected, documented)
- **T01.7 scope narrowed**: With the seedpack declaring its own org, T01.7 only needs to change the CLI's fallback default (when no project/flag/config provides an org)
- **User projects**: Sets the example pattern — declare `metadata.org` in `stigmer.yaml`, omit org from cross-references

## Related Work

- [Server-Side Org Reference Resolution](2026-03-03-034240-server-side-org-reference-resolution.md) — T01.4, the NormalizeReferencesStep that makes empty org work
- [Organization OSS Server Controllers](2026-03-03-033905-organization-oss-server-controllers.md) — T01.5, the server-side CRUD that stores the Organization resource
- [Optional Org in ApiResourceReference](2026-03-03-030755-optional-org-in-api-resource-reference.md) — T01.3, the proto change that allows empty org
- [Add Organization to CLI Apply Pipeline](2026-03-03-025519-add-organization-to-cli-apply-pipeline.md) — T01.2, the CLI support that processes Organization YAML

---

**Status**: Production Ready
**Timeline**: T01.6 of the Portable Org Tenancy project (T01.1–T01.6 complete, T01.7–T01.10 remaining)
