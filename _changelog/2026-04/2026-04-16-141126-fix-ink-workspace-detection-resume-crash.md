# Fix Ink Workspace Detection for `stigmer resume` Crash

**Date**: April 16, 2026

## Summary

Fixed a `TypeError [ERR_UNKNOWN_FILE_EXTENSION]` crash in `stigmer resume` caused by the Ink renderer workspace detection failing when the CLI binary is installed outside the monorepo (e.g., `~/bin/stigmer`). Added CWD-based workspace detection as a fallback and changed the `stigmer-ink.tsx` shebang from `node` to `tsx`.

## Problem Statement

Running `stigmer resume <session-id>` crashed with:

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".tsx"
  for /Users/.../stigmer/sdk/ink/src/cli/stigmer-ink.tsx
```

### Pain Points

- `stigmer resume` was completely broken for users who install the binary outside the repo (common in development)
- The only workaround was setting `STIGMER_INK_CMD` manually, which is undocumented for most users
- The error message was cryptic (Node.js internals) rather than a clear CLI error

## Solution

Two-part fix targeting both the primary resolution logic and a safety net for edge cases:

1. **CWD-based workspace detection (tier 2b)**: Walk up from the current working directory to find the monorepo root when the binary-relative detection fails
2. **Shebang fix**: Change `stigmer-ink.tsx` shebang from `#!/usr/bin/env node` to `#!/usr/bin/env tsx` so the npx fallback also works in development

## Implementation Details

### Root Cause Analysis

The `resolveInkCommand()` function in `run_stream_ink.go` uses `os.Executable()` to find the binary path, then computes `workspaceRoot = filepath.Dir(exePath)/..`. When the binary is at `~/bin/stigmer`, this resolves to `~/` -- clearly wrong. Both `tsx` and `stigmer-ink.tsx` existence checks fail, falling through to `npx --yes @stigmer/ink@0.0.0-dev`. In a Yarn workspace, `npx` resolves the local package, whose `bin` entry points at the `.tsx` source file with a `#!/usr/bin/env node` shebang. Node.js v23 cannot execute `.tsx` natively.

### Changes

- **`run_stream_ink.go`**: Added `findWorkspaceRoot(dir)` that walks up from CWD checking for `node_modules/.bin/tsx` + `sdk/ink/src/cli/stigmer-ink.tsx`. Extracted `tryWorkspaceInk(root, args)` helper shared between both detection strategies.
- **`stigmer-ink.tsx`**: Changed shebang to `#!/usr/bin/env tsx`. Safe because `publishConfig` overrides `bin` to compiled `.js` for production.
- **`run_stream_ink_test.go`**: Renamed test helper to avoid name collision, updated workspace detection test to cover both strategies.

## Benefits

- `stigmer resume` works regardless of where the binary is installed
- Zero configuration needed for the common development workflow
- Existing binary-relative detection preserved for `make build` installs
- Safety net shebang prevents future regressions in the npx fallback path

## Impact

- **CLI users**: `stigmer resume` and `stigmer run` work correctly when the binary is in `~/bin/`, `$GOPATH/bin`, or Bazel output directories
- **Development workflow**: No manual `STIGMER_INK_CMD` override needed

## Related Work

- [CLI Ink Integration](2026-04-16-112010-cli-ink-integration-tui-replacement.md) -- introduced the Ink renderer and `resolveInkCommand()`
- [Post-Ink Cleanup](2026-04-16-133831-post-ink-cleanup-dead-code-sdk-transport.md) -- dead code removal after TUI replacement

---

**Status**: Production Ready
**Timeline**: 1 session
