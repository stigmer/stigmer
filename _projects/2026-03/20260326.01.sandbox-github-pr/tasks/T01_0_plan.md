# Task T01: Design and Implement Git Credential Persistence + Platform PR Tool

**Created**: 2026-03-26
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution.**

## Objective

Enable Stigmer agents to commit, push, and create GitHub pull requests from within the Daytona sandbox — without exposing the GITHUB_TOKEN to the LLM context, MCP placeholder resolution, or system prompt.

## Current State

The recent personal environment injection fix (2026-03-26) solved the **authentication** side of cloning private repos. The token flows through:

1. `CreateExecutionContextStep` injects `GITHUB_TOKEN` from personal environment
2. Agent-runner receives it in `merged_env_vars`
3. `git.py` uses it to build `https://x-access-token:{token}@github.com/...` for clone
4. **AD-05 stripping** removes `GITHUB_TOKEN` from `merged_env_vars` after clone, preventing it from reaching `sandbox_config_for_agent["env_vars"]`

**However, git clone is currently broken at a lower level.** The Daytona sandbox volume mount filesystem does not support the I/O operations git needs to write `.git/config`:

```
error: could not write config file /home/daytona/workspace/.git/config: Function not implemented
fatal: could not set 'core.repositoryformatversion' to '0'
```

This `ENOSYS` error means a system call (likely `flock` or `fcntl` file locking) is not implemented by the filesystem backing the Daytona volume mount at `/home/daytona/workspace`. This blocks **all** git operations in the workspace, not just push.

### Key Architecture Facts

- The sandbox uses a `VolumeMount` at `/home/daytona/workspace` (subpath `sessions/{session_id}`) for file persistence across sandbox restarts (`sandbox_manager.py`)
- Environment variables are injected into the sandbox shell via `export` prefix on each `execute` call (in `WorkspaceNormalizingBackend`). They **never** appear in the LLM system prompt.
- The agent has an `execute` tool that runs shell commands in the sandbox.
- The agent has no awareness of whether it can push code back.
- There is no git credential helper configured in the sandbox.
- There is no platform-level PR creation tool.
- The existing HITL tool approval system gates at the **tool level**, not at the command-argument level within `execute`.

## Gap Analysis

### Gap 0: Daytona Volume Mount Filesystem Incompatible with Git (BLOCKER)

**Problem:** `git clone` fails with `Function not implemented` when trying to write `.git/config` to `/home/daytona/workspace`. The Daytona volume mount filesystem does not support the system calls git requires (likely `flock`/`fcntl` file locking). This blocks all subsequent work — credential persistence, push, PR creation are all meaningless if clone itself doesn't work.

**Error observed (2026-03-26):**
```
Cloning into '/home/daytona/workspace'...
error: could not write config file /home/daytona/workspace/.git/config: Function not implemented
fatal: could not set 'core.repositoryformatversion' to '0'
```

**Investigation needed:**
- What filesystem type backs the Daytona volume? (NFS, FUSE, overlay, etc.)
- Which specific system call is returning ENOSYS? (`strace` the git process in the sandbox)
- Does the issue affect only the volume-mounted path or the entire sandbox filesystem?
- Does `touch /home/daytona/workspace/test.txt` succeed? (basic write vs. locking)

**Possible solutions (to be validated during investigation):**
1. **Different volume type** — Use a volume/storage class that supports full POSIX semantics (including `flock`)
2. **Clone to non-volume path** — Clone into a non-volume-mounted directory (e.g., `/tmp/workspace` or a local sandbox directory) and symlink or sync to the volume for persistence
3. **Daytona SDK configuration** — Check if there's a volume mount option that enables locking support
4. **Git config workaround** — Some git builds can be configured to avoid `flock` (e.g., `GIT_CONFIG_COUNT` env vars to pre-set config without writing the file), though this is fragile

**Files to investigate:**
- `backend/services/agent-runner/worker/sandbox_manager.py` — Volume creation and mount configuration
- `backend/services/agent-runner/worker/workspace/daytona.py` — How commands are executed in the sandbox
- `backend/services/agent-runner/worker/workspace/sources/git.py` — The clone command that fails
- Daytona SDK documentation for volume mount options

