# Next Task: 20260326.01.sandbox-github-pr

## Current State
- **Status**: in-progress
- **Last Session**: March 26, 2026 — Phase 1 (credential persistence) completed
- **Active Task**: Phase 1 complete. Next: Phase 2 (write-back prompt) from the project README

## Session Progress (2026-03-26, Session 2)

### Phase 1: Git Credential Persistence via Credential Store — COMPLETE
- Discovered that push already works via token-in-URL (the original plan's assumption that AD-05 "kills push" was incorrect — the token is embedded in `remote.origin.url` by `_build_auth_url`)
- Implemented credential store approach for security hygiene: remote URL is cleaned, token moves to `~/.git-credentials`
- Added `git_credentials_configured` field to `GitMetadata` for downstream consumption (Phase 2 prompt)
- New `_configure_git_credentials()` function in `git.py` — three-step process: clean URL, configure helper, write credential file
- Wired into both fresh-clone and idempotent (existing repo) paths, gated on `token and not is_local_mode`
- 12 new tests in `TestCredentialHelper` class, all passing
- Full test suite: 73 tests in `test_git_source.py` (was 61), plus 119 related tests — zero regressions

### Key Decisions
- **Cloud-only**: Credential helper is only configured in cloud mode (`is_local_mode=False`); local mode preserves user's own git config
- **GitHub-only scope**: Consistent with `_build_auth_url` — only acts on `github.com` URLs
- **Non-fatal failures**: Credential setup failure logs a warning but does not fail provisioning (same pattern as `_setup_git_excludes`)
- **Field on `GitMetadata`**: `git_credentials_configured: bool` lives on `GitMetadata` (not `ProvisionResult`) since it's git-specific metadata
- **Remote URL cleanup**: After clone, `git remote set-url origin <clean_url>` removes the embedded token so `git remote -v` doesn't leak it

### Discovery: Original Plan Assumption Was Wrong
The T01_0_plan.md stated: "AD-05 strips GITHUB_TOKEN from merged_env_vars after clone... this kills push capability." This is incorrect. `_build_auth_url()` embeds the token into the clone URL, and git stores it as `remote.origin.url`. Push already works via the URL-embedded token. Phase 1's credential store is a security hygiene improvement (preventing accidental token exposure via `git remote -v`), not a functionality enabler.

### Files Modified
- `backend/services/agent-runner/worker/workspace/provisioner.py` — added `git_credentials_configured` field to `GitMetadata`
- `backend/services/agent-runner/worker/workspace/sources/git.py` — `_configure_git_credentials()`, `_CREDENTIAL_FILE` constant, module docstring update, both call sites in `provision()`
- `backend/services/agent-runner/tests/workspace/test_git_source.py` — `_CloudGitBackend` updated, 12 new tests in `TestCredentialHelper`

## Next Steps
1. **Phase 2: Write-back prompt** — Extend `build_workspace_prompt_section` to tell the agent it can push when `git_credentials_configured` is True
2. **Phase 3: create_pr platform tool** — Add a platform-provided `create_pull_request` tool for structured PR creation
3. **Phase 4: HITL gating for push** — Gate push/PR operations with human-in-the-loop approval
4. **Deploy and E2E validate** — Run a real agent execution with a `git_repo` workspace to confirm clone + push works end-to-end

## Context for Resume
- The Daytona volume diagnostic scripts are at `/tmp/daytona-diagnostic-*.py` (local machine only)
- Daytona API key is in `stigmer-cloud/_ops/planton/service-hub/secrets-group/daytona.yaml`
- The `daytona-small` snapshot (production) vs `daytona/sandbox:0.6.0` (diagnostic default) — both use the same FUSE+S3 volume driver; fix applies to both
- Pre-existing failures in `test_daytona_backend.py` (8 tests) are unrelated MagicMock setup issues
- Phase 2 will consume `git_metadata.git_credentials_configured` in `execute_graphton.py:build_workspace_prompt_section`
- The prompt builder is at `backend/services/agent-runner/worker/activities/execute_graphton.py` (lines ~726–846)

## Blockers
- None. Phase 2 can proceed immediately.

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
