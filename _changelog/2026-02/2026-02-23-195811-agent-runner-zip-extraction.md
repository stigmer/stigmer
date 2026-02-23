# Agent Runner — Zip Extraction for Directory Attachments

**Date**: February 23, 2026

## Summary

Added zip extraction support to the agent-runner's `inject_attachments()` function. When an attachment has `extract=true` (set by the CLI when a directory is auto-zipped and uploaded), the agent runner now validates the archive for safety and extracts it at the mount path, making individual files available to the agent. This completes the server-side counterpart to the CLI's directory attach support.

## Problem Statement

The CLI (T03) now supports `--attach inputs/` which auto-zips the directory and uploads it with `extract=true`. However, the agent-runner had no extraction logic — it would write the zip as a single opaque file at the mount path, making the contents inaccessible to the agent.

### Pain Points

- Agents could not access individual files from attached directories
- The `extract` field on the `Attachment` proto was defined but ignored
- No safety validation existed for zip extraction from untrusted user attachments

## Solution

Three focused helper functions added to `execute_graphton.py`, with `inject_attachments()` modified to branch on `attachment.extract`:

1. **Validation first**: `_validate_zip_for_extraction()` runs before any extraction in both modes, rejecting path traversal attacks and zip bombs
2. **Local mode**: Safe file-by-file extraction via `zipfile.ZipFile.open()` (explicitly avoids `extractall()`)
3. **Daytona mode**: Follows the established `skill_writer.py` pattern — upload zip to sandbox, exec `unzip`, cleanup

## Implementation Details

### Safety Validation (`_validate_zip_for_extraction`)

- Rejects invalid zip format (`BadZipFile`)
- Rejects entries with absolute paths (`/`, `\`)
- Rejects path traversal via `..` components (using `os.path.normpath` + prefix check)
- Enforces zip bomb limits: max 1000 files, max 100 MB total uncompressed size
- Returns `list[tuple[str, int]]` — validated file paths with uncompressed sizes

### Local Mode Extraction (`_extract_zip_local`)

- Writes files one-by-one using `zipfile.ZipFile.open()`, not `extractall()`
- Creates parent directories with `os.makedirs(exist_ok=True)`
- Maintains safety guarantees established by the validation step

### Daytona Mode Extraction (`_prepare_daytona_extraction`)

- Creates target directory via `mkdir -p` in sandbox
- Stages zip as `__attachment__.zip` inside the target directory (same pattern as skill_writer's `artifact.zip`)
- Registered in `extract_targets` list for post-batch-upload extraction
- After batch upload: `cd {dir} && unzip -o __attachment__.zip && rm __attachment__.zip`

### Loop Restructuring

- `inject_attachments()` now branches on `attachment.extract` for each attachment
- Added `extract_targets: list[str]` tracking list for Daytona post-upload extraction
- Non-extract attachments flow through existing behavior unchanged
- Individual extracted files reported in `injected_files` with accurate sizes

## Benefits

- **Complete feature path**: Directory → CLI zip → upload → agent-runner extract → agent sees files
- **Security-first**: Path traversal and zip bomb protection for untrusted user attachments
- **Consistent patterns**: Follows `skill_writer.py` extraction pattern for Daytona mode
- **Clean separation**: Three focused helpers keep `inject_attachments()` readable
- **Accurate reporting**: Each extracted file appears in the system prompt with its uncompressed size

## Impact

- **Agent-runner** (`execute_graphton.py`): 329 insertions, 51 deletions
- **End users**: Can now `--attach inputs/` and the agent sees individual files from that directory
- **Resume fast-path**: No changes needed — already handles directory mount_paths correctly
- **System prompt**: No changes needed — works with both individual files and directory paths

## Related Work

- [CLI Directory Attach Support](2026-02-22-181841-cli-directory-attach-support.md) — T03: CLI auto-zips directories
- [Attachment Extract Field Proto](2026-02-22-173615-attachment-extract-field-proto-foundation.md) — T02: `bool extract = 5` on Attachment proto
- Part of project: `20260222.01.fix-attach-directory-zip-support` (T04 of 5)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
