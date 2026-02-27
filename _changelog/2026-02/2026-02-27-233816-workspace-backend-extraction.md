# WorkspaceBackend Protocol Extraction — Deployment-Agnostic Workspace I/O

**Date**: February 27, 2026

## Summary

Extracted a `WorkspaceBackend` protocol from `execute_graphton.py` that provides a unified interface for all workspace file operations and command execution, eliminating distributed `is_local_mode()` conditionals throughout the agent-runner codebase. This foundational refactor (Phase 0 of the Workspace Provisioning project) reduces the codebase by 1,192 net lines while making `SkillWriter`, `inject_attachments`, and workspace initialization fully deployment-agnostic.

## Problem Statement

The agent-runner's workspace operations were tightly coupled to deployment mode. Every file write, directory creation, file existence check, and command execution had a corresponding `if is_local_mode()` / `else` branch, duplicating logic across local (pathlib) and cloud (Daytona SDK) code paths.

### Pain Points

- **Scattered mode checks**: ~8 `is_local_mode()` checks in `execute_graphton.py` alone for workspace operations
- **Duplicated implementations**: `SkillWriter` maintained parallel `_write_skills_local()` and `_write_skills_daytona()` methods with near-identical business logic
- **`inject_attachments` dual paths**: Separate local and cloud extraction pipelines for ZIP artifacts
- **`_check_workspace_file_exists()` helper**: A standalone function that encapsulated yet another mode check, called from multiple locations
- **Testing burden**: Tests needed separate fixtures and assertions for local vs cloud mode, leading to bloated test suites
- **Extension difficulty**: Adding any new workspace operation (e.g., git clone for Phase 2) would require adding mode checks in yet another location

## Solution

Introduced a `WorkspaceBackend` protocol — a structural interface that abstracts all workspace I/O behind a consistent API. Two concrete implementations handle the deployment-specific details, and a factory function centralizes the mode decision to a single location.

### Architecture

```
execute_graphton.py
        │
        ▼
initialize_workspace()  ◄── single mode decision point
        │
        ├── LocalWorkspaceBackend   (pathlib + subprocess)
        └── DaytonaWorkspaceBackend (Daytona SDK)
        │
        ▼
WorkspaceBackend protocol
        │
        ├── SkillWriter(backend=...)
        ├── inject_attachments(backend=...)
        └── direct backend.file_exists() / backend.execute() calls
```

## Implementation Details

### New Package: `worker/workspace/`

**`backend.py` — Protocol + Value Object**
- `WorkspaceBackend(Protocol)`: 7-method interface — `root_dir`, `write_file`, `write_files`, `read_file`, `file_exists`, `mkdir`, `execute`
- `ExecuteResult`: Frozen dataclass standardizing command output (exit_code, stdout, stderr)

**`local.py` — Local Implementation**
- Uses `pathlib.Path` for all file operations
- Uses `subprocess.run` for command execution
- Includes path traversal protection via `resolved.relative_to(root)` guard

**`daytona.py` — Cloud Implementation**
- Delegates to `sandbox.fs` for file operations
- Delegates to `sandbox.process.exec` for command execution
- `write_files()` uses `sandbox.fs.upload_files()` for batch performance

**`__init__.py` — Factory + Public API**
- `initialize_workspace()`: Centralizes the local/cloud mode decision, returns `(backend, sandbox, is_new_sandbox)`
- Re-exports `WorkspaceBackend`, `ExecuteResult`, `LocalWorkspaceBackend`, `DaytonaWorkspaceBackend`

### Refactored Modules

**`SkillWriter`**
- Constructor changed from `(sandbox=None, local_root=None, workspace_root=None)` to `(*, backend: WorkspaceBackend)`
- Merged `_write_skills_local()` + `_write_skills_daytona()` into unified `write_skills()`
- ZIP extraction unified via in-memory `_extract_zip_in_memory()` → `backend.write_files()`

**`inject_attachments()`**
- Signature changed from `(sandbox, local_root, workspace_root, ...)` to `(backend, ...)`
- Merged dual-mode ZIP extraction into backend-agnostic path
- Safety validation (path traversal, size limits) preserved

**`execute_graphton.py`**
- Replaced sandbox initialization block with single `initialize_workspace()` call
- Deleted `_check_workspace_file_exists()` helper entirely
- All workspace I/O now flows through `workspace_backend.*` methods
- Diagnostic listing, post-write verification, agent sandbox config all use backend

### Test Changes

| Test File | Before | After | Change |
|-----------|--------|-------|--------|
| `test_skill_writer.py` | 36+ tests (dual-mode) | 30 tests (unified) | Rewritten |
| `test_inject_attachments.py` | 34 tests (dual-mode) | 24 tests (unified) | Rewritten |
| `test_workspace_integrity_check.py` | Mode-specific helpers | Backend.file_exists() | Rewritten |
| `test_local_backend.py` | — | New (12+ tests) | Created |
| `test_daytona_backend.py` | — | New (10+ tests) | Created |
| 3 integration test files | `local_root=` / `sandbox=` | `backend=` | Updated |

## Benefits

- **−1,192 net lines**: 682 insertions vs 1,874 deletions — the codebase is smaller and cleaner
- **Single mode decision**: `initialize_workspace()` is the only place that checks `is_local_mode()` for workspace operations
- **Extension point for Phase 2**: Adding git clone workspace provisioning now means calling `backend.execute("git clone ...")` — no new mode checks needed
- **Simpler testing**: Tests either use `LocalWorkspaceBackend(root_dir=tmpdir)` for real filesystem tests or `MagicMock()` for isolation — no dual-mode fixtures
- **Path safety**: `LocalWorkspaceBackend` enforces path traversal protection at the boundary, not scattered across callers

## Impact

- **Agent-runner codebase**: Major simplification of workspace I/O throughout `execute_graphton.py`, `SkillWriter`, and `inject_attachments`
- **Future provisioner work**: Phase 2's `WorkspaceProvisioner` will plug directly into the `WorkspaceBackend` interface
- **Test reliability**: Unified test approach eliminates the class of bugs where local tests pass but cloud tests fail (or vice versa) due to divergent implementations

## Related Work

- Predecessor: [Workspace Provisioning Proto Foundation](2026-02-27-222348-workspace-provisioning-proto-foundation.md) (Phase 1 — `WorkspaceSource` and `GitRepoSource` proto messages)
- Project: `_projects/2026-02/20260227.02.workspace-provisioning/`
- Next: Phase 2 — Workspace Provisioner Module (implements git clone, empty workspace, local path sources)

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours (Complete scope)
