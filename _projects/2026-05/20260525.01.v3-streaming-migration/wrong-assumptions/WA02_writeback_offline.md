# WA02: Writeback Is Not Achievable Offline

**Date**: 2026-05-26
**Discovered during**: Phase 0, Session 3

## The Assumption

The Phase 0 plan assumed writeback could be tested in the offline harness using `t.TempDir()` + `git init` as a workspace entry.

## The Reality

1. **TS provisioning always disables writeback**: `provisionGit()` in `workspace/sources/git.ts` always sets `gitCredentialsConfigured: false`. The `WriteBackCoordinator.initEligibleEntries()` gate requires `gitCredentialsConfigured === true`. The Python runner had credential-store setup wired here; the TS port is incomplete.

2. **Writeback needs GitHub infrastructure**: Even bypassing the gate, full E2E requires a GitHub remote (for `git push`), push credentials, and the GitHub API (for PR creation via `POST /repos/{owner}/{repo}/pulls`). A bare `t.TempDir()` + `git init` is insufficient.

3. **Workspace is session-scoped, not agent-scoped**: Entries are on `SessionSpec.workspace_entries`, not the agent spec. The CLI builds these from `--workspace` flags.

## What's Needed

1. Port the Python credential configuration path into `shared/workspace/sources/git.ts`
2. Wire `configureCredentials` parameter through `provisionGit()` to set `gitCredentialsConfigured: true` when a token is available
3. For offline tests: either mock GitHub API at network layer or use a dedicated test org/repo

## Mitigation

Unit-level coverage is comprehensive: `writeback-coordinator.test.ts` (20 tests) covers eligibility gates, full incremental cycle (branch → commit → push → PR), multi-entry path resolution, error handling, and phase tracking — all with mocked `WorkspaceBackend` and `fetch`.