### Gap 1: Git Credential Persistence (Critical — Enables Everything Else)

**Problem:** AD-05 strips `GITHUB_TOKEN` from `merged_env_vars` after clone to prevent MCP `${GITHUB_TOKEN}` placeholder leakage. This is correct, but it also kills push capability.

**Solution: Configure a git credential helper in the sandbox during provisioning.**

After the clone succeeds, run in the sandbox:
```bash
git config --global credential.helper 'store --file=/home/daytona/.git-credentials'
echo "https://x-access-token:{token}@github.com" > /home/daytona/.git-credentials
chmod 600 /home/daytona/.git-credentials
```

**Why this is the right approach:**
- Token is NOT in shell env vars → AD-05 security goal preserved
- Token is NOT available for MCP `${GITHUB_TOKEN}` placeholder resolution
- Token IS available for any `git push/fetch/pull` operations
- Token is NOT in the LLM's context window (credential file on disk; LLM would have to explicitly `cat` it — same risk level as any secret on a filesystem)
- Change is localized to `git.py`, the module that already handles the token

**Files to change:**
- `backend/services/agent-runner/worker/workspace/sources/git.py` — After clone, configure credential helper
- Track credential-helper status in `ProvisionResult` (new field: `git_credentials_configured: bool`)

### Gap 2: Workspace Prompt — Write-Back Awareness (Medium)

**Problem:** The agent gets a workspace prompt section describing cloned repos, branches, and paths. It says nothing about push capability.

**Solution: Extend `build_workspace_prompt_section` conditionally.**

When `git_credentials_configured` is true in the provision result, append a "Git Write-Back" section:
- Agent CAN push changes (credentials are configured)
- Agent should create a branch (never push to the default branch directly)
- Agent should commit with meaningful messages
- Agent should push and report the branch name
- Agent should NOT attempt to read or echo credential files

**Files to change:**
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — `build_workspace_prompt_section` function

### Gap 3: Platform-Provided `create_pr` Tool (Medium-Large)

**Problem:** There is no structured way for the agent to create a GitHub PR. Raw `curl` to the GitHub API is fragile and leaks implementation details to the LLM.

**Solution: New Graphton platform tool `create_pull_request`.**

A platform tool (alongside `read`, `write`, `edit`, `execute`, `ls`, `glob`, `grep`) that:
- Accepts: `title`, `body`, `base_branch` (optional, defaults to repo default), `head_branch` (optional, auto-detects from current branch)
- Internally: Uses the GitHub REST API with the token from `.git-credentials` (or reads it from credential store)
- Returns: PR URL, PR number
- Automatically commits staged changes and pushes if there are uncommitted changes
- **HITL-gated by default** — requires human approval before executing

**Why platform tool instead of `gh` CLI:**
- The tool can read credentials from the credential store without them being in env
- The tool can enforce branch strategy (refuse to push to default branch)
- The tool can be individually HITL-gated (unlike `execute` which is all-or-nothing)
- The tool captures the PR URL as a structured artifact (not just stdout text)
- The tool's implementation is invisible to the LLM — it just sees `create_pull_request(title="...", body="...")`

**Files to change:**
- New file: `backend/libs/python/graphton/src/graphton/core/tools/git_tools.py` — `create_pull_request` tool implementation
- `backend/libs/python/graphton/src/graphton/core/agent.py` — Register the new tool alongside existing platform tools
- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` — Add capability section for git tools

### Gap 4: HITL Approval for PR Creation (Important)

**Problem:** The existing tool approval system gates at tool level. The `create_pull_request` platform tool naturally fits this model.

**Solution:** The `create_pull_request` tool is auto-gated by HITL approval by default.

When the agent calls `create_pull_request`, the execution pauses and surfaces an approval gate to the user showing:
- PR title and body
- Branch name
- Files changed (from `git diff --stat`)
- Target repository

The user can approve, deny, or request changes.

**Files to change:**
- `backend/libs/python/graphton/src/graphton/core/tools/git_tools.py` — Mark tool as requiring approval
- Existing HITL infrastructure should handle the rest (approval checker, execution pause, user notification)

### Gap 5: PR URL as Execution Artifact (Nice-to-Have)

**Problem:** When a PR is created, the URL should be visible in the execution viewer.

**Solution:** After successful PR creation, store the PR URL as an execution artifact.

The platform already has `_generate_git_diff_artifact` that creates `.patch` artifacts. Similarly, capture `pr_url` as a structured artifact type.

**Files to change:**
- `backend/libs/python/graphton/src/graphton/core/tools/git_tools.py` — After successful PR creation, emit artifact
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` — Surface PR URL in status

