# CLI Runner Guides (T04) and Lifecycle Sidebar Fix

**Date**: April 24, 2026

## Summary

Added three CLI runner management guides under `docs/guides/runners/` and fixed the CLI sidebar to include the lifecycle command group (`up`, `down`, `status`, `logs`, `setup`, `reset`). This completes Phase A task T04 of the desktop app documentation project, closing the last how-to guide gap for runner management.

## Problem Statement

Six projects delivered runner, desktop, and CLI features over the past week. The code was done but CLI runner management had no how-to guides, and six lifecycle commands (`up`, `down`, `status`, `logs`, `setup`, `reset`) were invisible in the docs sidebar despite having generated MDX pages.

### Pain Points

- Users wanting to manage runners from the CLI had no guide content — only auto-generated reference pages with flags and no workflow context.
- The `stigmer up` and `stigmer down` commands were not listed in the CLI sidebar, making them undiscoverable through docs navigation.
- The T02 discovery incorrectly diagnosed the sidebar gap as `GroupID == ""` on the commands. The actual cause was the `lifecycle` group missing from `gen-cli-docs` output configuration.

## Solution

Created a three-page guide section under `docs/guides/runners/` following the established Diataxis how-to pattern and section landing page convention. Fixed the CLI docs generator to include the lifecycle group in sidebar output.

## Implementation Details

### CLI Sidebar Fix

Modified `client-apps/cli/cmd/gen-cli-docs/main.go`:
- Added `"lifecycle"` to `groupOrder` (after `"core"`, matching the group registration order in `root.go`)
- Added `"lifecycle": "Lifecycle"` to `groupTitles`
- Regenerated with `make gen-cli-docs` — `meta.json` and `index.mdx` now include a Lifecycle section

### Guide Pages

**Structural departure from T01 plan**: The original plan specified `local-runner.mdx` (native) + `docker-runner.mdx` (Docker) + `stop-and-cleanup.mdx`. Merged native and Docker into one `local-runner.mdx` because Docker is a single flag (`--runtime docker`), not a separate concept. Added `overview.mdx` as a section landing page instead — consistent with all other guide sections. Page count unchanged (3 pages).

| File | Content |
|------|---------|
| `docs/guides/runners/overview.mdx` | Section landing with CLI vs Desktop vs Web Console comparison, Cards, prerequisites |
| `docs/guides/runners/local-runner.mdx` | Starting runners (naming, native, Docker, multi-runner, backends, state files) |
| `docs/guides/runners/stop-and-cleanup.mdx` | Stopping runners (per-runner, all, everything; standalone vs daemon-managed; state cleanup) |
| `docs/guides/runners/meta.json` | Sidebar config with title "Runners (CLI)" |

### Sidebar Wiring

Updated `docs/guides/meta.json` to include `"runners"` after `"desktop"` — both sections are about running agents locally, just different interfaces.

### Cross-Link Verification

All existing links from T02 (`concepts/runners.mdx`) and T03 (`guides/desktop/manage-runners.mdx`) target `/docs/guides/runners/local-runner` — matches the new file slug. New pages cross-link to CLI reference pages (now in sidebar), desktop guides, concepts page, and SDK reference.

## Benefits

- Users can now find CLI runner management guides in the docs sidebar under Guides > Runners (CLI).
- Six lifecycle commands are now discoverable in the CLI sidebar under a "Lifecycle" section.
- The guide content covers the full CLI runner workflow: start (native + Docker), naming, multi-runner, backend connection, stop, daemon vs standalone, and state file management.
- Cross-links between concepts, desktop guides, CLI guides, and SDK reference create a complete navigation web for runner documentation.

## Impact

- **Documentation**: `docs/guides/runners/` — 3 new pages, 1 new meta.json
- **CLI sidebar**: `docs/cli/commands/meta.json` and `index.mdx` regenerated with lifecycle group
- **Guides sidebar**: `docs/guides/meta.json` updated with runners section
- **Codegen**: `client-apps/cli/cmd/gen-cli-docs/main.go` — 2 lines changed (groupOrder + groupTitles)

## Related Work

- T02 runner concepts page (`docs/concepts/runners.mdx`) — provides foundational understanding linked from these guides
- T03 desktop app guide (`docs/guides/desktop/`) — parallel guide set for the GUI approach, cross-linked
- T05 SDK React runner docs (next task) — will complete Phase A documentation

---

**Status**: ✅ Production Ready
**Project**: 20260424.01.desktop-app-promotion (T04)
