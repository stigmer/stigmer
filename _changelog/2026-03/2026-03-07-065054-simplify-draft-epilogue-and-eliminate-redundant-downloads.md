# Simplify Draft Epilogue and Eliminate Redundant Artifact Downloads

**Date**: March 7, 2026

## Summary

Cleaned up the post-execution output of `stigmer draft` commands by eliminating redundant artifact downloads when local workspaces handle file delivery, replacing the raw session-ID status line with a clean resume command, and condensing artifact download messages into a compact summary.

## Problem Statement

When `stigmer draft mcp-server` was invoked with `--workspace` pointing to local paths (the common pattern for onboarding scripts), three UX defects surfaced.

### Pain Points

- **Duplicate file creation**: The agent wrote files directly to the local workspace (`LocalPathSource`), then `--output` (default `"."`) triggered an artifact download creating a second copy in the repo root. This left orphaned files in git status.
- **Noisy, unhelpful epilogue**: Five lines of internal implementation detail — "Session ses-01kk... completed", "Downloading 1 artifact(s) to ...", per-file download messages, "All artifacts downloaded" — none actionable for the user.
- **No resume affordance**: The session ID appeared as a label, not as a copy-pasteable `stigmer run <session-id>` command. Users who Ctrl+C'd mid-stream had no obvious way to re-attach.

## Solution

Three coordinated changes across the CLI and the onboarding scripts:

1. **Smart artifact download skip**: Draft commands with local workspaces no longer download artifacts by default (the agent writes directly to disk). Users who need explicit artifact download can pass `--output <dir>`.
2. **Clean session exit line**: Replaced the raw "Session XXX completed" line with a colored status + copy-pasteable resume command, applied universally to all session-based commands.
3. **Compact artifact summary**: Replaced verbose per-file download messages with a single summary line.

## Implementation Details

### `draft_handler.go` — Download skip logic

Changed `--output` default from `"."` to `""`. Added a three-way switch in `executeDraft`:

```go
switch {
case opts.Detach:
    downloadDir = ""
case downloadDir == "" && len(localWorkspaceRoots(prep.WorkspaceEntries)) > 0:
    // Agent writes directly to local workspaces; artifact download is redundant.
case downloadDir == "":
    downloadDir = "."
}
```

Backward compatible: `stigmer draft skill -m "..."` (no workspace) still downloads to `.`.

### `run_display_summary.go` — Session exit line

Rewrote `displaySessionExitLine` to use `climsg` for colored status output and added `sessionResumeVerb` for context-appropriate resume hints:

| Phase | Status line | Resume hint |
|-------|-------------|-------------|
| completed | `Completed (42s)` | `To continue:  stigmer run <id>` |
| failed | `Failed: <error>` | `To retry:    stigmer run <id>` |
| cancelled | `Cancelled` | `To resume:   stigmer run <id>` |

### `run_handlers.go` — Compact artifact summary

Restructured `downloadArtifacts`, `downloadArtifact`, `downloadFileArtifact`, and `downloadDirectoryArtifact` to separate downloading from display. Downloads are silent; a compact summary prints once at the end via `displayArtifactSummary`. Single artifact: `Saved planton.yaml (2.3 KB)`. Multiple: a header + indented entries.

### Shell scripts (agent-fleet)

Removed redundant `=== Onboarding Complete ===` banners and `Output: ...` lines from both `00_onboard-planton-mcp-server.sh` and `01_generate-approval-policy.sh`. Kept only domain-specific "Next steps" that the CLI cannot know.

## Benefits

- **No duplicate files**: Eliminates the stale `planton.yaml` copy in the repo root
- **Cleaner output**: Five lines of noise reduced to two actionable lines
- **Discoverability**: Resume command is always visible and copy-pasteable
- **Universal improvement**: The session exit line change benefits all session-based commands (`run` and `draft`), not just draft

## Impact

- **CLI users**: Cleaner post-execution output for all `stigmer draft` and `stigmer run` commands
- **Script authors**: Scripts wrapping `stigmer draft` no longer need to suppress or work around noisy output
- **Onboarding workflow**: The agent-fleet onboarding scripts produce focused, readable output

## Related Work

- Inline streaming UX polish (2026-03-04)
- Bubbletea inline renderer migration (2026-03-05)
- Single-file artifact fix (2026-03-07-044944)

---

**Status**: ✅ Production Ready
