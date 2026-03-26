---
name: GitHub Token Sandbox PR
overview: Enable Stigmer agents to push code changes and create GitHub PRs from within the sandbox by persisting git credentials past the provisioning phase, without exposing the token to the LLM context or MCP placeholder resolution.
todos:
  - id: gap-1-credential-helper
    content: Configure git credential helper in sandbox during provisioning (git.py) instead of relying on env var for push
    status: pending
  - id: gap-2-prompt-section
    content: Extend workspace prompt section to inform agent about git write-back capability when credentials are configured
    status: pending
  - id: gap-3-gh-cli
    content: Install gh CLI in Daytona sandbox base image so agent can run gh pr create
    status: pending
  - id: gap-4-hitl-approval
    content: Design and implement HITL approval gating for git push / PR creation operations
    status: pending
  - id: gap-5-pr-artifact
    content: Capture PR URL as execution artifact when agent creates a pull request
    status: pending
  - id: gap-6-opt-in
    content: Validate credential-driven + instruction-driven opt-in approach with real agent test
    status: pending
isProject: false
---

# Enable Agent-Driven PR Creation from Sandbox

## Current State (What the Recent Fix Accomplished)

The recent change ([changelog](stigmer/_changelog/2026-03/2026-03-26-123838-inject-github-token-from-personal-environment.md)) solved **cloning** private repos by injecting `GITHUB_TOKEN` from the user's personal environment into the execution context. The token flows through:

1. `CreateExecutionContextStep` injects `GITHUB_TOKEN` from personal environment (Go: `[create_execution_context_step.go](backend/services/stigmer-server/pkg/domain/agentexecution/controller/create_execution_context_step.go)`, Java: `[CreateExecutionContextStep.java](../stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/step/CreateExecutionContextStep.java)`)
2. Agent-runner receives it in `merged_env_vars` via `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`
3. `[git.py](backend/services/agent-runner/worker/workspace/sources/git.py)` uses it to build `https://x-access-token:{token}@github.com/...` for clone
4. **Then the token is STRIPPED** from `merged_env_vars` (AD-05, line ~1642-1649 in `execute_graphton.py`) so it does not leak into MCP config placeholders or the sandbox environment

## The Core Blocker

**AD-05 stripping** removes `GITHUB_TOKEN` from `merged_env_vars` after clone. This means it never reaches `sandbox_config_for_agent["env_vars"]`, so the agent's `execute` tool cannot run `git push` — there are no credentials available.

## Is the Expectation Reasonable?

**Yes, absolutely.** The plumbing is 80% there. The infrastructure for token injection, sandbox shell execution, and git workspace management all exist. The agent already has an `execute` tool that runs arbitrary shell commands in the sandbox with injected env vars. The missing pieces are well-scoped.

**One important clarification on "LLM should not know":** This is already the architecture. Environment variables are injected into the sandbox shell via `export` prefix on each `execute` call (`[daytona.py` backend](backend/libs/python/graphton/src/graphton/core/backends/daytona.py), line ~298-312). They never appear in the LLM's system prompt or message context. The LLM just benefits from git commands working when it runs them via the `execute` tool. So your security requirement is already met by the existing design.

## Gap Analysis

### Gap 1: GITHUB_TOKEN Stripped After Clone (Critical)

The AD-05 design decision strips `GITHUB_TOKEN` from `merged_env_vars` to prevent leakage into MCP `${VAR}` placeholder resolution. This is the right instinct, but it also prevents push.

**Proposed solution: Git Credential Helper instead of env var**

Rather than keeping `GITHUB_TOKEN` in the sandbox env (which would leak into MCP placeholder resolution), configure a **git credential helper** in the sandbox during workspace provisioning. After the clone, run:

```bash
git config --global credential.helper 'store --file=/home/daytona/.git-credentials'
echo "https://x-access-token:{token}@github.com" > /home/daytona/.git-credentials
chmod 600 /home/daytona/.git-credentials
```

This way:

- Token is NOT in shell env vars (AD-05 goal preserved)
- Token is NOT available for MCP `${GITHUB_TOKEN}` placeholder resolution
- Token IS available for any `git push/fetch/pull` operations the agent runs
- Token is NOT visible in the LLM's context window (credential file is just a file on disk; the LLM would have to explicitly `cat` it to see it, which is the same risk as any secret on a filesystem)
- **Change is localized to `[git.py](backend/services/agent-runner/worker/workspace/sources/git.py)`** — the provisioning module that already handles the token

### Gap 2: No "Git Write-Back" Awareness in the Agent (Medium)

The agent currently gets a workspace prompt section (built by `build_workspace_prompt_section` in `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`) that tells it about cloned repos, branches, and paths. But it says nothing about the agent's ability to push changes back.

**Proposed solution: Extend workspace prompt section conditionally**

When `GITHUB_TOKEN` was available during provisioning (i.e., the credential helper was configured), append a "Git Write-Back" section to the workspace prompt. This section would tell the agent:

- It CAN push changes (credentials are configured)
- It should create a branch (never push to the default branch)
- It should commit with meaningful messages
- It should push and provide the branch URL or PR URL
- It should NOT attempt to read or echo the credentials

This is prompt-level guidance, not code the LLM sees as "environment variable" — it's behavioral instruction, same as the existing "Response rules" and "Sub-agent delegation rules" sections.

### Gap 3: No Branch Strategy / PR Creation Tooling (Medium)

