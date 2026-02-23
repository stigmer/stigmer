---
name: T05 Unit Tests
overview: Write comprehensive unit tests for all new attachment functions in both Go (CLI zip/directory) and Python (agent-runner zip extraction/injection), covering safety-critical paths like path traversal protection and zip bomb guards.
todos:
  - id: py-tests
    content: "Write Python unit tests: test_inject_attachments.py covering _validate_zip_for_extraction, _extract_zip_local, _prepare_daytona_extraction, and inject_attachments"
    status: completed
  - id: py-run
    content: Run Python tests with pytest, verify all pass and ruff is clean
    status: completed
  - id: go-tests
    content: "Write Go unit tests: run_attachments_test.go covering zipDirectory, isHiddenEntry, detectContentType, formatFileSize"
    status: completed
  - id: go-run
    content: Run Go tests with go test, verify all pass and go vet is clean
    status: completed
  - id: bazel-update
    content: Update BUILD.bazel to include the new Go test file
    status: completed
  - id: checkpoint
    content: Update project checkpoint and next-task.md to reflect T05 completion
    status: completed
isProject: false
---

# T05: Unit Testing for Directory & Zip Attachment Support

## Scope Clarification

The original T05 description says "Integration Testing & Validation" with an E2E test goal. A true end-to-end test (directory -> zip -> upload -> extract -> agent sees files) requires a running gRPC server, artifact storage, and a Daytona sandbox -- that belongs in CI/CD, not this session.

What IS critical and feasible: **unit tests** for all new functions introduced in T02-T04. These functions include safety-critical logic (path traversal, zip bomb protection) that has zero test coverage today. The existing test infrastructure in both Go and Python is mature and ready for us to follow.

## Part 1: Python Unit Tests (Agent Runner)

**New file**: `[backend/services/agent-runner/tests/test_inject_attachments.py](backend/services/agent-runner/tests/test_inject_attachments.py)`

Follows existing patterns from `[test_auto_publish.py](backend/services/agent-runner/tests/test_auto_publish.py)` -- class-based organization, `pytest.mark.asyncio` for async functions, `MagicMock` for sandbox/storage, `tmp_path` for filesystem tests.

### Test Class 1: `TestValidateZipForExtraction`

Tests for `_validate_zip_for_extraction()` -- the safety gate. Every code path must be covered:

- **Valid zip**: multi-file zip returns sorted `(path, size)` manifest
- **Nested paths**: entries like `src/main.py` are preserved correctly
- **Empty zip** (no file entries, only directories): raises `ValueError`
- **Invalid zip** (random bytes): raises `ValueError` (BadZipFile)
- **Path traversal -- absolute path** (`/etc/passwd`): raises `ValueError`
- **Path traversal -- backslash absolute** (`\windows\system32`): raises `ValueError`
- **Path traversal -- dot-dot** (`../../etc/passwd`): raises `ValueError`
- **Path traversal -- sneaky dot-dot** (`foo/../../etc/passwd`): raises `ValueError`
- **Zip bomb -- too many files** (>1000 entries): raises `ValueError`
- **Zip bomb -- too large uncompressed** (>100MB declared): raises `ValueError`

### Test Class 2: `TestExtractZipLocal`

Tests for `_extract_zip_local()` -- local filesystem extraction:

- **Normal extraction**: files land at `{local_root}/{mount_dir}/{entry}` with correct content
- **Nested directories**: parent directories are created automatically
- **No local_root**: raises `ValueError`

### Test Class 3: `TestPrepareDaytonaExtraction`

Tests for `_prepare_daytona_extraction()` -- Daytona staging:

- **Happy path**: appends `FileUpload` to list and `abs_target_dir` to extract_targets
- **mkdir failure**: raises `RuntimeError`
- **No FileUpload class**: raises `RuntimeError`

### Test Class 4: `TestInjectAttachments`

Tests for the `inject_attachments()` orchestrator:

- **Empty list**: returns `[]`
- **Single regular file, local mode**: file written to `{local_root}/inputs/{filename}`, returns correct metadata
- **Single regular file, Daytona mode**: `FileUpload` queued with correct destination, `upload_files` called
- **Zip with extract=true, local mode**: validates, extracts files, returns per-file metadata
- **Zip with extract=true, Daytona mode**: validates, stages zip, batch uploads, runs `unzip` command
- **Mixed regular + zip attachments**: both paths work in same call
- **Missing storage_key**: raises `ValueError`

### Shared Fixtures (in conftest.py or test file)

- `attachment_zip_bytes`: a small valid zip with 2-3 files for reuse
- `mock_attachment()`: helper to create mock Attachment protos
- `mock_storage()`: mock `ArtifactStorage` with `.download()` returning bytes

## Part 2: Go Unit Tests (CLI)

**New file**: `[client-apps/cli/cmd/stigmer/root/run_attachments_test.go](client-apps/cli/cmd/stigmer/root/run_attachments_test.go)`

Follows existing Go test patterns: table-driven tests, `t.TempDir()` for filesystem.

### `TestZipDirectory`

- **Multi-file directory**: produces valid zip, correct file count, correct original size
- **Hidden files skipped**: `.hidden`, `.DS_Store` not in zip
- **Hidden directories skipped**: `.git/` subtree excluded entirely
- **Nested directories**: relative paths preserved in zip entries
- **Empty directory** (all hidden files): returns error "no attachable files"
- **Non-existent directory**: returns error

### `TestIsHiddenEntry`

- `.hidden` -> true
- `.git` -> true
- `.DS_Store` -> true
- `normal.txt` -> false
- `file.go` -> false

### `TestDetectContentType`

- Standard extensions: `.yaml` -> `application/x-yaml`, `.md` -> `text/markdown`, etc.
- Unknown extension: `.xyz` -> `application/octet-stream`
- No extension: `Makefile` -> `application/octet-stream`

### `TestFormatFileSize`

- Bytes, KB, MB, GB thresholds with expected formatted strings

### BUILD.bazel Update

Add the new test file to the `go_test` target `srcs` in `[client-apps/cli/cmd/stigmer/root/BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel)`.

## Out of Scope

- **True E2E integration test** (requires live server + storage + sandbox) -- belongs in CI/CD
- `**command.sh` update for agent-drafter** -- feature adoption, not testing; separate follow-up
- **Daytona mode manual validation** -- documented in checkpoint, not automated here

## Execution Order

1. Python tests first (safety-critical validation logic, more complex)
2. Go tests second (pure functions, simpler)
3. Run both test suites, fix any issues found
4. Update BUILD.bazel for Go tests

