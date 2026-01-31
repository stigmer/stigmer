# CLI: Remove ApiResourceOwnerScope and Add org/slug Reference Parsing

**Date**: 2026-01-31
**Type**: Refactoring / Breaking Change Fix
**Scope**: CLI (client-apps/cli/)

## Summary

Completed Phase 4 of the api-resource-scope-redesign project. This change removes all `ApiResourceOwnerScope` references from the CLI codebase and adds a new reference parsing package to support the `org/slug` model.

## Background

Phase 1 of the project removed `ApiResourceOwnerScope` from the proto definitions, which broke the CLI (it couldn't compile). This Phase 4 work restores CLI functionality by:

1. Removing all scope-related code from CLI
2. Adding a proper reference parsing package for the `org/slug` model
3. Updating all resource resolution to use the new parser

## Changes

### New Package: `pkg/reference/`

Created a new reference parsing package with world-class design:

**Files:**
- `reference.go` (~200 lines) - Core parsing logic
- `errors.go` (~50 lines) - Error types with context
- `reference_test.go` (~350 lines) - Comprehensive table-driven tests
- `doc.go` - Package documentation
- `BUILD.bazel` - Bazel build configuration

**Features:**
- Parse `org/slug` format (e.g., `stigmer/web-search`)
- Parse `org/slug@version` format (e.g., `stigmer/web-search@v1.0`)
- Parse slug-only with context org (e.g., `web-search` with org="my-org")
- Detect resource IDs by prefix (`agt_`, `wf_`, `mcp-`, `skill_`, etc.)
- Detect UUIDs
- Comprehensive error handling with `ParseError` type
- `MustParse` for initialization/test code

### Files Modified

| File | Changes |
|------|---------|
| `internal/cli/deploy/deployer.go` | Removed 4 `OwnerScope` defaulting blocks (8 locations) |
| `internal/cli/mcpserver/applier.go` | Removed `OwnerScope` defaulting (2 locations) |
| `internal/cli/artifact/skill.go` | Removed `Scope` field from `PushSkillRequest` (2 locations), removed unused import |
| `cmd/stigmer/root/run_resolve.go` | Updated `resolveAgent()` and `resolveWorkflow()` to use reference parser, removed `Scope` field |
| `cmd/stigmer/root/mcpserver.go` | Updated get/delete commands to use reference parser, removed `Scope` field, removed `OwnerScope` display, updated help text |
| `cmd/stigmer/root/run_create.go` | Removed `OwnerScope` from execution metadata (2 locations) |

### Files Removed

- Removed local `isResourceID()` and `isUUID()` functions from `mcpserver.go` (now using `pkg/reference`)

### Help Text Updates

Updated MCP server command description to reflect the new model:
```
Before: "Support platform, organization, and personal scopes"
After:  "Referenced by org/slug format (e.g., stigmer/github)"
```

Removed `Owner Scope` from MCP server display output.

## Testing

All CLI tests pass:
- `pkg/reference`: 25 test cases covering all parsing scenarios
- `pkg/approval`: Interactive approval tests
- `pkg/ignore`: File ignore pattern tests
- `internal/cli/artifact`: Skill artifact tests
- `internal/cli/envfile`: Environment file parsing tests
- `internal/cli/synthesis`: Synthesis ordering tests

## Impact

### Breaking Changes (for CLI users)
- None - the CLI API remains the same
- Resources are still resolved by org from config/flag + slug

### Developer Impact
- All `ApiResourceOwnerScope` references removed from CLI
- New `pkg/reference` package available for future use
- Resource resolution now uses consistent parsing across all commands

## Known Issues

The Go backend services (`backend/services/stigmer-server/`, `backend/services/workflow-runner/`) still have `ApiResourceOwnerScope` references and don't compile. This is tracked as a separate task (Go backend cleanup).

## Files Changed

### New (4 files)
- `client-apps/cli/pkg/reference/doc.go`
- `client-apps/cli/pkg/reference/errors.go`
- `client-apps/cli/pkg/reference/reference.go`
- `client-apps/cli/pkg/reference/reference_test.go`
- `client-apps/cli/pkg/reference/BUILD.bazel`

### Modified (7 files)
- `client-apps/cli/internal/cli/deploy/deployer.go`
- `client-apps/cli/internal/cli/mcpserver/applier.go`
- `client-apps/cli/internal/cli/artifact/skill.go`
- `client-apps/cli/cmd/stigmer/root/run_resolve.go`
- `client-apps/cli/cmd/stigmer/root/mcpserver.go`
- `client-apps/cli/cmd/stigmer/root/run_create.go`

## Related

- **Phase 1**: Proto changes (completed) - Removed `ApiResourceOwnerScope` enum
- **Phase 2**: SDK refactoring (completed) - Added smart parsing to SDK
- **Phase 3**: Backend cleanup (completed) - Java backend updates
- **Phase 4**: CLI updates (this change)
- **Phase 5**: Documentation updates (pending)

## Verification Commands

```bash
# Build CLI packages
cd client-apps/cli
go build ./pkg/reference/...
go build ./internal/cli/deploy/...
go build ./internal/cli/mcpserver/...
go build ./internal/cli/artifact/...

# Run tests
go test ./pkg/reference/...
```
