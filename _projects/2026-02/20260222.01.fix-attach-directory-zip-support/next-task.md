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
- **Last Session**: 2026-02-22 — Completed T01 (plan) and T02 (proto change)
- **Active Task**: T03 (CLI — Directory Zipping & Upload)

## Session Progress (2026-02-22)

- Reviewed and approved the T01 feature analysis and design plan
- Completed T02: Proto change + stub regeneration
  - Removed `reserved 2` from `Attachment` message, renumbered to clean 1-5 sequence
  - Added `bool extract = 5` field to `Attachment` proto
  - Regenerated Go and Python stubs via `make -C apis build`
  - Updated MCP server's `AttachmentInput` struct and `toProto()` method
  - Verified compilation across all dependent Bazel targets
- Design decisions confirmed:
  - Field name: `extract` (not `is_extract` or `should_extract`)
  - Clean field renumbering (no backward compat needed — proto not in production)
  - Explicit `extract` flag approach (not content-type inference)

## Next Steps

1. **T03: CLI — Directory Zipping & Upload** (`run_attachments.go`)
   - New `zipDirectory()` function using `archive/zip`
   - Modify `processFile()` to handle directories (auto-zip, set `extract: true`)
   - Add size guard for gRPC ~4MB limit
   - Skip hidden files (`.git`, `.DS_Store`)
   - Update CLI output messages for directory zipping
2. **T04: Agent Runner — Zip Extraction** (`execute_graphton.py`)
   - New `extract_zip_attachment()` function
   - Path traversal protection, zip bomb limits
   - Handle both Daytona sandbox and local modes
3. **T05: Integration Testing & Validation**

## Context for Resume

- The `Attachment` proto now has 5 fields: `filename=1`, `storage_key=2`, `mount_path=3`, `content_type=4`, `extract=5`
- All existing code paths are unaffected — `extract` defaults to `false`
- The MCP server's hand-maintained `agent_execution_gen.go` was updated separately from the buf-generated stubs
- Pre-existing Bazel issue: CLI root target (`//client-apps/cli/cmd/stigmer/root/...`) fails due to missing `com_github_alecthomas_chroma_v2` module — needs `bazel mod tidy` (not related to our changes)
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
6. [ ] Continue with T03: CLI — Directory Zipping & Upload

## Quick Commands

After loading context:
- "Continue with T03" - Resume the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
