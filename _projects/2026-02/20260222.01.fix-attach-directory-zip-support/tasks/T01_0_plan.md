# Task T01: Feature Analysis and Design — Directory & Zip Support for `--attach`

**Created**: 2026-02-22 16:44
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Objective

Enable `--attach` to seamlessly accept both individual files and directories. When a directory is passed, the CLI auto-zips it and uploads the archive. The agent runner detects zip-archive attachments and extracts them at the mount path. Individual file behavior remains unchanged.

## Current State (as analyzed)

### CLI — `run_attachments.go`
- `AttachmentProcessor.ProcessFiles()` iterates `--attach` paths.
- `processFile()` explicitly **rejects directories** (line 61-62):
  ```go
  if info.IsDir() {
      return nil, fmt.Errorf("cannot attach directory: %s (only files are supported)", path)
  }
  ```
- Files are read into memory and uploaded via `UploadAttachment` gRPC RPC.
- Returns `Attachment` proto with `storage_key`.

### Server — `upload_attachment.go`
- `UploadAttachment` RPC stores raw bytes at `attachments/{ulid}/{filename}`.
- No content-aware processing; bytes are stored as-is.

### Agent Runner — `execute_graphton.py` `inject_attachments()`
- Downloads each attachment from storage using `storage_key`.
- Writes content as-is to `inputs/{filename}` (or `mount_path` if set).
- **No zip extraction logic exists.**

### Proto — `Attachment` message (`spec.proto:355-377`)
- Fields: `filename`, `storage_key`, `mount_path`, `content_type`.
- No field to signal "this is a zip archive that should be extracted."
- Comment at line 352 already hints at directory extraction: `mount_path: "/workspace/data/" -> directory extracted at /workspace/data/"`

## Design

### Approach: Explicit `extract` flag on `Attachment` proto

Add a boolean `extract` field to `Attachment`. When `true`, the agent runner extracts the zip archive at `mount_path` instead of writing it as a single file. This is explicit and safe — no guessing from content type.

**Why not infer from `content_type`?**
A user might intentionally attach a `.zip` file that should remain as-is (e.g., a dataset in zip format that the agent processes directly). An explicit flag avoids ambiguity.

### Changes by Component

#### 1. Proto: `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto`

Remove the `reserved 2` line (no one is using this proto yet, so no backward compatibility concern) and renumber fields cleanly. Add `extract` field:

```protobuf
message Attachment {
  string filename = 1;
  string storage_key = 2;
  string mount_path = 3;
  string content_type = 4;
  
  // When true, the attachment is a zip archive that should be extracted
  // at mount_path rather than written as a single file.
  // Set automatically by CLI when a directory is auto-zipped.
  bool extract = 5;
}
```

**Impact**: Proto-generated Go and Python stubs need regeneration. This is a breaking field renumber (storage_key 3→2, mount_path 4→3, content_type 5→4) but acceptable since no one is using this yet.

#### 2. CLI: `client-apps/cli/cmd/stigmer/root/run_attachments.go`

**`processFile()` changes:**

```
if path is a directory:
    1. Walk the directory tree, collect all files
    2. Create an in-memory zip archive containing all files (preserving relative paths)
    3. Upload the zip via UploadAttachment with:
       - filename: "{dirname}.zip"
       - content_type: "application/zip"
    4. Return Attachment with:
       - extract: true
       - mount_path: "inputs/{dirname}/"
       
if path is a regular file:
    (current behavior, unchanged)
    - Upload file as-is
    - extract: false (default)
```

**New helper function:** `zipDirectory(dirPath string) ([]byte, error)`
- Uses Go's `archive/zip` package (already imported elsewhere in `run_handlers.go`)
- Walks directory, adds each file with relative path preserved
- Returns zip bytes
- Skips hidden files (`.git`, `.DS_Store`, etc.)

**Size guard:**
- After zipping, check if the zip exceeds the gRPC message limit (~4MB default).
- If exceeded, print a clear error: `"Directory too large after compression (X MB). Maximum attachment size is ~4MB. Consider reducing files or using a subset."`
- Future enhancement: chunked upload for large files (out of scope for this task).

#### 3. Agent Runner: `backend/services/agent-runner/worker/activities/execute_graphton.py`

**`inject_attachments()` changes:**

After downloading content from storage, check `attachment.extract`:

```python
if attachment.extract:
    # Extract zip archive at mount_path
    extract_zip_attachment(content, mount_path, sandbox, local_root, ws_root, logger)
else:
    # Current behavior: write file as-is
    ...
```

**New helper function:** `extract_zip_attachment()`
- Uses Python's `zipfile` module
- **Path traversal protection**: Validate each entry name doesn't escape the target directory (reject entries starting with `/`, containing `..`, or absolute paths)
- For Daytona sandbox: extract to temp dir, then batch-upload extracted files
- For local mode: extract directly to `{local_root}/{mount_path}`
- Log each extracted file for the injection summary

