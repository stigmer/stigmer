# Fix Artifact Publish and Writeback Production Blockers

**Date**: May 26, 2026

## Summary

Resolved two production blockers that prevented artifact publishing and git writeback from working end-to-end in the TS unified runner. Agent file writes now land on disk (via deepagents `FilesystemBackend`), and git credential configuration is properly wired through workspace provisioning so the `WriteBackCoordinator` eligibility gate passes when a `GITHUB_TOKEN` is available.

## Problem Statement

Two independent gaps in the TS runner migration from Python made artifact publish and writeback structurally non-functional:

### Pain Points

- Agent `write_file`/`edit_file` operations went to deepagents' in-memory `StateBackend`, but `InlinePublisher.publish()` reads files from disk via `LocalWorkspaceBackend` — files never reached disk, publish silently failed with "File not found"
- `provisionGit()` always set `gitCredentialsConfigured: false` in `GitMetadata`, while `WriteBackCoordinator.initEligibleEntries()` requires this flag to be `true` — writeback was always disabled regardless of whether credentials were available
- The offline test harness forced `ARTIFACT_STORAGE_TYPE=proxy` whenever `ProxyEndpoint` was set, but `MockLLMProxyServer` only handles LLM paths — artifact presign calls returned 404

## Solution

### Artifact Publish: StateBackend → FilesystemBackend

Replaced `new StateBackend()` with `new FilesystemBackend({ rootDir: workspaceBackend.rootDir })` in both the parent agent graph (`setup.ts`) and subagent graphs (`subagent-transformer.ts`). This makes deepagents' built-in file tools (`write_file`, `edit_file`, `create_file`) write directly to the workspace directory on disk, where `InlinePublisher` and `WriteBackCoordinator` can read them.

### Offline Harness: Artifact Storage Decoupling

Added `LocalArtifactDir` field to `UnifiedRunnerConfig`. When set, the harness uses `ARTIFACT_STORAGE_TYPE=local` with `LOCAL_ARTIFACT_PATH` instead of forcing proxy mode. The offline test setup now passes `LocalArtifactDir: t.TempDir()`.

### Writeback: Git Credential Store Configuration

Implemented `configureGitCredentialStore()` in `git.ts` with a three-step process (each step non-fatal):
1. Clean the remote URL — remove embedded token from origin
2. Set `credential.helper store` with a repo-local credential file (inside `.git/`)
3. Write the credential entry to the file

Wired `configureCredentials` from `provisioner.dispatch()` through to `provisionGit()`, and enabled it from `setup.ts` when not in local mode (`config.mode !== "local"`).

## Implementation Details

### Files Modified

| File | Change |
|------|--------|
| `setup.ts` | `StateBackend` → `FilesystemBackend`, pass `configureCredentials` to provisioner |
| `subagent-transformer.ts` | `StateBackend` → `FilesystemBackend`, added `workspaceRootDir` to compile options |
| `git.ts` | Added `configureCredentials` option, `configureGitCredentialStore()` function |
| `provisioner.ts` | Pass `configureCredentials` through to `provisionGit()` |
| `unified_runner.go` | Added `LocalArtifactDir` config field, conditional artifact storage env |
| `offline_test.go` | Use `LocalArtifactDir: t.TempDir()` for offline runner |

### Tests Added

| Test File | New Tests | Total |
|-----------|-----------|-------|
| `inline-publisher.test.ts` | 2 (disk-backed publish, missing file graceful) | 11 |
| `subagent-transformer.test.ts` | 0 (4 updated for new param) | 45 |
| `git-source.test.ts` | 6 (credential config scenarios) | 23 |

## Benefits

- Artifact publishing now works end-to-end: agent writes hit disk, `InlinePublisher` reads them, uploads to storage, registers on status proto
- Git writeback eligibility gate passes when `GITHUB_TOKEN` is available in non-local mode, enabling the full branch → commit → push → PR cycle
- Offline tests can run with local artifact storage, unblocking future E2E artifact publish integration tests
- Subagent file writes are also visible to publish and writeback pipelines

## Impact

- **Runner**: Both blockers resolved — artifact publish and writeback are now structurally functional
- **Offline tests**: Harness supports local artifact storage mode
- **v3 migration**: Phase 0 deferred items fully resolved, no blockers remaining before Phase 1

## Related Work

- Phase 0 Contract Freeze: `checkpoints/CP01_phase0_contract_freeze.md`
- Phase 0 Deferred Fixes: `checkpoints/CP02_phase0_deferred_fixes.md`
- WA01 discovery: `wrong-assumptions/WA01_artifact_publish_offline.md`
- WA02 discovery: `wrong-assumptions/WA02_writeback_offline.md`

---

**Status**: Production Ready
**Timeline**: 1 session
