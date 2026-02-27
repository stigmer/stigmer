---
name: Phase 2 Workspace Provisioner
overview: Implement the WorkspaceProvisioner module that dispatches on WorkspaceSource variants (git_repo, local_path, empty) to provision workspace content into a WorkspaceBackend, with credential scoping and structured error handling.
todos:
  - id: domain-types
    content: "Create domain types in `provisioner.py`: SourceType enum, GitMetadata, ProvisionResult (frozen dataclasses), WorkspaceProvisionError"
    status: completed
  - id: empty-source
    content: Implement `sources/empty.py` -- trivial handler returning backend.root_dir
    status: completed
  - id: local-path-source
    content: Implement `sources/local_path.py` -- cloud rejection, path validation (absolute, exists, is_dir)
    status: completed
  - id: git-source
    content: Implement `sources/git.py` -- token resolution, URL injection, clone command, depth/branch/commit handling, post-clone metadata, error parsing, token scrubbing
    status: completed
  - id: provisioner-dispatcher
    content: Implement WorkspaceProvisioner class in `provisioner.py` -- dispatch on workspace_source variants, WORKSPACE_PROVISION_ prefix stripping
    status: completed
  - id: update-init
    content: Update `workspace/__init__.py` to export new types (ProvisionResult, SourceType, WorkspaceProvisionError, WorkspaceProvisioner)
    status: completed
  - id: test-provisioner
    content: Write tests for provisioner dispatch and WORKSPACE_PROVISION_ prefix handling
    status: completed
  - id: test-git-source
    content: "Write tests for git source: clone variations, depth semantics, auth, error handling, token scrubbing"
    status: completed
  - id: test-local-path
    content: "Write tests for local_path source: valid path, cloud rejection, validation failures"
    status: completed
isProject: false
---

# Phase 2: Workspace Provisioner Module

## Domain Analysis (per Architect Role)

### Critique of T01 Plan

1. **Stringly-typed source_type** -- `ProvisionResult.source_type: str` allows invalid values like `"git"` or `"local"`. Must be an enum.
2. **merged_env type mismatch** -- The plan says `dict[str, EnvironmentValue]` but the call site in `execute_graphton.py` (line ~1248-1340) builds `dict[str, str]`. The provisioner receives pre-extracted values. **Resolved**: use `dict[str, str]`.
3. `**workspace_description` as a presentation concern on a domain result** -- This mixes presentation (system prompt text) with provisioning. However, the provisioner holds all context needed (repo URL, branch, commit, path) and generating the description here avoids re-assembling that context in Phase 4. **Accepted**: pragmatic, keeps knowledge local.
4. **No idempotency guard** -- The plan doesn't address what happens if `provision()` is called on an already-populated workspace. Phase 3 handles the "skip if READY" guard, but the git source should still fail clearly if the target directory is non-empty rather than silently corrupting state.
5. `**consumed_keys` as mutable list on a frozen result** -- A `list[str]` on a `frozen=True` dataclass allows mutation of the list itself. Must use `tuple[str, ...]` for true immutability.

### Corrections Applied

- `SourceType` enum replaces `str`
- `dict[str, str]` for merged environment
- `tuple[str, ...]` for consumed_keys
- All result types are `@dataclass(frozen=True)`
- Git source validates target directory is empty before cloning
- `WorkspaceProvisionError` carries structured context (source_type + cause chain)

## Module Structure

```mermaid
graph TD
    subgraph provisioner_module ["worker/workspace/"]
        P[provisioner.py]
        B[backend.py]
        L[local.py]
        D[daytona.py]
        Init[__init__.py]
        subgraph sources_pkg ["sources/"]
            SG[git.py]
            SL[local_path.py]
            SE[empty.py]
            SI[__init__.py]
        end
    end
    P -->|dispatches to| SG
    P -->|dispatches to| SL
    P -->|dispatches to| SE
    SG -->|uses| B
    SE -->|uses| B
```



**New files** (Phase 2):

- `worker/workspace/provisioner.py` -- Domain types + provisioner class
- `worker/workspace/sources/__init__.py` -- Package init
- `worker/workspace/sources/git.py` -- Git clone source handler
- `worker/workspace/sources/local_path.py` -- Local path source handler
- `worker/workspace/sources/empty.py` -- Empty workspace handler (trivial)
- `tests/workspace/test_provisioner.py` -- Provisioner dispatch tests
- `tests/workspace/test_git_source.py` -- Git source tests
- `tests/workspace/test_local_path_source.py` -- Local path tests

**Modified files**:

- `worker/workspace/__init__.py` -- Export new types

All paths relative to `backend/services/agent-runner/`.

## Key Domain Types

All types live in `[worker/workspace/provisioner.py](backend/services/agent-runner/worker/workspace/provisioner.py)`.

### SourceType (enum)

```python
class SourceType(Enum):
    GIT_REPO = "git_repo"
    LOCAL_PATH = "local_path"
    EMPTY = "empty"
```

### GitMetadata (value object)

```python
@dataclass(frozen=True)
class GitMetadata:
    repo_url: str       # HTTPS URL, never contains token
    branch: str         # Actual branch (resolved from default if not specified)
    base_commit: str    # HEAD SHA at clone time
```

Deliberately excludes the token. Only carries information needed for system prompts and output delivery (Phase 4 / AD-10 patch artifact).

### ProvisionResult (value object)

```python
@dataclass(frozen=True)
class ProvisionResult:
    root_dir: str
    source_type: SourceType
    consumed_keys: tuple[str, ...]
    workspace_description: str
    git_metadata: GitMetadata | None = None
```

**Critical contract**: `root_dir` is the **authoritative** workspace root for all subsequent operations. For `local_path`, this differs from `backend.root_dir`. Phase 3 must respect this -- if they differ, the backend must be re-created with the provisioner's `root_dir`.

### WorkspaceProvisionError (domain exception)

```python
class WorkspaceProvisionError(Exception):
    def __init__(
        self,
        source_type: SourceType,
        message: str,
        *,
        cause: Exception | None = None,
    ):
        self.source_type = source_type
        self.cause = cause
        super().__init__(f"[{source_type.value}] {message}")
```

Follows the existing agent-runner exception pattern (see `CheckpointerCreationError`, `GrpcRetryExhaustedError`): structured context fields + human-readable message.

## Provisioner Implementation

### WorkspaceProvisioner class

```python
class WorkspaceProvisioner:
    async def provision(
        self,
        workspace_source: WorkspaceSource | None,
        backend: WorkspaceBackend,
        merged_env: dict[str, str],
        is_local_mode: bool,
    ) -> ProvisionResult:
```

Dispatch logic:

- `workspace_source is None` or not set --> `sources.empty.provision(backend)`
- `workspace_source.HasField('git_repo')` --> `sources.git.provision(source.git_repo, backend, merged_env)`
- `workspace_source.HasField('local_path')` --> `sources.local_path.provision(source.local_path, is_local_mode)`

After dispatch, the provisioner strips `WORKSPACE_PROVISION_`-prefixed keys from `consumed_keys` (AD-05 reserved prefix). Any key in `merged_env` starting with `WORKSPACE_PROVISION_` is added to the consumed set regardless of source type.

### Git Source (`sources/git.py`)

Core function:

```python
def provision(
    source: GitRepoSource,
    backend: WorkspaceBackend,
    merged_env: dict[str, str],
) -> ProvisionResult:
```

**Token resolution**:

- Look for `GITHUB_TOKEN` in `merged_env`
- If present and URL is `github.com`: inject as `https://x-access-token:{token}@github.com/...`
- If present and URL is NOT `github.com`: log warning, attempt clone without injection (public repo path)
- If absent: clone without auth (public repo)

**Clone command construction**:

- Depth: `not source.HasField('depth')` --> `--depth 1`; `source.depth == 0` --> omit (full clone); `source.depth > 0` --> `--depth {N}`
- Branch: `source.branch` set --> `--branch {branch}`; empty --> omit (default branch)
- Target: clone into `backend.root_dir` (i.e., `git clone {url} {backend.root_dir}` or `git clone {url} .` with `cwd=backend.root_dir`)
- Timeout: 300s (5 min) for clone; 30s for post-clone operations

**Post-clone**:

- If `source.commit` is set: `git checkout {commit}` (detached HEAD)
- Resolve actual branch name: `git rev-parse --abbrev-ref HEAD` (for default branch discovery)
- Get HEAD SHA: `git rev-parse HEAD`

**Security**:

- The authenticated URL is constructed in memory, passed to `backend.execute()`, and never stored or logged
- Error messages from git are sanitized: any occurrence of the token in stderr is replaced with `*`**
- `consumed_keys` includes `"GITHUB_TOKEN"` only if the token was actually found in `merged_env`

**Error handling** (parse git stderr):