**Return value change:**
- When extracting, return multiple `injected_files` entries (one per extracted file) instead of a single entry for the zip

#### 4. Server: `upload_attachment.go`

**No changes needed.** The server just stores bytes — it doesn't need to know about extraction. The `extract` flag lives on the `Attachment` proto which is part of the execution spec, not the upload flow.

### User Experience

**Before (current):**
```bash
# Must list every file individually
stigmer draft skill \
  --attach inputs/agent-api.proto \
  --attach inputs/agent-spec.proto \
  --attach inputs/managing-agents.md \
  --attach inputs/example-agent.yaml \
  --attach inputs/requirements.md \
  ...
```

**After:**
```bash
# Option A: Attach entire directory (auto-zipped)
stigmer draft skill \
  --attach inputs/ \
  -m "Create an agent-drafter skill..."

# Option B: Mix files and directories
stigmer draft skill \
  --attach inputs/ \
  --attach extra-context.md \
  -m "Create an agent-drafter skill..."

# Option C: Individual files still work (unchanged)
stigmer draft skill \
  --attach inputs/agent-api.proto \
  --attach inputs/requirements.md \
  -m "Create an agent-drafter skill..."
```

**CLI output for directory:**
```
ℹ  Zipping directory: inputs/ (5 files, 12.3 KB)...
✓  Uploaded inputs.zip (4.2 KB compressed)
```

### Edge Cases & Safety

| Case | Behavior |
|------|----------|
| Empty directory | Error: "directory is empty: inputs/" |
| Directory with only hidden files | Error: "no attachable files found in: inputs/" |
| Zip > 4MB after compression | Error with clear message about size limit |
| Nested directories | Included in zip with relative paths preserved |
| Symlinks in directory | Follow symlinks (but warn if they point outside the dir) |
| Path traversal in zip entries | Agent runner rejects entries with `..` or absolute paths |
| Existing attachments (no `extract` field) | N/A — no one is using this yet |

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| gRPC 4MB message limit | Pre-check zip size, clear error message |
| Zip bomb (agent runner) | Limit extraction count (e.g., max 1000 files) and total extracted size (e.g., 100MB) |
| Path traversal attack | Validate all zip entry names before extraction |
| Backward compatibility | Not a concern — no users yet; clean field renumbering is safe |
| Proto stub regeneration | Standard `buf generate` workflow; additive change |

## Task Breakdown (Implementation Order)

### T02: Proto Change + Stub Regeneration
1. Remove `reserved 2` from `Attachment` message in `spec.proto`
2. Renumber fields: `storage_key=2`, `mount_path=3`, `content_type=4`
3. Add `bool extract = 5`
4. Regenerate Go and Python stubs (`buf generate`)
5. Fix all references to old field numbers in Go/Python code
6. Verify compilation

### T03: CLI — Directory Zipping & Upload
1. New function `zipDirectory()` in `run_attachments.go`
2. Modify `processFile()` to handle directories
3. Set `extract: true` and appropriate `mount_path` for zipped directories
4. Add size guard for gRPC limit
5. Update CLI output messages

### T04: Agent Runner — Zip Extraction
1. New function `extract_zip_attachment()` in `execute_graphton.py`
2. Path traversal protection
3. Zip bomb protection (file count + size limits)
4. Modify `inject_attachments()` to branch on `attachment.extract`
5. Handle both Daytona and local modes

### T05: Integration Testing & Validation
1. End-to-end test: directory → zip → upload → extract → agent sees files
2. Test individual file behavior unchanged
3. Test edge cases (empty dir, large dir, nested dirs)
4. Update `command.sh` in agent-drafter to use directory attach

## Success Criteria for T01

- [x] Complete understanding of current file attachment flow (CLI → server → agent runner)
- [x] Identified all files that need changes
- [x] Designed explicit `extract` flag approach (not content-type inference)
- [x] Addressed safety concerns (path traversal, zip bombs, size limits)
- [x] No backward compatibility concern (no users yet) — clean field renumbering
- [x] Clear implementation order with no circular dependencies
- [ ] **Developer approval of this plan**

## Next Task Preview

**T02: Proto Change + Stub Regeneration** — Remove `reserved 2`, renumber fields, add `bool extract = 5`, regenerate stubs.

## Review Process

**What happens next**:
1. **You review this plan** — Focus on the `extract` flag design and safety measures
2. **Provide feedback** — Any concerns about the approach, edge cases, or priorities
3. **I'll revise the plan** — Create an updated version incorporating your feedback
4. **You approve** — Give explicit approval to proceed
5. **Execution begins** — Starting with T02 (proto change)

**Please consider**:
- Is the explicit `extract` flag the right approach vs. inferring from content type?
- Are the safety measures (path traversal, zip bomb, size limit) sufficient?
- Should `--attach dir/` auto-zip silently or require a separate `--attach-dir` flag?
- Any file types or patterns that should be excluded from directory zipping (e.g., `.git/`)?
- Is the 4MB gRPC limit acceptable, or should we tackle chunked upload in this project?
