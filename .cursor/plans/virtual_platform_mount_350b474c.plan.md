---
name: Virtual Platform Mount
overview: Implement the virtual platform mount (AD-01 v3) to physically isolate platform files outside the workspace root. The backend's path resolution layer routes `.stigmer/*` to an external `platform_dir` while the user's project directory is never modified.
todos:
  - id: step-1-classifier
    content: Create shared platform_mount.py classifier module (both agent-runner and graphton sides)
    status: completed
  - id: step-2-protocol
    content: Add platform_dir property to WorkspaceBackend protocol
    status: completed
  - id: step-3-local-backend
    content: Implement virtual mount in LocalWorkspaceBackend._resolve() + execute() env var + tests
    status: completed
  - id: step-4-filesystem-backend
    content: Implement virtual mount in FilesystemBackend._resolve_sandbox_path() + execute() + list_files() merge + tests
    status: completed
  - id: step-5-init-workspace
    content: WorkspaceInitResult dataclass, platform_dir creation in initialize_workspace(), update caller
    status: completed
  - id: step-6-skill-paths
    content: "SkillWriter path change: bin/skills -> .stigmer/skills + update tests"
    status: completed
  - id: step-7-attachment-paths
    content: "inject_attachments path change: .stigmer-inputs -> .stigmer/inputs + update prompts + tests"
    status: completed
  - id: step-8-git-diff
    content: "Git diff artifact: remove pathspec exclusions (platform files no longer in workspace)"
    status: completed
  - id: step-9-provisioner
    content: "Git source handler: conditional git excludes, remove old platform exclude entries"
    status: completed
  - id: step-10-agent-wiring
    content: "Agent runtime wiring: pass platform_dir through sandbox_config to FilesystemBackend"
    status: completed
  - id: step-11-local-tests
    content: Run full test suite, fix any regressions
    status: completed
  - id: phase-b-cloud
    content: "Cloud mode: pause and present Daytona backend options before implementing"
    status: completed
  - id: phase-c-integration
    content: Integration tests for full-stack verification
    status: completed
isProject: false
---

# Virtual Platform Mount Implementation Plan

## Domain Analysis (Architect Critique)

After studying every file that will be touched, I want to flag three architectural concerns with the T01 plan before we execute:

### Concern 1: DRY violation across 4 backends

The T01 plan has the virtual mount rule duplicated in 4 classes: `LocalWorkspaceBackend._resolve()`, `DaytonaWorkspaceBackend._abs()`, `FilesystemBackend._resolve_sandbox_path()`, and `WorkspaceNormalizingBackend._normalize()`. Each has different resolution mechanics (Path vs string, resolve() vs concat, containment check vs sandbox enforcement), but the **routing decision** ("is this a `.stigmer/`* path?") is identical.

**Fix**: Extract a shared pure function `classify_platform_path(rel_path) -> (is_platform, relative_remainder)` into a new `platform_mount.py` module. Each backend calls this classifier and routes to the appropriate base dir. One source of truth for the prefix constant and classification logic.

### Concern 2: Growing positional tuple return from `initialize_workspace()`

Currently returns `tuple[WorkspaceBackend, Any | None, bool]`. Adding `platform_dir` makes it a 4-tuple, which is fragile and opaque at call sites. There is exactly one caller (`execute_graphton.py`).

**Fix**: Introduce a frozen dataclass `WorkspaceInitResult` with named fields. Clean, self-documenting, extensible without breaking callers.

### Concern 3: Cloud mode pragmatism

The Daytona sandbox is a disposable managed container -- the user never sees its filesystem. Implementing virtual mount logic in `DaytonaWorkspaceBackend` and `WorkspaceNormalizingBackend` adds complexity for a "pollution" concern that doesn't apply inside a sandbox. An alternative is to use a physical `.stigmer/` directory inside the sandbox workspace (or a symlink from workspace to a sibling dir), since there's no user to pollute.

**Recommendation**: We implement local mode first (where the virtual mount truly matters). For cloud mode backends, I'll pause and present options before adding complexity that may not be warranted. This keeps Phase A lean and testable.

---

## Execution Strategy

We execute in 3 phases: **Local mode end-to-end**, then **cloud mode**, then **integration tests**. Each phase produces a testable increment. We commit after each phase.

---

## Phase A: Local Mode (the critical path)

### Step 1: Shared platform mount classifier

Create new module [worker/workspace/platform_mount.py](backend/services/agent-runner/worker/workspace/platform_mount.py).

