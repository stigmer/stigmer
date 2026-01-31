# SDK: New mcpserver Package with Intuitive org/slug API

**Date**: January 31, 2026

## Summary

Created a new `sdk/go/mcpserver/` package that provides a clean, intuitive API for creating MCP server references using the org/slug model. This replaces the deprecated `mcpserverref` package which used the now-removed `Scope` field, and follows the same high-quality patterns established in the `skill` package.

## Problem Statement

The existing `mcpserverref` package used the deprecated `ApiResourceOwnerScope` enum (platform/organization/identity_account), which was removed as part of the API Resource Scope Redesign project. A new package was needed that:

### Pain Points

- Old `mcpserverref.Platform()`, `Organization()`, `Personal()` functions used the removed `Scope` field
- Inconsistent API compared to the new `skill` package
- Verbose naming (`mcpserverref.Platform("github")` vs cleaner `mcpserver.New("stigmer", "github")`)
- No parsing support for string references from configuration files

## Solution

Created a new `mcpserver` package following the exact patterns established in the `skill` package, with the key difference that MCP servers do not support versioning.

## Implementation Details

### Package Structure

```
sdk/go/mcpserver/
    mcpserver.go      (98 lines)  - Core functions
    errors.go         (45 lines)  - Error types
    doc.go            (51 lines)  - Package documentation
    mcpserver_test.go (291 lines) - Full test coverage
```

### Public API

```go
// Create reference with explicit org/slug
mcpserver.New("stigmer", "github")

// Parse "org/slug" format string
ref, err := mcpserver.Parse("stigmer/github")

// Parse or panic (for init/tests)
ref := mcpserver.MustParse("stigmer/github")
```

### Key Design Decisions

1. **No versioning support**: Unlike skills, MCP servers don't have versions. The API is simpler with no `WithVersion()` option.

2. **Consistent error handling**: Same `ParseError` wrapper with sentinel errors (`ErrInvalidFormat`, `ErrEmptyOrg`, `ErrEmptySlug`) for use with `errors.Is/As`.

3. **Comprehensive documentation**: Package-level doc.go with examples, function-level godoc on all exports.

4. **Table-driven tests**: 24 test cases covering all functions, edge cases, and explicit verification that versioning is not supported.

## Benefits

- **Clean API**: `mcpserver.New("stigmer", "github")` is clear and intuitive
- **Parsing support**: Configuration files can use `"org/slug"` strings
- **Consistent patterns**: Same API shape as `skill` package for developer familiarity
- **Full test coverage**: 24 tests pass, covering all edge cases
- **No technical debt**: Uses new `org/slug` model, no references to removed `Scope` field

## Impact

| Area | Impact |
|------|--------|
| SDK Users | New cleaner API for MCP server references |
| Agent Definitions | Will use `agent.UseMCPServer("stigmer/github")` in Sub-Task 3 |
| Configuration | String parsing enables config file support |
| Migration | Old `mcpserverref` package will be removed in Sub-Task 8 |

## Related Work

- **Phase 1**: Proto changes removed `ApiResourceOwnerScope` (completed earlier)
- **Sub-Task 1**: Created `skill` package with same patterns (completed)
- **Sub-Task 3**: Will add smart parsing to Agent package (next)
- **Sub-Task 8**: Will remove deprecated `mcpserverref` package

---

**Status**: Production Ready
**Timeline**: Part of Phase 2 SDK Refactoring (Sub-Task 2 of 8)
