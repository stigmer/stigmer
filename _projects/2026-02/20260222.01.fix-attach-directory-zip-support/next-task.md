# Next Task: 20260222.01.fix-attach-directory-zip-support

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260222.01.fix-attach-directory-zip-support

**Description**: Add directory and zip file support to the --attach flag: CLI auto-zips directories, accepts zip files directly, and the agent runner extracts zip attachments at mount paths.
**Goal**: Enable --attach to accept both individual files and directories (auto-zipped), and ensure the agent runner properly extracts zip files when injecting attachments.
**Tech Stack**: Go (CLI), Python (agent-runner), Protobuf (APIs)
**Components**: client-apps/cli/cmd/stigmer/root/run_attachments.go, backend/services/agent-runner/worker/activities/execute_graphton.py, apis/ai/stigmer/agentic/agentexecution/v1/spec.proto

## Current State

- **Status**: Complete
- **Last Session**: 2026-02-23 (Session 4) — Completed T05 (Unit Testing)
- **Active Task**: None — all tasks complete

## Session Progress (2026-02-23, Session 4)

- Completed T05: Unit Testing for Directory & Zip Attachment Support
  - Created `test_inject_attachments.py` (Python): 34 tests across 4 classes
    - TestValidateZipForExtraction: 13 tests (safety gate — path traversal, zip bombs, validation)
    - TestExtractZipLocal: 4 tests (local filesystem extraction)
    - TestPrepareDaytonaExtraction: 3 tests (Daytona sandbox staging)
    - TestInjectAttachments: 14 tests (orchestrator — local mode, Daytona mode, mixed)
  - Created `run_attachments_test.go` (Go): 28 test cases across 4 functions
    - TestZipDirectory: 8 tests (hidden filtering, nesting, empty dirs, validity)
    - TestIsHiddenEntry: 8 tests (dot-prefix detection)
    - TestDetectContentType: 10 tests (custom MIME types, platform-safe assertions)
    - TestFormatFileSize: 10 tests (B/KB/MB/GB thresholds)
  - Updated BUILD.bazel to include new Go test file
  - All tests passing, ruff clean, go vet clean

## All Tasks Complete

- T01: Feature Analysis and Design — done
- T02: Proto Change + Stub Regeneration — done
- T03: CLI — Directory Zipping & Upload — done
- T04: Agent Runner — Zip Extraction — done
- T05: Unit Testing — done

## Context for Resume

- The `Attachment` proto has 5 fields: `filename=1`, `storage_key=2`, `mount_path=3`, `content_type=4`, `extract=5`
- CLI sets `Extract: true` and `MountPath: "inputs/{dirname}/"` for directory attachments
- Agent runner now:
  - Validates zip: rejects absolute paths, `..` traversal, >1000 files, >100MB uncompressed
  - Local mode: extracts file-by-file via `zipfile.ZipFile.open()` (safe, no `extractall()`)
  - Daytona mode: uploads zip as `__attachment__.zip`, batch-uploads, then `unzip -o` + cleanup
  - Returns individual `injected_files` entries (one per extracted file, with sizes)
- Resume fast-path already handles directory mount_paths (`inputs/my-project/`) correctly
- System prompt already works with both individual files and directory paths
- Pre-existing Bazel issue: CLI root target fails due to missing `com_github_alecthomas_chroma_v2` module (not related to our changes)
- Full task plan is in `tasks/T01_0_plan.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.01.fix-attach-directory-zip-support/dont-dos/
```

## Resume Checklist

Project is complete. All tasks T01-T05 are done.

## Quick Commands

- "Show project status" - Get overview of progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