- Auth failure (`Authentication failed`, `could not read from remote`) --> `WorkspaceProvisionError` with message suggesting GITHUB_TOKEN
- Repo not found (`not found`) --> clear message about URL validity
- Branch not found (`not found in upstream`, `Remote branch ... not found`) --> list what was requested
- Network error (`unable to access`, `Could not resolve host`) --> network-level message
- Non-empty target directory --> detected pre-clone, clear message about workspace state

**Consumed keys**: `("GITHUB_TOKEN",)` if token was in `merged_env`, else `()`

### Local Path Source (`sources/local_path.py`)

```python
def provision(
    source: LocalPathSource,
    is_local_mode: bool,
) -> ProvisionResult:
```

- **Cloud rejection**: if `not is_local_mode`, raise `WorkspaceProvisionError(LOCAL_PATH, "LocalPathSource is only supported in local mode. Use git_repo for cloud deployments.")`
- **Path validation**:
  - Must be absolute (`os.path.isabs`)
  - Must exist (`os.path.exists`)
  - Must be a directory (`os.path.isdir`)
  - Each failure raises `WorkspaceProvisionError` with specific message
- **Returns**: `ProvisionResult(root_dir=source.path, source_type=LOCAL_PATH, consumed_keys=(), ...)`
- **No backend needed**: local_path doesn't use the `WorkspaceBackend` at all

Note: `root_dir` will differ from `backend.root_dir`. This is intentional -- Phase 3 handles the backend re-creation.

### Empty Source (`sources/empty.py`)

```python
def provision(backend: WorkspaceBackend) -> ProvisionResult:
```

- Returns `ProvisionResult(root_dir=backend.root_dir, source_type=EMPTY, consumed_keys=(), workspace_description="...", git_metadata=None)`
- Intentionally trivial -- existing behavior, just formalized as a source type

## Security Considerations

- **Token in clone URL (MVP)**: URL injection (`x-access-token:{token}@host`) is the standard pattern used by GitHub Actions and CI/CD systems. Acceptable for MVP. Future improvement: `GIT_ASKPASS` credential helper.
- **Token never stored**: constructed in memory for the clone command only.
- **Token scrubbed from errors**: any git stderr containing the token has it replaced with `*`** before inclusion in `WorkspaceProvisionError`.
- **WORKSPACE_PROVISION_ prefix**: keys with this prefix are always stripped (AD-05), regardless of whether any source handler consumed them.

## Tests

### test_provisioner.py

- Dispatch: `None` workspace_source --> empty source
- Dispatch: `git_repo` set --> git source called
- Dispatch: `local_path` set --> local_path source called
- `WORKSPACE_PROVISION`_* keys are always in consumed_keys
- ProvisionResult is frozen (attribute reassignment raises)

### test_git_source.py

- Clone with GITHUB_TOKEN for github.com URL (mock `backend.execute`)
- Clone without auth (public repo, no token in env)
- Depth: absent --> `--depth 1`
- Depth: 0 --> full clone (no depth flag)
- Depth: N --> `--depth N`
- Branch specified --> `--branch {branch}` flag
- Commit specified --> post-clone `git checkout {commit}`
- Branch + commit --> clone branch, then checkout commit
- Default branch resolved via `git rev-parse --abbrev-ref HEAD`
- `GitMetadata.repo_url` never contains the token
- `consumed_keys` includes `GITHUB_TOKEN` only when present in env
- Auth failure --> `WorkspaceProvisionError` with helpful message
- Repo not found --> `WorkspaceProvisionError`
- Branch not found --> `WorkspaceProvisionError`
- Non-empty target directory --> `WorkspaceProvisionError`
- Token scrubbed from error messages

### test_local_path_source.py

- Valid absolute directory path --> success
- Cloud mode --> `WorkspaceProvisionError` rejection
- Relative path --> `WorkspaceProvisionError`
- Nonexistent path --> `WorkspaceProvisionError`
- Path is a file, not directory --> `WorkspaceProvisionError`
- `consumed_keys` is empty
- `root_dir` matches `source.path`

## Cross-Phase Contract (important for Phase 3)

`ProvisionResult.root_dir` is the **authoritative** workspace root. For `local_path`, this differs from the `backend.root_dir` that `initialize_workspace` created. Phase 3's integration must:

1. Compare `provision_result.root_dir` with `backend.root_dir`
2. If different (local_path case), create a new `LocalWorkspaceBackend(root_dir=provision_result.root_dir)`
3. Use the new backend for all subsequent operations (skill writing, attachment injection, etc.)

This is explicitly a Phase 3 concern, but Phase 2's API is designed with this awareness -- `ProvisionResult.root_dir` exists specifically to support this pattern.