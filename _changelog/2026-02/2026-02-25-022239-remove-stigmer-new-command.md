# Remove `stigmer new` Command

**Date**: February 25, 2026

## Summary

Removed the `stigmer new` project scaffolding command and its exclusively-used embedded templates. This cleans the CLI surface area ahead of a future `draft project` implementation that will use AI-assisted resource creation instead of static templates.

## Problem Statement

The `stigmer new` command provided static Go project scaffolding (Stigmer.yaml, main.go, go.mod, .gitignore, README.md) with a hardcoded PR-reviewer demo. This approach had limitations:

### Pain Points

- Static templates become stale and require manual maintenance
- The hardcoded demo project (PR reviewer) doesn't represent the breadth of what Stigmer can do
- The scaffolding pattern conflicts with the platform's direction toward AI-assisted resource creation via `draft`
- Maintaining two creation paths (`new` for projects, `draft` for resources) fragments the developer experience

## Solution

Clean removal of the `new` command and all code used exclusively by it, with no replacement. The `draft project` subcommand will be designed and implemented separately once the templating and AI-assisted creation patterns are better understood.

## Implementation Details

- Deleted `client-apps/cli/cmd/stigmer/root/new.go` (341 lines) -- command definition, handler, validation, and file generation helpers
- Deleted `client-apps/cli/embedded/templates.go` -- `AgentAndWorkflow()` Go template
- Deleted `client-apps/cli/embedded/sdk_version.go` -- `GenerateGoModContent()`, `GetSDKVersionForTemplate()`, `findStigmerRepo()`
- Removed command registration from `client-apps/cli/cmd/stigmer/root.go`
- The `embedded` package remains intact (`version.go`, `embedded.go`, `extract.go`, platform-specific files are all unaffected)

## Benefits

- Cleaner CLI surface area with no dead-end scaffolding path
- Removes ~450 lines of template and scaffolding code that would need ongoing maintenance
- Clears the way for a cohesive `draft project` implementation under the existing `draft` command group

## Impact

- Users who relied on `stigmer new` will need to create project files manually until `draft project` is implemented
- No backend or SDK changes required
- No impact on existing `draft skill` functionality

## Related Work

- The `draft` command group (`draft skill`) continues to serve as the AI-assisted resource creation path
- Future `draft project` will follow the same agent-backed pattern as `draft skill`

---

**Status**: Production Ready
