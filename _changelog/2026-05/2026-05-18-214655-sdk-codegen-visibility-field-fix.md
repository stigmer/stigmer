# SDK Codegen: Add Visibility Metadata to All Generated Input Types

**Date**: May 18, 2026

## Summary

Fixed all 4 SDK code generators (Go, TypeScript, Python, Java) to include the `visibility` field from `ApiResourceMetadata` in generated input types. This was preventing seedpack workflows from being created with `visibility_public`, which in turn meant the Cloud backend never created the FGA public viewer tuples needed to make them visible to all users.

## Problem Statement

After running `stigmer seedpack apply --force`, the 3 system workflows (content-review-pipeline, research-and-summarize, support-ticket-triage) did not appear in the web console's workflow library page. The page showed "No workflows yet" despite the workflows existing in MongoDB.

### Pain Points

- Workflows existed in the DB but had no `visibility` field in metadata (should have been `visibility_public`)
- No public viewer IAM policies were created for workflows (while MCP servers had them)
- Users outside the `stigmer` org could not see any workflows
- The FGA authorization check (`can_view`) denied access because no wildcard viewer tuple existed

## Solution

The root cause was in the SDK code generators, not in the backend or frontend. All 4 generators (Go, TypeScript, Python, Java) shared the same `metaFieldNames` map that correctly recognized `Visibility` as a metadata field and excluded it from spec fields — but none of them actually wired it through the metadata struct/class, `toProto()` conversion, or `FromProto()` extraction. The visibility value was silently dropped during the `proto → SDK input → proto` roundtrip in the CLI's apply flow.

## Implementation Details

**4 generator files modified** in `tools/codegen/generator/`:

- `sdk_client.go` (Go): Added `Visibility` to struct definition, `toProto()` metadata literal, and `FromProto()` metadata extraction
- `sdk_client_ts.go` (TypeScript): Added `visibility` to interface, `ApiResourceVisibility` import, and both `buildProto()` metadata branches (oneof and non-oneof)
- `sdk_client_python.go` (Python): Added `visibility: int = 0` to dataclass and `metadata.visibility = self.visibility` to `_to_proto()`
- `sdk_client_java.go` (Java): Added `ApiResourceVisibility` field, constructor, Builder field/setter, `setVisibility()` in `toProto()` metadata builder, and import

**90 generated SDK files regenerated** via `make codegen` — all resource input types across all 4 SDKs now carry `Visibility` through the roundtrip.

**Data cleanup**: Deleted the 3 stale workflow records (plus 3 workflow instances, 6 workflow IAM policies, 9 workflow instance IAM policies) from production MongoDB. Re-applying seedpack will recreate them with correct visibility and FGA tuples.

## Benefits

- All resource types that support public visibility (Workflow, Agent, McpServer, Skill) now correctly propagate `metadata.visibility` from YAML through the SDK to the backend
- Seedpack workflows will be visible to all users after re-apply
- Future resources with `visibility: visibility_public` in their YAML will work correctly out of the box

## Impact

- **All 4 SDKs** (Go, TypeScript, Python, Java) — generated input types now include visibility
- **CLI seedpack apply** — visibility is no longer silently dropped
- **Cloud backend** — no changes needed; `CreateAuthorizationTuplesStepV2` already handled `visibility_public` correctly
- **Web console** — no changes needed; once FGA tuples exist, the search service returns the workflows

## Related Work

- [FGA Public Visibility Tuples Investigation](../_changelog/2026-05/2026-05-18-fga-public-visibility-tuples-investigation.md) — earlier investigation into public visibility tuples migration failure

---

**Status**: ✅ Production Ready