```python
PLATFORM_PREFIX = ".stigmer/"
PLATFORM_DIR_NAME = ".stigmer"
STIGMER_PLATFORM_DIR_ENV = "STIGMER_PLATFORM_DIR"

def classify_platform_path(rel_path: str) -> tuple[bool, str]:
    """Determine if a path targets the virtual platform mount.
    
    Returns (is_platform, cleaned_rel_path) where cleaned_rel_path
    is the path relative to the appropriate root directory.
    """
    clean = rel_path.lstrip("/")
    if clean.startswith(PLATFORM_PREFIX):
        return True, clean[len(PLATFORM_PREFIX):]
    if clean == PLATFORM_DIR_NAME:
        return True, ""
    return False, clean
```

Also create the graphton-side equivalent at [graphton/core/backends/platform_mount.py](backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py) (identical logic -- these two packages cannot share imports).

### Step 2: `WorkspaceBackend` protocol (sub-task 1.1)

File: [worker/workspace/backend.py](backend/services/agent-runner/worker/workspace/backend.py)

- Add optional `platform_dir` property to protocol (default `None`)
- Document the `.stigmer/` virtual mount convention in the module docstring

### Step 3: `LocalWorkspaceBackend` virtual mount (sub-task 1.2)

File: [worker/workspace/local.py](backend/services/agent-runner/worker/workspace/local.py)

- `__init__()` accepts optional `platform_dir: str | Path | None`
- Expose `platform_dir` property (returns `str | None`)
- `_resolve()` uses `classify_platform_path()` to route `.stigmer/*` to `self._platform_root` with its own containment check
- `execute()` injects `STIGMER_PLATFORM_DIR` into env when `platform_dir` is set
- `list_files(".")` (implicit -- `_resolve(".")` returns workspace root, but we must also inject `.stigmer` into the listing; this requires a small override or post-processing in a new `list_files()` method)

Wait -- `LocalWorkspaceBackend` has no `list_files()` method currently. Only `write_file`, `read_file`, `file_exists`, `mkdir`, `execute`. The `WorkspaceBackend` protocol doesn't define `list_files` either. The listing merge only matters at the **graphton** level (`FilesystemBackend.list_files()`). So for the agent-runner layer, we only need the path routing and env var injection. This simplifies Step 3.

**Tests** (in [tests/workspace/test_local_backend.py](backend/services/agent-runner/tests/workspace/test_local_backend.py)):

- `.stigmer/`* paths resolve to platform_dir
- Regular paths still resolve to root_dir
- Traversal escapes from both scopes are blocked
- `execute()` exposes `$STIGMER_PLATFORM_DIR`
- No `platform_dir` = unchanged behavior

### Step 4: `FilesystemBackend` virtual mount (sub-task 1.4)

File: [graphton/core/backends/filesystem.py](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py)

- `__init__()` accepts optional `platform_dir: str | Path | None`
- `_resolve_sandbox_path()` uses `classify_platform_path()` to route
- `execute()` injects `STIGMER_PLATFORM_DIR` into env
- `list_files(".")` merges virtual `.stigmer` entry when `platform_dir` is set
- `list_files(".stigmer/...")` resolves against `platform_dir`

**Tests** (in [tests/core/test_filesystem_backend.py](backend/libs/python/graphton/tests/core/test_filesystem_backend.py)):

- All existing tests pass unchanged (backward compat)
- New test class for platform mount: read, write, list_files, execute env var, containment
- `list_files(".")` includes `.stigmer` when platform_dir set
- `list_files(".stigmer/skills/")` lists from platform_dir

### Step 5: `initialize_workspace()` creates platform_dir (sub-task 1.6)

