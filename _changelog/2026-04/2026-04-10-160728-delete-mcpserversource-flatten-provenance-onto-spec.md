# Delete McpServerSource and Flatten Provenance onto McpServerSpec

**Date**: April 10, 2026

## Summary

Deleted the `McpServerSource` proto message entirely and promoted `repository_url` and `github_stars` directly onto `McpServerSpec`. This completes the proto cleanup for the curated MCP marketplace transition, following the removal of the automated registry sync workflow in the previous session.

## Problem Statement

The `McpServerSource` message was designed for automated sync provenance -- tracking which registry a server came from, its registry name, version, last sync timestamp, quality score, and quality tier. With the sync workflow removed, 6 of its 8 fields were dead weight, and the remaining 2 (`repository_url`, `github_stars`) were awkwardly nested inside a wrapper that no longer served its original purpose.

### Pain Points

- `McpServerSource` carried 6 sync-only fields (`registry`, `registry_name`, `version`, `last_synced_at`, `quality_score`, `quality_tier`) that would never be populated again
- The message-level comment described automated sync concepts (deduplication, freshness tracking, deprecation detection) that no longer applied
- YAML files for curated entries would need an unnecessary `source:` nesting level
- The `CONTRIBUTING.md` still warned "do not manually add marketplace server YAMLs" -- the exact opposite of the new curated model

## Solution

Clean break from the sync model:
- Delete `McpServerSource` entirely (no reserved fields, no backward compatibility)
- Promote `repository_url` (field 12) and `github_stars` (field 13) as direct fields on `McpServerSpec`
- Rewrite `CONTRIBUTING.md` as a curated contribution guide with naming conventions, YAML template, quality bar, and 14 categories

## Implementation Details

Proto change (`spec.proto`):
```protobuf
message McpServerSpec {
  // ... existing fields 1-11 ...

  // URL of the upstream source repository for this MCP server.
  string repository_url = 12;

  // GitHub star count at the time of curation.
  int32 github_stars = 13;
}
```

The `google/protobuf/timestamp.proto` import was also removed (only used by the deleted `last_synced_at` field).

Regenerated all stubs across both repos:
- **stigmer**: `make codegen` -- Go (x3), Java, Python, TypeScript stubs + JSON schemas + SDK codegen + SDK docs + narration
- **stigmer-cloud**: `make protos` -- Java, Go, Python, TypeScript, Dart stubs

The codegen pipeline correctly handled the message deletion -- `mcpserversource.json` schema was auto-removed, and all `McpServerSourceInput` types in generated code were cleaned up without manual intervention.

## Benefits

- **Cleaner proto**: One message and 8 fields removed, 2 useful fields promoted to a natural location
- **Simpler YAML**: Curated entries use flat `repository_url` and `github_stars` at the spec level instead of nested `source.repository_url`
- **Accurate documentation**: CONTRIBUTING.md now guides contributors through the curated model instead of warning them away
- **Net reduction**: -3,346 lines deleted, +731 added across 25 files in stigmer; -2,796/+507 across 13 files in stigmer-cloud

## Impact

- **Proto schema**: `McpServerSource` message deleted, `McpServerSpec` gains fields 12-13
- **All SDKs**: Go, Java, Python, TypeScript stubs regenerated in both repos
- **Seedpack**: CONTRIBUTING.md rewritten as curated contribution guide with 14 categories
- **Task 3 (next)**: YAML files for ~40 curated servers will use the new flat structure

## Related Work

- Previous session: Removed MCP registry sync workflow from stigmer-cloud (PR #114)
- Next: Create ~40 curated MCP server YAML files in `seedpack/mcp-servers/`

---

**Status**: Production Ready
**Timeline**: ~30 minutes (proto edit + codegen + CONTRIBUTING.md rewrite + verification)
