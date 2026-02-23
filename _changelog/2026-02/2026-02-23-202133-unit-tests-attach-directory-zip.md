# Unit Tests for Directory & Zip Attachment Support

**Date**: February 23, 2026

## Summary

Added comprehensive unit test coverage for the directory-attach feature (T02-T04) across both the Python agent-runner and the Go CLI. These tests cover safety-critical paths including zip validation, path traversal protection, zip bomb guards, local and Daytona sandbox extraction, and the full attachment injection orchestrator. This is the final task (T05) in the `20260222.01.fix-attach-directory-zip-support` project, bringing all five tasks to completion.

## Problem Statement

The directory-attach feature introduced several new functions across two languages (Go CLI and Python agent-runner) with zero test coverage. These functions include security-sensitive logic — path traversal prevention, zip bomb protection, and safe file extraction — that must be thoroughly tested to prevent regressions in a world-class platform.

### Pain Points

- No existing tests for `zipDirectory`, `isHiddenEntry`, `detectContentType`, or `formatFileSize` in the CLI
- No existing tests for `_validate_zip_for_extraction`, `_extract_zip_local`, `_prepare_daytona_extraction`, or `inject_attachments` in the agent-runner
- Safety-critical code (path traversal, zip bomb guards) had no automated verification
- Regression risk for both regular file and directory attachment flows

## Solution

Created two test files following established codebase patterns:

- **Python**: `test_inject_attachments.py` — 34 tests across 4 test classes
- **Go**: `run_attachments_test.go` — 28 test cases across 4 test functions

Tests cover the full spectrum: happy paths, error paths, boundary conditions, security edge cases, and both local and Daytona sandbox modes.

## Implementation Details

### Python Tests (`backend/services/agent-runner/tests/test_inject_attachments.py`)

- **TestValidateZipForExtraction** (13 tests): valid manifests with sorting, nested paths, size tracking, directory entry exclusion, invalid zip, empty zip, path traversal (absolute `/`, backslash `\`, `../../`, sneaky `foo/../../`), zip bomb (file count, total size), boundary at-limit acceptance
- **TestExtractZipLocal** (4 tests): correct extraction with content verification, nested directory creation, None and empty-string `local_root` errors
- **TestPrepareDaytonaExtraction** (3 tests): FileUpload staging with correct destination, mkdir failure, missing FileUpload class
- **TestInjectAttachments** (14 tests): empty list, missing `storage_key`, single file local/Daytona, custom `mount_path`, zip extract local/Daytona (full staging/upload/unzip flow), mixed regular + zip, invalid zip propagation, workspace_root fallback chain, unzip failure

Key testing pattern: a `_fake_daytona` pytest fixture injects a fake `daytona` module into `sys.modules` to test Daytona mode without the SDK installed.

### Go Tests (`client-apps/cli/cmd/stigmer/root/run_attachments_test.go`)

- **TestZipDirectory** (8 tests): multi-file, hidden files skipped, hidden directories skipped entirely, nested path preservation, empty directory errors, non-existent directory, valid zip output
- **TestIsHiddenEntry** (8 tests): dot-prefix detection for hidden vs regular entries
- **TestDetectContentType** (10 tests): custom switch cases (`.yaml`, `.yml`, `.md`, `.toml`, `.parquet`, `.avro`), no extension, truly unknown extension, platform-safe assertions for OS-handled MIME types
- **TestFormatFileSize** (10 tests): B/KB/MB/GB threshold boundaries

Shared test helpers: `writeFile`, `readZipEntries`, `assertZipEntry` for concise zip content verification.

### BUILD.bazel Update

Added `run_attachments_test.go` to the `go_test` target in `client-apps/cli/cmd/stigmer/root/BUILD.bazel`.

## Benefits

- Full coverage of security-critical zip validation and extraction logic
- Regression protection for both regular file and directory attachment flows
- Platform-safe tests that work across macOS and Linux (handles OS-specific MIME databases)
- Clean test patterns that serve as documentation for future attachment-related features

## Impact

- **Agent-runner**: 34 new tests covering all attachment injection paths
- **CLI**: 28 new test cases covering all zip/directory handling functions
- **Project**: All 5 tasks (T01-T05) now complete for the directory-attach feature

## Related Work

- `2026-02-23-195811-agent-runner-zip-extraction.md` — T04 changelog (zip extraction implementation)
- Project: `_projects/2026-02/20260222.01.fix-attach-directory-zip-support/`

---

**Status**: Production Ready
**Timeline**: 1 session (~1 hour)
