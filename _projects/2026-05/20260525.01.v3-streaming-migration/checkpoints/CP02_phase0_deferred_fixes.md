# Checkpoint CP02: Phase 0 — Deferred Item Fixes

**Date**: 2026-05-26
**Session**: 4
**Status**: COMPLETE

## What Was Done

### 1. WA01 Fix: StateBackend → FilesystemBackend

**Problem**: Agent file writes (via `write_file`, `edit_file`) went to deepagents' in-memory `StateBackend`, but `InlinePublisher` reads from disk via `LocalWorkspaceBackend`. Files never reached disk, so artifact publish silently failed.

**Fix**: Switched both parent agent and subagent graphs from `StateBackend` to `FilesystemBackend({ rootDir: workspaceBackend.rootDir })`.

**Files changed**:
- `backend/services/runner/src/activities/execute-deep-agent/setup.ts` — import and instantiation
- `backend/services/runner/src/activities/execute-deep-agent/subagent-transformer.ts` — import, instantiation, added `workspaceRootDir` to `compileSubagents` options

**Architecture decision**: Subagents also use `FilesystemBackend` sharing the parent's workspace root. This ensures subagent file writes are visible to `InlinePublisher` and `WriteBackCoordinator`.

### 2. WA01 Fix: Offline Harness Artifact Storage Decoupling

**Problem**: `buildUnifiedRunnerEnv()` in `unified_runner.go` unconditionally set `ARTIFACT_STORAGE_TYPE=proxy` when `ProxyEndpoint` was set. Offline tests use `ProxyEndpoint` for MockLLMProxy, which doesn't handle artifact presign endpoints.

**Fix**: Added `LocalArtifactDir` field to `UnifiedRunnerConfig`. When set, the harness uses `ARTIFACT_STORAGE_TYPE=local` with `LOCAL_ARTIFACT_PATH` instead of forcing proxy.

**Files changed**:
- `test/integration/harness/unified_runner.go` — new config field + env logic
- `test/integration-offline/offline_test.go` — set `LocalArtifactDir: t.TempDir()`

### 3. WA01 Tests: Disk-Backed InlinePublisher

Added 2 tests to `inline-publisher.test.ts` using real `LocalWorkspaceBackend` (actual filesystem I/O):
- Files written to disk are readable by `InlinePublisher` and produce correct artifacts
- Missing files on disk fail gracefully (fire-and-forget)

### 4. WA02 Fix: Git Credential Configuration

**Problem**: `provisionGit()` always set `gitCredentialsConfigured: false`. The `WriteBackCoordinator` eligibility gate requires this flag to be `true`. Writeback was structurally disabled.

**Fix**: Three-part credential store configuration:
1. `configureGitCredentialStore()` in `git.ts` — cleans remote URL, sets `credential.helper store` with repo-local credential file, writes credential entry
2. `provisioner.ts` — wired `configureCredentials` from `dispatch()` through to `provisionGit()`
3. `setup.ts` — passes `configureCredentials: true` when not in local mode

**Files changed**:
- `backend/services/runner/src/shared/workspace/sources/git.ts` — `configureCredentials` option, `configureGitCredentialStore()` function
- `backend/services/runner/src/shared/workspace/provisioner.ts` — pass-through to `provisionGit()`
- `backend/services/runner/src/activities/execute-deep-agent/setup.ts` — enable for non-local mode

### 5. WA02 Tests: Credential Configuration

Added 6 tests to `git-source.test.ts`:
- Credentials configured when `configureCredentials=true` + token present (verifies remote URL cleanup, credential helper config, credential file write)
- No credentials when `configureCredentials=false`
- No credentials when no `GITHUB_TOKEN`
- No credentials for non-GitHub URLs
- Credentials configured on existing repo reuse
- Graceful failure handling when credential setup fails

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| `subagent-transformer.test.ts` | 45 | All pass |
| `inline-publisher.test.ts` | 11 (9 existing + 2 new) | All pass |
| `git-source.test.ts` | 23 (17 existing + 6 new) | All pass |
| Go offline suite | Compiles clean | Not runnable without harness infra |
| Go harness | Compiles clean | Structural verification |

## Files Changed

### Modified
- `backend/services/runner/src/activities/execute-deep-agent/setup.ts`
- `backend/services/runner/src/activities/execute-deep-agent/subagent-transformer.ts`
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/subagent-transformer.test.ts`
- `backend/services/runner/src/activities/execute-deep-agent/__tests__/inline-publisher.test.ts`
- `backend/services/runner/src/shared/workspace/sources/git.ts`
- `backend/services/runner/src/shared/workspace/provisioner.ts`
- `backend/services/runner/src/shared/workspace/__tests__/git-source.test.ts`
- `test/integration/harness/unified_runner.go`
- `test/integration-offline/offline_test.go`
