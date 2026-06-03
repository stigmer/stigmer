# Disable Cursor Cloud Agents; Provision Git Repos Locally for the Cursor Harness

**Date**: June 3, 2026

## Summary

Cursor execution is now pinned to **LOCAL** agents platform-wide, and the Cursor
harness now **clones git-repo workspace entries itself** instead of delegating
that to Cursor cloud agents. An investigation established that git-backed Cursor
*cloud* agents are not viable for arbitrary user repositories under Stigmer's
current credential model, so the previously-built (but flag-gated) cloud path is
hard-disabled in logic, and the missing local git-clone step was added to the
Cursor activity. The result: a git-repo Cursor session clones the repo into the
sandbox using the user's `GITHUB_TOKEN` and runs a local Cursor agent against it.

## Problem Statement

Stigmer Cloud runs the runner in deployment `MODE=cloud`, and a previously-built
durability feature could route all-git-repo sessions to **Cursor cloud agents**
(`bc-` ids, durable on Cursor's servers) when `STIGMER_CURSOR_CLOUD_MODE_ENABLED`
was set. The intent was native, durable conversational history for git-backed
sessions. The flag was never enabled in production, so the path had never run in
prod's proxy setup.

Two problems surfaced when validating that path:

### Pain Points

- **Cloud cloning can't use Stigmer's user credentials.** Cursor cloud agents
  clone repositories via *Cursor's own* GitHub App connection (the account behind
  the injected API key), not the git credentials Stigmer collects from users. The
  SDK's `cloud: { repos }` accepts no token. GitHub's security model also forbids
  using a user's token issued for *Stigmer's* App to install or grant *Cursor's*
  App access. So a git-backed cloud session fails to even clone a public repo that
  isn't connected to Stigmer's Cursor team — confirmed live: every cloud run
  failed with `[validation_error] Failed to verify existence of branch 'main' in
  repository stigmer/stigmer` despite the repo being public with a valid `main`.
- **The Cursor harness never cloned git repos locally.** Git-repo provisioning
  (`WorkspaceProvisioner` / `provisionGit`) was wired only into the native
  (LangGraph) harness. In the Cursor flow, `resolveWorkspaceDirs` mapped only
  `localPath` entries and skipped `gitRepo` ones; git cloning was delegated to
  Cursor cloud. With cloud off, a git-repo Cursor session would run against an
  empty workspace.

## Solution

1. **Hard-disable cloud Cursor agents in logic** (not just via an unset env flag),
   so no code path can route a session to the cloud agent type while the
   credential story is unresolved.
2. **Provision git repos locally in the Cursor activity**, mirroring the native
   harness, so git-backed Cursor sessions clone the repo into the sandbox (using
   the user's `GITHUB_TOKEN`) and run a local Cursor agent against the real
   working tree.

The cloud capability (`createCloudAgent`, `resolveCloudRepos`, the cloud branch in
the activity) is intentionally retained but unreachable, so it can be re-enabled
cleanly once Stigmer can supply repo access to Cursor (e.g., a per-user Cursor
GitHub App connection or self-hosted Cursor workers).

## Implementation Details

All changes are in `backend/services/runner` (the unified runner, TypeScript).

- **`execute-cursor/cursor-mode.ts`** — `determineCursorMode()` now always
  returns `CursorMode.LOCAL`, regardless of workspace shape or the
  `STIGMER_CURSOR_CLOUD_MODE_ENABLED` flag, with a comment documenting the
  credential reason. The previous workspace/flag-based selection logic is removed
  (preserved in git history).
- **`execute-cursor/index.ts`** — drops the "use persisted `cursor_mode`"
  shortcut so even a session created when cloud was enabled is forced back to
  LOCAL; no runtime path reaches the cloud branch. Adds **Phase 2c**, which calls
  the new provisioning helper after the execution environment (with
  `GITHUB_TOKEN`) is resolved and before the workspace dirs are consumed, and
  assigns the result to `blueprint.workspaceDirs`.
- **`execute-cursor/workspace-provision.ts`** (new) — `provisionCursorWorkspace()`
  runs `WorkspaceProvisioner.provisionAll` over the session's workspace entries
  (clones `gitRepo` entries with `GITHUB_TOKEN`, mounts `localPath` entries),
  using `configureCredentials = config.mode !== "local"` so push/writeback works
  in the Daytona sandbox. Falls back to the workspace root for no-repo sessions.
  Extracted into its own module so it is unit-testable without the activity's
  Temporal/Cursor-SDK dependencies. `provisionGit` is idempotent, so this is safe
  on multi-turn and HITL reinvocations.

### Testing

- **`__tests__/cursor-mode.test.ts`** (new, 9 tests) — locks that
  `determineCursorMode` returns LOCAL for every workspace shape (git-only,
  multi-git, local-path, mixed) with the flag both on and off; plus `isCloudMode`.
- **`__tests__/workspace-provision.test.ts`** (new, 3 tests) — seeds a real,
  hermetic local git repo and asserts `provisionCursorWorkspace` clones it (marker
  file + `.git` present in the returned dir); plus no-entry fallback and
  local-path mount. No network or Cursor API required.
- **`test/integration/cursor_git_workspace_test.go`** (new) — end-to-end: a
  `HARNESS_CURSOR` session with a git-repo workspace entry must clone the repo
  into the local agent's cwd. Proven by asking the agent to run
  `git rev-parse HEAD` and asserting the output matches the repo's live HEAD
  (independently fetched via `git ls-remote`) — a value the model can only obtain
  by running git inside the real clone. Gated on `CURSOR_API_KEY` + unified runner.

Verification: runner `tsc --noEmit` clean for the edited files; vitest cursor +
workspace suites pass (294 passed, 6 skipped); `go vet -tags integration` and
`gofmt` clean for the new integration test.

## Benefits

- **Correctness/safety**: cloud agents can no longer be silently armed by a stray
  env flag into a path known to fail for user repositories.
- **Git-backed Cursor sessions actually work locally**: the runner clones the repo
  with the user's credentials and the local Cursor agent operates on the real tree
  — matching the native harness's behavior.
- **Reversible**: the cloud code remains intact and unreachable, so re-enabling is
  a small, well-scoped change when the repo-access story is solved.

## Impact

- All Stigmer Cloud Cursor execution runs as LOCAL agents with the existing
  `SessionMemory` continuation for durability (unchanged).
- `STIGMER_CURSOR_CLOUD_MODE_ENABLED` is now inert for Cursor mode selection.
- No production code in `stigmer-cloud` was changed; the flag was never flipped.

## Related Work

- Plan: `~/.cursor/plans/cursor-cloud-only_be685ca5.plan.md`
- Handoff: `_cursor/handoff-cursor-cloud-agents.md`
- Foundation (cloud path, now dormant): `_projects/2026-05/20260509.01.cursor-harness-durability`

## Deferred / Future

- Per-user "connect your repo to Stigmer's Cursor integration" onboarding (install
  Cursor's GitHub App) to make cloud agents viable for connected repos.
- Self-hosted Cursor workers — the only model that accepts Stigmer's user git
  credentials (`CURSOR_GIT_TOKEN`) for cloud-side cloning.

---

**Status**: ✅ Production Ready (runner change; LOCAL-only Cursor execution)
**Timeline**: Single session — investigation, decision, implementation, tests
