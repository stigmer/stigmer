# Next Task: 20260326.01.sandbox-github-pr

## Current State
- **Status**: in-progress
- **Last Session**: March 26, 2026 — Phase 0 (FUSE+S3 volume git compatibility) completed
- **Active Task**: Phase 0 complete. Next: Phase 1 (token persistence) from the project README

## Session Progress (2026-03-26)

### Phase 0: Make Git Work on Daytona FUSE+S3 Volumes — COMPLETE
- Diagnosed root cause: `rename()` returns ENOSYS on Daytona volumes (FUSE+S3)
- Discovered secondary issues: dubious ownership (nobody:nogroup) and chmod failure
- Validated fix with 19/19 passing diagnostic tests on a live Daytona sandbox
- Implemented `--separate-git-dir` support in `worker/workspace/sources/git.py`
- Updated `worker/workspace/provisioner.py` to pass `is_local_mode` through
- Comprehensive test suite: 61 tests all passing (up from 51)

### Key Decisions
- `is_local_mode` parameter on `provision()` controls the mode — no magic detection
- Git metadata lives at `/home/daytona/.git-repos/{entry}` on the local sandbox fs
- `safe.directory='*'` and `core.fileMode=false` set globally, before any git ops
- Stale `.git` pointer files (after sandbox restart) trigger full re-clone — acceptable for MVP since agents push all commits before execution ends
- `_setup_git_excludes` uses `git rev-parse --absolute-git-dir` to correctly follow pointer files

### Files Modified
- `backend/services/agent-runner/worker/workspace/sources/git.py` — core implementation
- `backend/services/agent-runner/worker/workspace/provisioner.py` — one-line pass-through
- `backend/services/agent-runner/tests/workspace/test_git_source.py` — 61 tests

## Next Steps
1. **Deploy and E2E validate** — Run a real agent execution with a `git_repo` workspace to confirm the full pipeline works in production
2. **Phase 1: Token persistence** — Keep GITHUB_TOKEN available in the sandbox environment after provisioning so agents can `git push`
3. **Phase 2: create_pr platform tool** — Add a platform-provided tool for creating GitHub PRs
4. **Phase 3: HITL gating for push** — Gate push operations with human-in-the-loop approval

## Context for Resume
- The Daytona volume diagnostic scripts are at `/tmp/daytona-diagnostic-*.py` (local machine only)
- Daytona API key is in `stigmer-cloud/_ops/planton/service-hub/secrets-group/daytona.yaml`
- The `daytona-small` snapshot (production) vs `daytona/sandbox:0.6.0` (diagnostic default) — both use the same FUSE+S3 volume driver; fix applies to both
- Pre-existing failures in `test_daytona_backend.py` (8 tests) are unrelated MagicMock setup issues

## Blockers
- None for Phase 0. Phase 1 can proceed immediately.

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
