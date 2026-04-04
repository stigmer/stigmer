# Commons Proto Documentation

**Date**: April 4, 2026

## Summary

Added per-value and per-field documentation comments across the commons proto package so that auto-generated SDK docs on the commons page have no blank description cells. The highest-impact fix was the `ApiResourceKind` enum, where 12 of 19 values had empty descriptions in the published SDK reference.

## Problem Statement

The `commons` package contains shared types and enums referenced by every API resource. The SDK docs generator (`sdk_docs.go`) produces a dedicated `commons.mdx` page from `commons.json`, rendering Value/Description tables for enums and TypeTable rows for message fields. Missing proto comments resulted in blank cells in published documentation.

### Pain Points

- 12 out of 19 `ApiResourceKind` enum values had no description — appearing as empty rows on the SDK commons page
- `ApiResourceEventType` had informal comments; 5 of 6 values had none
- `ApiResourceStateOperationType` had zero documentation — no enum comment, no value comments
- `PageInfo` had no message or field comments
- `GooglePageInfo` used inconsistent, informal comment style
- `rpc_service_options.proto` had no explanation of the service extension
- `ApiResourceVersion` enum values had no descriptions
- `ApiResourceId` used a terse, unhelpful comment

## Solution

Systematic documentation pass across 5 proto files, adding standalone first-sentence comments to every undocumented enum value, message, and field. Comments follow the existing `@internal` convention where appropriate. Section-header comments in `ApiResourceKind` were preserved for proto readability but detached (via blank line) so per-value comments are what the schema extractor picks up.

## Implementation Details

### `api_resource_kind.proto` (Tier 1 — SDK-visible)

- Added per-value comments to all 19 `ApiResourceKind` values including the zero value
- Detached section-header comments (e.g., `// Agentic - AI agent management`) with blank lines so they don't attach to enum values
- Added value-level comments to `ApiResourceVersion` enum (`api_resource_version_unspecified`, `v1`)

### `enum.proto` (Tier 2)

- Rewrote `ApiResourceEventType` enum comment to first-sentence + `@internal` style
- Added per-value comments to all 6 values
- Added enum-level comment and per-value comments to `ApiResourceStateOperationType` (previously undocumented)

### `pagination.proto` (Tier 2)

- Added message-level comment to `PageInfo` (offset-based pagination)
- Documented `num` (1-indexed page number) and `size` fields
- Cleaned up `GooglePageInfo` to proper first-sentence convention

### `rpc_service_options.proto` (Tier 2)

- Added two-line comment explaining the `api_resource_kind` service extension purpose

### `io.proto` (Tier 2)

- Improved `ApiResourceId` message comment from informal to convention-following

## Benefits

- Zero blank cells in the `ApiResourceKind` table on the published commons SDK page
- Internal developers reading `enum.proto` and `pagination.proto` now have clear explanations
- Consistent comment style across the entire commons package
- Comments follow the `@internal` convention established in the agent protos

## Impact

- **SDK users**: Every enum value in the commons types table now has a description
- **Internal developers**: All shared proto types now have explanatory comments
- **Files changed**: 5 proto files in `apis/ai/stigmer/commons/`

## Related Work

- Proto documentation improvements for agent, session, skill, mcpserver, environment, agentinstance, agentexecution, and executioncontext resources (prior sessions on this branch)
- SDK docs generator enhancements for clickable types and cross-linking

---

**Status**: ✅ Production Ready
