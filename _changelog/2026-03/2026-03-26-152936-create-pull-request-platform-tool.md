# Add `create_pull_request` Platform Tool for Agent-Driven PR Creation

**Date**: March 26, 2026

## Summary

Implemented a new `create_pull_request` platform tool in Graphton that enables agents to
create GitHub pull requests directly from within the Daytona sandbox. The tool reads
repository info and credentials from the workspace automatically, calls the GitHub REST API
from the worker process, and returns a structured PR summary. This completes Phase 3 of the
sandbox GitHub PR project.

## Problem Statement

After Phases 0–2 established git clone compatibility (FUSE volumes), credential persistence
(`~/.git-credentials`), and write-back awareness (agent prompt), agents could push code to
GitHub but had no structured way to create pull requests. The only option was fragile raw
`curl` commands in the sandbox, which leaked implementation details into the LLM context and
provided no structured error handling.

### Pain Points

- No platform-level PR creation — agents had to craft raw GitHub API calls
- Token management for API calls was ad-hoc (credential file parsing in bash)
- No structured error messages for common failures (branch not pushed, PR already exists)
- PR creation was invisible to the platform (no approval hooks, no artifact capture)

## Solution

A new Graphton platform tool (`create_pull_request`) that:
1. Self-discovers the repository by running git commands in the sandbox
2. Reads the GitHub token from the credential store (never receives it as a parameter)
3. Makes the GitHub API call from the worker process (not curl-in-sandbox)
4. Returns structured results (PR number, URL) or clear error messages
5. Is auto-approved by default (the push via `execute` is already HITL-gated)

## Implementation Details

### New Module: `graphton/core/git_tools.py`

Factory function `_create_create_pull_request_tool(backend, approval_checker, sub_agent_name)`
produces a LangChain `@tool`-decorated async function following the same pattern as `execute`,
`read`, `write`, etc.

**At invocation time**, the tool:
1. Runs `git remote get-url origin` to discover `owner/repo`
2. Runs `git rev-parse --abbrev-ref HEAD` for the current branch
3. Resolves the base branch via `git remote show origin` (falls back to `main`)
4. Guards against head == base (forces agent to create a branch)
5. Reads `~/.git-credentials` and parses the token
6. Calls `POST /repos/{owner}/{repo}/pulls` via `httpx.AsyncClient`

**Helpers** (`_parse_github_repo`, `_parse_token_from_credentials`) handle both HTTPS and SSH
GitHub URL formats and the git-credential-store file format.

**Error handling** covers: no git remote, non-GitHub repos, detached HEAD, missing credentials,
same-branch guard, GitHub 422 (branch not pushed, PR already exists), 403, timeouts, and
generic failures.

### Tool Registration

Wired into `create_platform_tool_wrappers()` in `tool_wrappers.py`. The tool suite now
creates 12 tools (9 primary + 3 aliases). Added to `PLATFORM_TOOL_DEFAULTS` in
`approval_policy.py` with `requires_approval: False`.

### Prompt Updates

- `_git_writeback_guidance()` in `execute_graphton.py`: now tells the agent to use
  `create_pull_request` after pushing
- `EXECUTE_CAPABILITY` in `prompt_enhancement.py`: describes the PR tool for general
  capability awareness

### Test Coverage

- 30 new tests in `test_git_tools.py`: URL parsing (9), credential parsing (6), end-to-end
  PR creation with mocked GitHub API (11), repo_dir parameter (1), approval integration (2)
- 2 new tests in `test_workspace_prompt_section.py`: tool mentioned with creds, absent without
- 3 existing test files updated for new tool count

## Benefits

- **Structured PR creation**: Agents call `create_pull_request(title, body)` — no curl, no
  raw API knowledge needed
- **Automatic discovery**: Repo URL, branch, and credentials are read from the sandbox at
  invocation time — the tool is stateless and multi-workspace safe
- **Clear error messages**: Every failure mode returns an actionable message the agent can
  reason about
- **Security posture preserved**: Token is read from sandbox filesystem at invocation time,
  held in worker memory only for the API call duration, never logged or returned to the LLM
- **Platform extensible**: Clean `_parse_github_repo` abstraction allows future GitLab/Bitbucket
  support with minimal changes

## Impact

- **Agent capability**: Agents with git credentials can now complete the full code-change
  lifecycle: branch → commit → push → create PR
- **Platform tools**: Graphton's platform tool suite grows from 8 to 9 primary tools
- **Approval policy**: New tool registered in `PLATFORM_TOOL_DEFAULTS` — follows the existing
  policy chain (auto_approve_all > agent overrides > MCP defaults > platform defaults)

## Related Work

- Phase 0: FUSE+S3 volume git compatibility (`--separate-git-dir`)
- Phase 1: Git credential persistence (`~/.git-credentials`, `git_credentials_configured`)
- Phase 2: Write-back prompt (`_git_writeback_guidance()`)
- Phase 4 (next): PR URL as execution artifact, end-to-end validation

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3 of sandbox-github-pr project (single session)
