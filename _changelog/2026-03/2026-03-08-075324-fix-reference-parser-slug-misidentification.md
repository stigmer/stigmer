# Fix Reference Parser Slug Misidentification as Resource IDs

**Date**: March 8, 2026

## Summary

Fixed a bug in the CLI reference parser where slugs starting with a known resource ID prefix (e.g., `mcp-server-stigmer`) were incorrectly identified as resource IDs, causing `NotFound` errors when discovering or resolving MCP servers and other resources by slug.

## Problem Statement

Running `stigmer discover mcp-server mcp-server-stigmer` returned a `NotFound` error even though the MCP server was listed and available in the current organization.

### Pain Points

- `stigmer discover mcp-server mcp-server-stigmer` failed with `McpServer not found: mcp-server-stigmer` despite the server being visible in `stigmer list mcp-servers`
- Any resource slug starting with a known ID prefix followed by a hyphen was silently misrouted to the ID-based lookup path
- The bug affected all resource types whose slugs could collide with ID prefixes: `mcp-*`, `env-*`, `agt-*`, `win-*`, `ses-*`, etc.
- The error message ("failed to get MCP server by ID") was misleading — the user never intended to look up by ID

## Solution

Replaced the loose prefix-only check (`isResourceID`) in `Parse()` with the strict `ValidateResourceID()` function that requires a complete resource ID: prefix + separator + exactly 26-character ULID body (or a valid UUID). This ensures slugs like `mcp-server-stigmer` correctly fall through to slug-based resolution.

## Implementation Details

The `isResourceIDWithKind` function checked only whether a string started with a known prefix + separator:

```go
return strings.HasPrefix(ref, prefix+"_") || strings.HasPrefix(ref, prefix+"-")
```

For the MCP server kind (`id_prefix: "mcp"`), this caused `mcp-server-stigmer` to match `mcp-` and be treated as a resource ID. The `ValidateResourceID` function already existed and enforced ULID body length, but `Parse()` was using the loose check instead.

**Changes**:
- `reference.go`: Switched `Parse()` from `isResourceID(ref)` to `ValidateResourceID(ref) == nil`
- `reference_test.go`: Updated all resource ID test cases to use proper 26-char ULIDs; added explicit regression tests for prefix-colliding slugs (`mcp-server-stigmer`, `env-production`, `agt_short`)

The loose `isResourceID` / `HasResourceIDPrefix` functions remain unchanged for intent-detection use cases elsewhere in the codebase.

## Benefits

- `stigmer discover mcp-server mcp-server-stigmer` now resolves correctly via slug-based lookup
- Eliminates an entire class of bugs where resource slugs collide with ID prefixes
- No behavioral change for valid resource IDs (prefix + 26-char ULID)
- Regression tests prevent this from recurring

## Impact

- **CLI users**: Any command that resolves resources by slug (discover, get, run, etc.) is now safe from prefix collisions
- **Built-in resources**: The seedpack's `mcp-server-stigmer` can be discovered without workarounds
- **All resource types**: The fix is generic — applies to agents, environments, workflows, sessions, and all other resource kinds

## Related Work

- Seedpack rename: `stigmer-mcp-server` → `mcp-server-stigmer` (which surfaced this bug)
- Existing `ValidateResourceID` / `ResourceIDKind` strict validation functions that were already correct

---

**Status**: ✅ Production Ready