The agent can run `git` commands via `execute`, but:

- There is no `gh` CLI in the Daytona sandbox image (needed for `gh pr create`)
- Raw GitHub REST API calls via `curl` are possible but fragile
- A GitHub MCP server could provide `create_pull_request` as a tool

**Options (need your input):**

- **Option A: Install `gh` CLI in Daytona sandbox image** — Simplest. Agent runs `gh pr create`. `gh` auto-detects `GITHUB_TOKEN` from env or can use the credential helper. But this means modifying the sandbox base image.
- **Option B: GitHub MCP server** — The agent already supports MCP servers. A GitHub MCP server (configured at agent or session level) could provide `create_pull_request`, `create_branch`, etc. The `GITHUB_TOKEN` would need to be available for MCP env resolution (conflicts with AD-05 stripping).
- **Option C: Platform-provided "create_pr" tool** — A new Graphton platform tool (alongside `read`, `write`, `edit`, `execute`) that handles the git branch + push + GitHub API call. Token is available to the platform tool (not to the LLM). The agent calls `create_pr(title, body, base_branch)` and the tool handles the rest.

**My recommendation: Start with Option A (gh CLI in sandbox), evolve to Option C.**

Option A is the fastest path to value. The agent can run `gh pr create` via `execute` with the credential helper providing auth. Option C is the long-term right answer (platform-controlled, HITL-compatible, token never touches the LLM's tool output) but requires more design work.

Option B has a circular dependency with AD-05 stripping (the MCP server needs the token in env for placeholder resolution, but AD-05 strips it). Solvable but adds complexity.

### Gap 4: HITL Approval for Push Operations (Important)

Pushing code to a remote repository is a high-stakes, irreversible action. The existing HITL tool approval policy system (seen in `[approval_policy.py](backend/services/agent-runner/worker/activities/graphton/approval_policy.py)` and the `ToolApprovalPolicy` on agent/MCP server specs) should gate this.

**Proposed approach:**

- If using Option A (`gh` via `execute`): The `execute` tool already supports tool approval policies. A pattern-based approval rule could require HITL approval for commands matching `git push` or `gh pr create`.
- If using Option C (platform `create_pr` tool): The tool itself would be HITL-gated by default.

This gap needs design discussion — the current tool approval system works at the tool level (approve/deny the `execute` tool), not at the command-argument level. Gating specific shell commands within `execute` would need a new approval granularity.

### Gap 5: Post-Execution PR Artifact (Nice-to-Have)

The platform already generates a `.patch` file artifact via `_generate_git_diff_artifact`. When a PR is created, the PR URL should be captured as an execution artifact (similar to how diff patches are stored). This would let the user see the PR link directly in the execution viewer.

### Gap 6: Opt-In Behavior (Design Decision)

Not every `git_repo` workspace session should auto-push PRs. This should be opt-in. Options:

- **Agent-level configuration:** A field on the agent spec indicating write-back is enabled
- **Session-level configuration:** A field on the workspace entry (`git_repo` source) indicating push is allowed
- **Instruction-driven:** Just part of the agent's instructions ("when you modify files, create a PR")
- **Credential-driven:** If the credential helper is configured, the capability exists; the agent's instructions determine whether to use it

**My recommendation: Credential-driven + instruction-driven.** The platform configures the credential helper whenever `GITHUB_TOKEN` is available (making push *possible*). Whether the agent actually pushes is determined by the agent's `instructions` field (making push *intentional*). No new proto fields needed initially.

## Proposed Implementation Order

```mermaid
flowchart TD
    A["Gap 1: Git credential helper\n(git.py changes)"] --> B["Gap 2: Workspace prompt section\n(execute_graphton.py)"]
    B --> C["Gap 3: gh CLI in sandbox image\n(Dockerfile change)"]
    C --> D["Gap 6: Validate with agent instructions\n(no code change, just testing)"]
    D --> E["Gap 4: HITL approval design\n(approval_policy.py)"]
    E --> F["Gap 5: PR URL artifact\n(execute_graphton.py)"]
```



## Files That Will Change

- `[backend/services/agent-runner/worker/workspace/sources/git.py](backend/services/agent-runner/worker/workspace/sources/git.py)` — Configure git credential helper after clone
- `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` — Extend workspace prompt section with write-back guidance; track whether credentials were configured via `ProvisionResult`
- `[backend/services/agent-runner/worker/workspace/provisioner.py](backend/services/agent-runner/worker/workspace/provisioner.py)` — Propagate credential-helper status through provision results
- `[backend/services/agent-runner/Dockerfile](backend/services/agent-runner/Dockerfile)` or Daytona sandbox base image — Install `gh` CLI
- Potentially `[backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py](backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py)` — Add git write-back capability section

## Open Questions for You

1. **Option A vs C for PR creation?** Install `gh` CLI in sandbox (fast, simple) vs. platform-provided `create_pr` tool (cleaner, more controllable)? I recommend starting with A.
2. **HITL granularity for `execute`:** Should we gate `git push`/`gh pr create` commands specifically, or is the current tool-level approval (approve all `execute` calls or none) sufficient for now?
3. **Scope of "write-back":** Should this only cover GitHub, or should we design for GitLab/Bitbucket from the start? The credential helper approach is git-generic, but `gh pr create` is GitHub-specific.
4. **Should the credential helper be configured unconditionally** (whenever GITHUB_TOKEN is present) or only when the agent's instructions suggest write-back intent?

