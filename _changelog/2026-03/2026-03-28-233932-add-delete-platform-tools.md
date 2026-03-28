# Add `delete` and `delete_file` Platform Tools

**Date**: March 28, 2026

## Summary

Added first-class `delete` and `delete_file` platform tools with sandbox containment, HITL approval gating, incremental git writeback, and artifact staleness tracking. The UI layer was already fully wired — this was purely backend work across 5 production files and 3 test files.

## Problem Statement

File deletion in agent executions was only possible through the generic `execute` tool (e.g., `rm file.txt`), which created three gaps:

### Pain Points

- **No incremental writeback** — deletions were only caught by `finalize()` after the stream ends, missing the real-time commit flow that `write` and `edit` enjoy
- **No targeted approval** — deletes went through generic `execute` approval ("Execute command: rm file.txt") instead of a purpose-built "Delete file.txt" gate with destructive-red styling
- **No artifact staleness tracking** — `_on_file_modifying_tool_end` never fired for deletes, so file previews could show stale content after a deletion

## Solution

Added a dedicated `delete` platform tool following the established pattern of `read`, `write`, and `edit` — with its own backend method, tool wrapper, approval policy entry, and streaming hook. Files only (not directories), matching the safety principle that destructive operations should be scoped narrowly.

## Implementation Details

### Backend Layer — `delete(path)` methods

**`FilesystemBackend.delete(path)`**: Uses `_resolve_sandbox_path()` for containment (same security as `read`/`write`), calls `Path.unlink()`, raises `FileNotFoundError` with diagnostic details for missing files and `IsADirectoryError` for directory paths. Invalidates directory/path caches before mutation.

**`WorkspaceNormalizingBackend.delete(path)`**: Normalizes the path via `_normalize()`, shell-quotes it via `shlex.quote()` for safe delegation to `inner.execute("rm ...")`, raises `FileNotFoundError`/`RuntimeError` based on stderr, and invalidates caches.

### Tool Wrapper Layer — `_create_delete_tool`

Follows the `_create_write_tool` pattern: approval gate via `_check_and_handle_approval("delete", ...)`, calls `backend.delete(path)` on approval, catches `FileNotFoundError`/`IsADirectoryError`/`ValueError` and returns enriched error strings (not exceptions). Registered alongside `write` and `edit` in the dangerous tools section, with `delete_file` alias via `_register_alias`.

### Approval Policy

Added `"delete"` to `PLATFORM_TOOL_DEFAULTS` with `requires_approval: True` and message template `"Delete {{args.path}}"`. Added `"delete_file": "delete"` to `PLATFORM_TOOL_ALIASES`.

### Streaming Hooks

Added `"delete"` and `"delete_file"` to `_FILE_MODIFYING_TOOLS` frozenset, enabling incremental git writeback and artifact staleness tracking on delete.

### Tests

- 9 new `FilesystemBackend.delete()` tests (file deletion, subdirs, nonexistent, directory rejection, sandbox escape, absolute paths, cache invalidation, platform mount)
- 8 new `_create_delete_tool` wrapper tests (approval flow: approve/skip/reject, error handling: FileNotFoundError/ValueError/IsADirectoryError, no-checker mode)
- 2 new approval policy tests (delete requires approval, delete_file alias resolves)
- Updated existing tests: tool counts (12→13), name lists, alias descriptions, parametrized sub-agent tests

## Benefits

- **Targeted approval UX** — users see "Delete file.txt" with TrashIcon and destructive-red styling instead of a generic shell command approval
- **Real-time writeback** — file deletions are committed incrementally during execution, not deferred to finalization
- **Artifact freshness** — file previews update immediately when a file is deleted
- **Sandbox safety** — path containment enforced at the backend level, same as `read`/`write`

## Impact

- **Agents**: Can now use `delete` or `delete_file` as first-class tools with proper approval flow
- **Platform builders**: The React SDK already had full UI support (TrashIcon, destructive approval card, FileToolDetail with mode="delete") — zero UI changes needed
- **Git writeback**: Deletions now appear as incremental commits during execution

## Related Work

- Builds on the incremental git writeback system introduced in `2026-03-28-162537-incremental-git-writeback-and-artifact-staleness.md`
- Completes Phase 2 from the writeback widget error fix plan (`fix_writeback_widget_error_e40823dc.plan.md`)
- Existing HITL contract tests already referenced `delete_file` in anticipation of this tool

---

**Status**: ✅ Production Ready
**Timeline**: Single session
