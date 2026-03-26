# Next Task: 20260326.01.sandbox-github-pr

## Current State
- **Status**: in-progress
- **Last Session**: March 26, 2026 — Phase 3 (create_pull_request tool) completed
- **Active Task**: Phase 3 complete. Next: Phase 4 (artifact + polish) from the project README

## Session Progress (2026-03-26, Session 4)

### Phase 3: `create_pull_request` Platform Tool — COMPLETE
- New module `git_tools.py` in Graphton core — tool factory, GitHub API integration, credential reading, URL parsing
- Tool self-discovers repo, branch, and credentials from sandbox at invocation time (stateless)
- Worker-side GitHub API call via `httpx.AsyncClient` — not curl-in-sandbox
- Wired into `create_platform_tool_wrappers()` — 12 tools total (9 primary + 3 aliases)
- Auto-approved by default (`requires_approval: False`) — PR is a non-destructive proposal
- Prompt updated: `_git_writeback_guidance()` mentions tool, `EXECUTE_CAPABILITY` describes it
- 30 new tests (URL parsing, credential parsing, end-to-end with mocked API, error scenarios)
- 2 new prompt section tests, 3 existing test files updated for new tool count
- Full test suite: Graphton 1191 passed / Agent-runner 1297 passed, zero regressions

### Key Decisions
- **Separate file (`git_tools.py`)**: Tool calls external HTTP API, different from sandbox-only tools. Follows `think_tool.py`/`resource_tools.py` pattern.
- **Self-discovering, not pre-configured**: No repo URL or token at creation time. Runs git commands in sandbox at invocation.
- **No HITL by default**: Push is already gated via `execute`. PR is a proposal. Override mechanism still available.
- **No auto-commit/push**: Tool only creates PR. Agent handles git workflow.
- **`core/git_tools.py` not `core/tools/git_tools.py`**: No `tools/` subdirectory exists; stayed flat.

### Files Created
- `backend/libs/python/graphton/src/graphton/core/git_tools.py` — tool implementation
- `backend/libs/python/graphton/tests/core/test_git_tools.py` — 30 tests

### Files Modified
- `backend/libs/python/graphton/pyproject.toml` — httpx dependency
- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — register tool
- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` — PR tool in capabilities
- `backend/libs/python/graphton/tests/core/test_tool_wrappers.py` — tool count 11→12
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — write-back prompt update
- `backend/services/agent-runner/worker/activities/graphton/approval_policy.py` — platform default
- `backend/services/agent-runner/tests/test_workspace_prompt_section.py` — 2 new tests
- `backend/services/agent-runner/tests/test_integration_skill_pipeline.py` — tool count 11→12

## Cumulative Progress (Phases 0–3)

### Phase 0: FUSE+S3 Volume Compatibility — COMPLETE (Session 1)
- `--separate-git-dir` for FUSE volumes, global git config, stale pointer recovery

### Phase 1: Git Credential Persistence — COMPLETE (Session 2)
- Credential store at `~/.git-credentials`, remote URL cleanup, `git_credentials_configured` field on `GitMetadata`

### Phase 2: Write-Back Prompt — COMPLETE (Session 3)
- Conditional `### Git Write-Back` prompt section, branch/commit/push guidance, credential file warning

### Phase 3: `create_pull_request` Platform Tool — COMPLETE (Session 4)
- Graphton platform tool, GitHub REST API via httpx, self-discovering, auto-approved, 30 new tests

## Next Steps
1. **Phase 4: Artifact + Polish** — Capture PR URL as execution artifact in `status_builder.py`
2. **Deploy and E2E validate** — Run a real agent execution with a `git_repo` workspace to confirm clone + push + PR works end-to-end
3. **Optional: `read` tool deny-list** — Block agent from reading `~/.git-credentials` via the `read` platform tool

## Context for Resume
- Phase 4 involves `backend/services/agent-runner/worker/activities/graphton/status_builder.py`
- The artifact system already has `_generate_git_diff_artifact` that creates `.patch` artifacts — PR URL artifact follows the same pattern
- Pre-existing failures in `test_daytona_backend.py` (8 tests) are unrelated MagicMock setup issues
- The `create_pull_request` tool returns PR URL in its result string — Phase 4 could emit a custom event or store it as a structured artifact

## Blockers
- None. Phase 4 can proceed immediately.

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
