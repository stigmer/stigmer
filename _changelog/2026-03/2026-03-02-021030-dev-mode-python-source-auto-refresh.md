# Dev Mode Python Source Auto-Refresh

**Date**: March 2, 2026

## Summary

Fixed a stale-source caching bug in the Python runtime manager that prevented code changes (like glob tool fixes) from being picked up by the agent-runner in dev mode. The runtime now always re-extracts app source and reinstalls path dependencies when the CLI is running as version "dev".

## Problem Statement

After fixing a glob tool pattern matching bug in `tool_wrappers.py` (changing `"**" in pattern` to `"/" in pattern`), the fix was committed to the repo but the running agent-runner continued using the old code. The agent's Find tool returned "No files matching" for patterns like `_changelog/2026-02/*.md` even though the files existed and the List tool could see them.

### Pain Points

- Code changes to graphton or agent-runner Python source had no effect until the developer manually ran `rm -rf ~/.stigmer/runtimes/agent-runner/`
- The manual deletion triggered a full re-bootstrap (Python download, venv creation, PyPI dep install) — a multi-minute operation for what should be a fast refresh
- No warning or indication that stale source was being used
- The Go-side binary extraction already handled dev mode correctly (`needsExtraction()` returns `true` when version is "dev"), creating an inconsistency where Go binaries were always fresh but Python source was stale

## Solution

Added a `refreshDevSource()` method to `pythonrt.Manager` that performs a lightweight source refresh: re-extract app source from the repo tree, re-copy monorepo path dependencies (graphton, stigmer-stubs), and re-run `pip install --no-deps` for the path deps. This runs on every `EnsureReady()` call when `CLIVersion == "dev"`, skipping the expensive Python download and full venv creation.

## Implementation Details

### `pythonrt/manager.go`

Modified `EnsureReady()` to detect dev mode and call the new `refreshDevSource()`:

```go
func (m *Manager) EnsureReady(ctx context.Context) error {
    if m.IsReady() {
        if m.config.CLIVersion == "dev" {
            return m.refreshDevSource(ctx)
        }
        // ... existing fast-path for production ...
    }
    return m.bootstrap(ctx)
}
```

The `refreshDevSource()` method performs four steps:
1. `os.RemoveAll(appDir)` — removes stale source (also cleans up deleted files)
2. `extractAppSource()` — copies fresh source from repo via `os.DirFS`
3. `PreInstallFn(appDir)` — copies monorepo path deps (graphton, stigmer-stubs) from repo tree
4. `runPostInstallCmds()` — reinstalls path deps into venv via `pip install --no-deps`

### Cost analysis

The refresh adds ~3-4 seconds to `stigmer server start` in dev mode:
- File copy (app source + path deps): <1 second
- Two `pip install --no-deps` for local packages: ~2-3 seconds
- No network I/O, no Python download, no PyPI resolution

Production builds (versioned CLI) are unaffected — the existing fast-path `IsReady()` check still applies.

## Benefits

- Code changes to agent-runner, graphton, or stigmer-stubs are automatically picked up on server restart
- No manual `rm -rf ~/.stigmer/runtimes/agent-runner/` ever needed in dev mode
- Consistent with Go binary extraction behavior (`needsExtraction()` already always re-extracts in dev)
- Minimal overhead (~3-4s) compared to full re-bootstrap (minutes)

## Impact

- **Developers**: `stigmer server stop && stigmer server start` is now sufficient to pick up any Python source change
- **Agent-runner**: All tool fixes (glob, grep, read, etc.) are immediately available after restart
- **Production**: No change — versioned builds continue using the efficient manifest-based cache

## Related Work

- `2026-03-02-003102-fix-glob-pattern-matching-and-skill-path-resolution.md` — the glob tool fix that exposed this stale-source issue
- `2026-03-01-065405-fix-workspace-file-scanning.md` — workspace file scanning fix also affected by stale cache
- `2026-03-01-183330-native-agent-runner-process-mode.md` — introduced the Python runtime manager

---

**Status**: Production Ready