File: [worker/workspace/**init**.py](backend/services/agent-runner/worker/workspace/__init__.py)

- Define `WorkspaceInitResult` frozen dataclass (replaces the tuple return)
- Local mode: compute `platform_dir = ~/.stigmer/sessions/{session_id}/platform/`, create it, pass to `LocalWorkspaceBackend`
- Cloud mode: defer (Phase B)
- Return `WorkspaceInitResult` instead of tuple
- Update the single caller in `execute_graphton.py` to destructure the new type

### Step 6: SkillWriter path change (sub-task 1.8)

File: [worker/activities/graphton/skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py)

- `_SKILLS_RELATIVE_BASE`: `"bin/skills"` -> `".stigmer/skills"`
- `SKILLS_BASE_DIR`: `"/bin/skills"` -> `"/.stigmer/skills"`
- `generate_prompt_section()`: update text references, add note about `$STIGMER_PLATFORM_DIR` for shell scripts
- Update all test assertions in [tests/test_skill_writer.py](backend/services/agent-runner/tests/test_skill_writer.py)

### Step 7: `inject_attachments` path change (sub-task 1.9)

File: [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)

- Default mount_path: `".stigmer-inputs/{filename}"` -> `".stigmer/inputs/{filename}"`
- System prompt text (line 1652): update `.stigmer-inputs/` -> `.stigmer/inputs/`
- Resume fast path (line 1440): update the same
- Update test assertions in [tests/test_inject_attachments.py](backend/services/agent-runner/tests/test_inject_attachments.py)

### Step 8: Git diff artifact cleanup (sub-task 1.10)

File: [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) line 614

- Remove pathspec exclusions: `"git diff -- ':!.stigmer-inputs' ':!bin/skills'"` -> `"git diff"`
- Platform files are no longer in the workspace tree -- no exclusions needed
- If `platform_dir` is NOT set (flag off), keep the old exclusions for backward compat

### Step 9: Provisioner updates (sub-task 1.7)

File: [worker/workspace/sources/git.py](backend/services/agent-runner/worker/workspace/sources/git.py)

- `_PLATFORM_EXCLUDES`: change from `(".stigmer-inputs", "bin/skills")` to `(".stigmer",)` (the virtual mount means `.stigmer` is never in the workspace, but if the feature is gated, we may need conditional logic)
- When `platform_dir` is active, `_setup_git_excludes()` can skip entirely (platform files don't exist in workspace)
- Update tests in [tests/workspace/test_git_source.py](backend/services/agent-runner/tests/workspace/test_git_source.py)

### Step 10: Agent runtime wiring -- local mode (sub-task 1.11 partial)

File: [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) ~line 1708

- When constructing `sandbox_config_for_agent` for local mode, add `"platform_dir"` key
- File: [graphton/core/sandbox_factory.py](backend/libs/python/graphton/src/graphton/core/sandbox_factory.py) ~line 96 -- pass `platform_dir` from config to `FilesystemBackend` constructor

### Step 11: Run all tests, fix regressions

Run the full test suite for agent-runner and graphton. Every existing test must pass. New tests must cover the virtual mount.

---

## Phase B: Cloud Mode (Daytona backends)

This phase handles sub-tasks 1.3 and 1.5. Before implementing, I will **pause and present options**:

- **Option 1**: Virtual mount in Daytona backends (consistent with local mode, but adds complexity to `DaytonaWorkspaceBackend._abs()` and `WorkspaceNormalizingBackend._normalize()`)
- **Option 2**: Physical `.stigmer/` inside the sandbox workspace (simpler, sandbox is disposable, no pollution concern applies)
- **Option 3**: Physical sibling dir + symlink inside sandbox (platform files at `/home/daytona/.stigmer/`, symlink from workspace -- acceptable since it's a sandbox, not user's machine)

We'll decide together before writing code.

---

## Phase C: Integration Tests (sub-task 1.12)

End-to-end tests covering the full stack for local mode (and cloud mode once decided). Focus areas:

- Skills written to `.stigmer/skills/` physically land in `platform_dir`
- Agent-runtime `read(".stigmer/skills/...")` returns correct content
- `list_files(".")` includes virtual `.stigmer` entry
- `execute("echo $STIGMER_PLATFORM_DIR")` returns platform_dir
- Traversal guards block escapes from both scopes
- Git diff artifact has no platform noise
- `local_path` workspace has ZERO modifications (verified via directory listing)
- No `platform_dir` configured = backward compatible

---

## Files Modified (Summary)

**New files:**

- `backend/services/agent-runner/worker/workspace/platform_mount.py`
- `backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py`

**Modified files (agent-runner):**

- `worker/workspace/backend.py` -- protocol gains `platform_dir`
- `worker/workspace/local.py` -- virtual mount in `_resolve()`, env var in `execute()`
- `worker/workspace/__init__.py` -- `WorkspaceInitResult`, platform_dir creation
- `worker/workspace/provisioner.py` -- may gain `platform_dir` on `ProvisionResult` if needed
- `worker/workspace/sources/git.py` -- conditional git excludes
- `worker/activities/graphton/skill_writer.py` -- path constants
- `worker/activities/execute_graphton.py` -- attachments, git diff, sandbox config wiring

**Modified files (graphton):**

- `graphton/core/backends/filesystem.py` -- virtual mount, env var, list_files merge
- `graphton/core/sandbox_factory.py` -- pass `platform_dir` to FilesystemBackend

**Modified tests:**

- `tests/workspace/test_local_backend.py`
- `tests/workspace/test_git_source.py`
- `tests/test_skill_writer.py`
- `tests/test_inject_attachments.py`
- `graphton/tests/core/test_filesystem_backend.py`

