# CLI: Directory Attachment Support for `--attach`

**Date**: February 22, 2026

## Summary

Added directory support to the CLI `--attach` flag. When a directory is passed, the CLI automatically zips its contents (skipping hidden files and symlinks), uploads the archive, and marks it with `extract: true` so the agent runner can extract it at the mount path. This is part of a multi-task effort to enable seamless directory attachments across the CLI, server, and agent runner.

## Problem Statement

Users had to individually list every file when attaching directory contents to agent executions. For a directory with 10+ files, this was tedious and error-prone.

### Pain Points

- `--attach` rejected directories with a hard error
- No way to pass an entire directory of context files to an agent
- Users resorted to manual zipping outside the CLI, losing the auto-extraction capability

## Solution

Extended `processFile()` to detect directories and delegate to a new `processDirectory()` method. The directory is zipped in-memory using Go's `archive/zip`, uploaded via the existing `UploadAttachment` RPC, and the returned `Attachment` proto is annotated with `extract: true` and an appropriate `mount_path`.

## Implementation Details

### New File: `run_attachments_zip.go` (107 lines)

- `zipDirectory(dirPath)` -- pure function that walks a directory, creates a zip archive with Deflate compression, preserves relative paths, and returns the bytes along with file count and original size
- `isHiddenEntry(name)` -- identifies hidden files/dirs by Unix dot-prefix convention
- `maxAttachmentSize` constant (10MB) -- matches server's `grpc.MaxRecvMsgSize`

### Modified File: `run_attachments.go` (197 lines, was 156)

- `processFile()` -- replaced directory rejection with delegation to `processDirectory()`
- `processDirectory()` -- orchestrates zip creation, size guard enforcement, upload, and proto annotation (`Extract: true`, `MountPath: "inputs/{dirname}/"`)
- `uploadBytes()` -- extracted from `uploadFile()` to enable direct byte upload without temp files; `uploadFile()` is now a thin wrapper

### BUILD.bazel

- Added `run_attachments_zip.go` to source list

### Key Design Decisions

- **10MB limit** discovered during implementation (server is configured for 10MB, not the 4MB mentioned in proto comments)
- **Symlinks skipped** with per-symlink warning -- avoids cycle and security risks
- **Hidden files filtered** by dot-prefix convention (`.git`, `.DS_Store`, `.env`, etc.)
- **No temp files** -- zip bytes passed directly to upload via the refactored `uploadBytes()` method

## Benefits

- Users can now do `stigmer draft skill --attach inputs/` instead of listing 5-10 individual files
- Hidden files automatically excluded -- no accidental `.git` or `.env` uploads
- Clear error messages for edge cases (empty directory, oversized zip)
- Existing file attachment behavior completely unchanged

## Impact

- **CLI users**: Significantly simpler workflow for attaching multi-file context
- **Codebase**: Clean file split keeps both files under 200 lines per CLI coding guidelines
- **Future work**: T04 (agent runner extraction) and T05 (integration testing) will complete the end-to-end flow

## Related Work

- T02: Added `bool extract = 5` field to `Attachment` proto (prerequisite, completed earlier this session)
- T04: Agent runner zip extraction (next task)
- T05: Integration testing (final task)

---

**Status**: In Progress (T03 complete; T04 and T05 remaining)
**Timeline**: T03 completed in single session