### Gap 6: Opt-In Behavior (Design Decision)

**Approach: Credential-driven + instruction-driven.**
- The platform configures the credential helper whenever `GITHUB_TOKEN` is available (making push *possible*)
- Whether the agent actually creates PRs is driven by the agent's `instructions` field (making push *intentional*)
- No new proto fields needed initially

## Implementation Phases

### Phase 0: Fix Daytona Volume Mount for Git (Gap 0) — PREREQUISITE
- Investigate the filesystem type backing the Daytona volume at `/home/daytona/workspace`
- Identify the specific system call returning ENOSYS
- Determine and implement a fix (volume type change, mount options, or clone path strategy)
- **Validation:** `git clone` succeeds in the Daytona sandbox workspace

### Phase 1: Credential Helper (Gap 1) — Unblocks Push
- Modify `git.py` to configure credential helper after clone
- Add `git_credentials_configured` to `ProvisionResult`
- **Validation:** Agent can run `git push` via `execute` tool in sandbox

### Phase 2: Write-Back Prompt (Gap 2) — Agent Knows It Can Push
- Extend `build_workspace_prompt_section` with git write-back guidance
- Conditional on `git_credentials_configured`
- **Validation:** Agent, when instructed to create a PR, knows how to do it

### Phase 3: Platform PR Tool (Gap 3 + Gap 4) — Structured PR Creation
- Implement `create_pull_request` platform tool
- HITL-gated by default
- Uses GitHub REST API with token from credential store
- **Validation:** Agent can call `create_pull_request(title, body)` and a PR appears on GitHub

### Phase 4: Artifact + Polish (Gap 5 + Gap 6)
- Capture PR URL as execution artifact
- End-to-end testing with real agent session
- **Validation:** PR URL visible in execution viewer

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Credential file readable by LLM via `read` tool | Token exposed in tool output | The `read` tool in Graphton can have a deny-list for sensitive paths (`~/.git-credentials`). Also, the token is already usable via `execute` — the security boundary is the sandbox itself, not file-level ACLs. |
| AD-05 refactoring breaks MCP placeholder security | MCP servers get GITHUB_TOKEN via `${GITHUB_TOKEN}` | No change to AD-05 — credential helper is orthogonal to env var stripping. Token never enters `merged_env_vars` post-provisioning. |
| GitHub API rate limits on PR creation | PR tool fails | Use authenticated API (token is available). GitHub's rate limit for authenticated requests is 5000/hour — sufficient. |
| Agent creates bad PRs (wrong branch, junk commits) | Noise in user's repo | HITL approval gate shows diff and branch before allowing push. User can deny. |
| Platform tool couples to GitHub API | Harder to add GitLab/Bitbucket later | Design tool interface generically (`create_pull_request`). Implementation can switch on `git remote` hostname. GitHub-only for now, with clean abstraction boundary. |

## Success Criteria

0. `git clone` succeeds in the Daytona sandbox workspace (volume mount filesystem supports git I/O)
1. Agent can `git push` to a new branch in a private GitHub repo from the Daytona sandbox
2. Agent can create a GitHub PR via `create_pull_request` platform tool
3. `GITHUB_TOKEN` never appears in LLM system prompt, message context, or MCP placeholder resolution
4. PR creation is gated by HITL approval (user sees diff + title before approving)
5. PR URL is captured as an execution artifact visible in the execution viewer
6. No regression in existing `git clone` provisioning behavior

## Review Questions

- Does the credential helper approach (vs. keeping token in env) align with your security expectations?
- Should the `create_pull_request` tool auto-commit + push, or should those be separate steps the agent controls?
- Is HITL-by-default the right posture, or should it be configurable per agent?
- Should the `read` tool block access to `~/.git-credentials`, or is sandbox-level isolation sufficient?
