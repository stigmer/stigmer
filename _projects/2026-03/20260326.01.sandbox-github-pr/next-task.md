# Next Task: 20260326.01.sandbox-github-pr

## Current State
- **Status**: in-progress
- **Last Session**: March 26, 2026 — Phase 2 (write-back prompt) completed
- **Active Task**: Phase 2 complete. Next: Phase 3 (create_pr platform tool) from the project README

## Session Progress (2026-03-26, Session 3)

### Phase 2: Git Write-Back Prompt — COMPLETE
- Added `_git_writeback_guidance()` to `execute_graphton.py` — conditionally appends push guidance when `git_credentials_configured` is True
- Wired into both single-entry (`_build_single_workspace_section`) and multi-entry (`_format_entry_description`) paths
- Heading level parameterized: `###` for single-entry, `####` for multi-entry
- Prompt content covers: branch rules, commit guidance, credential file warning
- No changes to `git.py` or `provisioner.py` — data plumbing was already done in Phase 1
- 9 new tests: creds-on, creds-off, ordering (desc < tree < write-back), branch rule, credential warning, multi-entry creds, mixed-creds, direct `_format_entry_description`
- Full test suite: 1280 tests, zero regressions

### Key Decisions
- **Prompt builder owns all agent-facing text**: Write-back guidance lives in `execute_graphton.py`, not in `_build_description` in `git.py`. Keeps provisioner focused on metadata.
- **Per-entry granularity**: In multi-workspace sessions, only entries with configured credentials get write-back guidance
- **Unconditional append pattern**: `_git_writeback_guidance()` returns `""` when credentials are absent, so callers append without conditional checks

### Files Modified
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — `GitMetadata` import, `_git_writeback_guidance()`, wiring into both prompt paths
- `backend/services/agent-runner/tests/test_workspace_prompt_section.py` — `_git_provision_with_creds()` helper, `_two_git_entries_with_creds()` fixture, 9 new tests

## Cumulative Progress (Phases 0–2)

### Phase 0: FUSE+S3 Volume Compatibility — COMPLETE (Session 1)
- `--separate-git-dir` for FUSE volumes, global git config, stale pointer recovery

### Phase 1: Git Credential Persistence — COMPLETE (Session 2)
- Credential store at `~/.git-credentials`, remote URL cleanup, `git_credentials_configured` field on `GitMetadata`

### Phase 2: Write-Back Prompt — COMPLETE (Session 3)
- Conditional `### Git Write-Back` prompt section, branch/commit/push guidance, credential file warning

## Next Steps
1. **Phase 3: create_pr platform tool** — Add a platform-provided `create_pull_request` tool for structured PR creation (Gap 3 + Gap 4 from plan)
2. **Phase 4: HITL gating for push** — Gate push/PR operations with human-in-the-loop approval
3. **Deploy and E2E validate** — Run a real agent execution with a `git_repo` workspace to confirm clone + push + prompt works end-to-end

## Context for Resume
- Phase 3 involves new files in Graphton library: `backend/libs/python/graphton/src/graphton/core/tools/git_tools.py`
- The platform tool needs to read the token from `~/.git-credentials` (or the credential store) — it should NOT receive the token as a parameter
- The tool should be HITL-gated by default (existing tool approval infrastructure)
- The tool interface: `create_pull_request(title, body, base_branch?, head_branch?)` → returns PR URL
- The prompt builder (Phase 2) does NOT mention the `create_pull_request` tool — that will be added when Phase 3 is complete
- Pre-existing failures in `test_daytona_backend.py` (8 tests) are unrelated MagicMock setup issues

## Blockers
- None. Phase 3 can proceed immediately.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260326.01.sandbox-github-pr/next-task.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260326.01.sandbox-github-pr/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task or complete the current one

---

*This file provides direct paths to all project resources for quick context loading.*
