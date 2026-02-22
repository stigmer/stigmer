# Next Task: 20260222.01.fix-attach-directory-zip-support

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260222.01.fix-attach-directory-zip-support

**Description**: Add directory and zip file support to the --attach flag: CLI auto-zips directories, accepts zip files directly, and the agent runner extracts zip attachments at mount paths.
**Goal**: Enable --attach to accept both individual files and directories (auto-zipped), and ensure the agent runner properly extracts zip files when injecting attachments.
**Tech Stack**: Go (CLI), Python (agent-runner), Protobuf (APIs)
**Components**: client-apps/cli/cmd/stigmer/root/run_attachments.go, backend/services/agent-runner/worker/activities/execute_graphton.py, apis/ai/stigmer/agentic/agentexecution/v1/spec.proto

## Current State

- **Status**: In Progress
- **Last Session**: 2026-02-22 — Completed T01 (plan), T02 (proto change), and T03 (CLI directory zipping)
- **Active Task**: T04 (Agent Runner — Zip Extraction)

## Session Progress (2026-02-22, Session 2)

- Completed T03: CLI — Directory Zipping & Upload
  - Created `run_attachments_zip.go` with `zipDirectory()`, `isHiddenEntry()`, and `maxAttachmentSize` (10MB)
  - Refactored `uploadFile()` → `uploadBytes()` for direct byte upload without temp files
  - Added `processDirectory()` orchestration method with size guard and proto annotation
  - Modified `processFile()` to delegate directories instead of rejecting
  - Verified with `go build` and `go vet` (both clean)
- Design decisions confirmed:
  - 10MB size limit (matches actual server `MaxRecvMsgSize`, not the 4MB in proto comments)
  - Symlinks skipped with per-symlink warning (safer than following)
  - Hidden files = dot-prefix convention (`.git`, `.DS_Store`, `.env`, etc.)
  - Two-file split: zip logic (107 lines) vs orchestration (197 lines)

## Next Steps

1. **T04: Agent Runner — Zip Extraction** (`execute_graphton.py`)
   - New `extract_zip_attachment()` function
   - Path traversal protection (reject entries with `..` or absolute paths)
   - Zip bomb limits (max file count, max extracted size)
   - Modify `inject_attachments()` to branch on `attachment.extract`
   - Handle both Daytona sandbox and local modes
2. **T05: Integration Testing & Validation**
   - End-to-end: directory → zip → upload → extract → agent sees files
   - Test individual file behavior unchanged
   - Test edge cases (empty dir, large dir, nested dirs)

## Context for Resume

- The `Attachment` proto has 5 fields: `filename=1`, `storage_key=2`, `mount_path=3`, `content_type=4`, `extract=5`
- CLI now sets `Extract: true` and `MountPath: "inputs/{dirname}/"` for directory attachments
- The zip is created in-memory with `Deflate` compression, skipping hidden files and symlinks
- `uploadBytes()` was extracted from `uploadFile()` — used by both file and directory paths
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

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with T04: Agent Runner — Zip Extraction

## Quick Commands

After loading context:
- "Continue with T04" - Resume the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
