# Workspace Provisioner Module (Phase 2)

**Date**: February 28, 2026

## Summary

Implemented the workspace provisioner module that dispatches on `WorkspaceSource` proto variants (git_repo, local_path, empty) to populate workspace content into a `WorkspaceBackend`. This is the core provisioning layer that sits between the session proto and the workspace backend, enabling Stigmer agents to operate on git repositories, user project directories, or empty workspaces through a single unified interface.

## Problem Statement

Stigmer's agent execution had no concept of workspace provisioning. Agents always operated in empty session-scoped directories with no way to point them at existing code. The platform needed a provisioner that:

- Reads `WorkspaceSource` from the session proto and provisions accordingly
- Supports git clone (private and public repos), local path pass-through, and empty workspaces
- Handles credential scoping so provisioning tokens don't leak to the agent runtime
- Provides structured error handling with clear, actionable messages

### Pain Points

- No way for agents to work on existing codebases (git repos)
- No local-mode support for users pointing agents at their project directories
- No credential isolation between provisioning and agent runtime environments
- No structured provisioning result for downstream phases (system prompt, output delivery)

## Solution

A modular provisioner architecture with:

1. **Domain types** in `provisioner.py` — `SourceType` enum, frozen `ProvisionResult` and `GitMetadata` dataclasses, `WorkspaceProvisionError` with structured context
2. **Source handlers** in `sources/` — each handler is a focused module with a `provision()` function and its own validation logic
3. **Orchestrator** — `WorkspaceProvisioner` class dispatches on `WorkspaceSource.oneof` and handles `WORKSPACE_PROVISION_`-prefixed key stripping (AD-05)

## Implementation Details

### New Files (6 production + 3 test)

| File | Role |
|------|------|
| `worker/workspace/provisioner.py` | Domain types + `WorkspaceProvisioner` class |
| `worker/workspace/sources/__init__.py` | Package init |
| `worker/workspace/sources/git.py` | Git clone with token injection, depth/branch/commit, error classification |
| `worker/workspace/sources/local_path.py` | Path validation + cloud-mode rejection (AD-09 v3) |
| `worker/workspace/sources/empty.py` | Returns `backend.root_dir` unchanged |
| `tests/workspace/test_provisioner.py` | Dispatch + prefix stripping + immutability |
| `tests/workspace/test_git_source.py` | Clone variations, auth, metadata, token scrubbing |
| `tests/workspace/test_local_path_source.py` | Valid paths, cloud rejection, validation failures |

### Key Design Decisions

- **`SourceType` enum** instead of stringly-typed `str` (plan correction)
- **`dict[str, str]`** for merged environment to match call-site reality (plan correction)
- **`tuple[str, ...]`** for `consumed_keys` — true immutability on frozen dataclass (plan correction)
- **Deferred imports** in provisioner to break circular dependency (matches existing `initialize_workspace` pattern)
- **Token scrubbing** — GITHUB_TOKEN replaced with `***` in all git error messages
- **Non-empty directory guard** — pre-clone check prevents opaque git failures
- **`ProvisionResult.root_dir`** is the authoritative workspace root, documented for Phase 3 integration

### Security

- Token constructed in memory, never logged or stored
- Token scrubbed from all error messages before reaching `WorkspaceProvisionError`
- `WORKSPACE_PROVISION_`-prefixed keys stripped unconditionally (AD-05)
- `consumed_keys` allows caller to strip provisioning credentials from agent environment

## Benefits

- **Agents can now work on real codebases** — git clone support with authentication
- **Local development UX** — `LocalPathSource` lets agents operate directly on user files
- **Credential isolation** — provisioning tokens don't leak to agent runtime
- **Structured errors** — every failure path produces a `WorkspaceProvisionError` with source type, clear message, and cause chain
- **51 tests** covering all source handlers, dispatch logic, and edge cases

## Impact

- **Agent-runner workspace module** — Extended with provisioning layer
- **Phase 3 consumers** — Clean `ProvisionResult` API with documented `root_dir` contract
- **Phase 4 consumers** — `workspace_description` and `GitMetadata` ready for system prompt injection
- **Zero regressions** — all 37 existing workspace tests continue to pass

## Related Work

- Phase 0: WorkspaceBackend extraction (`2026-02-27-233816-workspace-backend-extraction.md`)
- Phase 1: Proto changes (`2026-02-27-222348-workspace-provisioning-proto-foundation.md`)
- AD-09 v3: LocalPathSource restoration (`2026-02-27-235213-ad09-local-path-source-proto-revision.md`)
- Next: Phase 3 (Integration wire-up into `execute_graphton.py`)

---

**Status**: Production Ready
**Timeline**: Phase 2 of 5 in workspace provisioning project
