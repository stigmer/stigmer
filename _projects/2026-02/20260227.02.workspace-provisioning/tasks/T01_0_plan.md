# Task T01: Workspace Provisioning Architecture & Implementation

**Created**: 2026-02-27 22:30
**Revised**: 2026-02-28 (post architectural review)
**Status**: Planning (Revised)

## Context

This plan was derived from a deep architectural discussion covering:
- File system access modes (cloud sandbox, local sandboxed, local direct)
- The distinction between Input Files and Workspace (two separate domain concepts)
- Git repository authentication for workspace provisioning
- Agent deployment-agnosticism (agent code must never branch on local vs cloud)
- Credential scoping (provisioning credentials vs agent runtime credentials)
- Workspace awareness in system prompts

## Revision Notes

This is a revised plan incorporating feedback from the Principal Software Architect review.
Key changes from the original plan:

1. **Phase 0 added**: Targeted refactor of `execute_graphton.py` to create clean extension points BEFORE adding workspace provisioning.
2. **`LocalPathSource` removed from proto**: Local path is a runner-level concern, not a wire-protocol concept. It lives in runner config, not in the schema.
3. **Proto3 default-value bugs fixed**: `depth` uses wrapper type, `auto_pr` deferred (see point 5).
4. **Workspace provisioning state added**: `SessionStatus` gets a `workspace_state` field.
5. **Auto-PR deferred to separate project**: Output delivery for MVP uses existing artifact mechanism + git diff/patch artifact. Auto-PR is a fast-follow.
6. **Input file placement fixed**: Inputs go to a sibling directory outside the git working tree, not inside `.stigmer/inputs/`.
7. **Testing embedded in each phase**: No separate "Phase 7." Each phase includes its own test requirements.
8. **Credential stripping improved**: Explicit logging of consumed keys + documentation of provisioning prefixes.
9. **Monorepo subdirectory**: Noted as future enhancement (not in MVP scope).

## Problem Statement

Today, Stigmer's agent execution has several architectural gaps:

1. **No WorkspaceSource concept** -- The agent always operates in an isolated session workspace (`./workspace/sessions/{id}/`). There is no way to point it at a git repo.

2. **Input files round-trip through storage in local mode** -- Even when running locally, attachments go through upload -> storage -> download, which is unnecessary overhead.

3. **Agent code has deployment-mode conditionals** -- `if worker_config.is_local_mode()` checks are scattered through `execute_graphton.py` (8+ occurrences), skills handling, and sandbox management. This violates deployment-agnosticism.

4. **No workspace awareness in system prompt** -- The agent doesn't know it has a workspace. There is no `## Workspace` section telling it what's available and how to explore it.

5. **Credentials are a flat bag** -- All Environment key-value pairs are forwarded to the agent. There is no concept of "provisioning-only" credentials (like `GITHUB_TOKEN` for cloning) that should NOT reach the agent.

## Architectural Decisions

### AD-01: Agent Is Deployment-Agnostic
The agent receives a `root_dir` and works in it. Zero `if local/cloud` in agent code, agent specs, or skills. The divergence exists ONLY in the provisioning layer (infrastructure concern).

### AD-02: WorkspaceSource Is a Session-Level Concept
Workspace persists across multiple executions within a session. `WorkspaceSource` belongs on `SessionSpec`, not `AgentExecutionSpec`. First execution provisions it; subsequent executions reuse it.

**Known limitation**: The workspace decision is immutable per session. Changing the repo or branch requires creating a new session. This is acceptable for MVP.

**UX gap**: The auto-create-session flow (providing `agent_id` without `session_id` on `AgentExecutionSpec`) cannot specify a workspace source. Users who want workspace provisioning must create sessions explicitly. Consider adding optional `workspace_source` to `AgentExecutionSpec` for the auto-create path in a future iteration.

### AD-03: Input Files and Workspace Are Separate Domain Objects
- **Workspace**: WHERE the agent works. Session-scoped. Provisioned once.
- **Input Files**: WHAT the user gives the agent per-execution. Execution-scoped.
Different lifecycle, different concern. Input files are placed INTO the workspace at a location that does not conflict with workspace content.

**Input file placement**: Inputs are placed in a sibling directory outside the workspace working tree (`{session_root}/.stigmer-inputs/`), NOT inside the workspace itself. This prevents:
- Accidental git commits of input files in git-backed workspaces
- Collisions with project files that might have an `/inputs/` directory
- Polluting `git diff` output with non-code artifacts

The system prompt tells the agent where to find inputs (absolute path).

### AD-04: Git Credentials Flow Through Existing Merge Chain
Provisioning credentials come from the same merged environment:
`Agent defaults < Environment < runtime_env (ExecutionContext)`
Both Environment (long-lived) and runtime_env (per-execution) must work for `GITHUB_TOKEN`.

### AD-05: Provisioning Credentials Are Stripped Before Agent Start
Keys consumed by provisioning (e.g., `GITHUB_TOKEN`) are NOT forwarded to the agent's runtime environment.

**MVP approach**: The provisioner returns a `consumed_keys` list. The execution flow strips those keys and logs a clear message for each: `"Key 'GITHUB_TOKEN' was consumed by workspace provisioning and will not be forwarded to the agent."` This makes debugging transparent.

**Reserved prefixes**: Keys starting with `WORKSPACE_PROVISION_` are reserved for provisioning and always stripped. This is documented in the proto field comments and in the CLI `--help` output.

**Escape hatch (future)**: `CredentialScope` enum on `EnvironmentValue` with values `AGENT`, `PROVISIONING`, `BOTH`. For MVP, if a user needs `GITHUB_TOKEN` in both provisioning and agent runtime, they can use `GITHUB_TOKEN` for provisioning and a differently-named key (e.g., `AGENT_GITHUB_TOKEN`) for the agent.

### AD-06: Workspace Awareness via System Prompt Injection
A `## Workspace` section is injected into the system prompt, following the same pattern as `## Available Skills` and `## Input Files`. Lightweight metadata + tools for lazy exploration (Cursor-style).

### AD-07: GitHub-Only for MVP
PAT-based authentication. `GITHUB_TOKEN` in Environment or runtime_env. Token injected into clone URL: `https://x-access-token:{token}@github.com/...`. Future: GitHub App, SSH keys, Vault.

### AD-08: Provisioning Code Lives in Agent-Runner (Structurally Isolated)
New module `worker/workspace/` with clear interface. Can be extracted to a separate service later but lives in agent-runner for MVP.

### AD-09: Local Path Is a Runner-Level Concern, Not a Proto-Level Type (REVISED)

**Original decision**: `LocalPathSource` was a `oneof` variant in the `WorkspaceSource` proto message.

**Revised decision**: `local_path` does NOT appear in the proto schema. It is a runner-level configuration detail.

**Rationale**: `local_path` is ONLY valid in local mode -- it is physically impossible to provision in cloud. Putting it in the proto schema advertises a capability that only works in one deployment mode. This violates the principle that invalid states should be unrepresentable.

**Implementation**: In local mode, the runner detects a `local_path` configuration (via runner config or CLI flag) and provisions the workspace by setting `root_dir` to that path directly. The proto `WorkspaceSource` only carries universally-valid concepts: `git_repo` and `empty`.

### AD-10: Cloud Output for Git Workspaces Uses Existing Artifact Mechanism (NEW)

For MVP, when workspace source is `git_repo` running in cloud mode:
1. Agent modifies files in the cloned workspace
2. Execution completes
3. `_auto_publish_written_files` detects modified files (existing mechanism, no change)
4. Files are uploaded to storage with download URLs (existing behavior)
5. **Additionally**: A `git diff` is generated and included as a patch artifact

The user gets: download URLs for modified files + a `.patch` file they can apply locally.

**Why auto-PR can be safely deferred**: Auto-PR is purely additive. It adds a new output delivery strategy on top of the provisioner. It does NOT require changes to `WorkspaceSource`, `SessionSpec`, or agent code. The `GitContext` metadata needed for auto-PR can be added to `ProvisionResult` at that time without breaking changes.

**Why the existing mechanism works**: `_auto_publish_written_files` operates on "files that were modified during execution." It doesn't care whether the workspace started empty or was cloned from a git repo. It sees modified files and uploads them. The only MVP enhancement is running `git diff` before upload to produce the patch artifact.

## Implementation Plan

### Phase 0: Targeted Refactor -- Create Clean Extension Points
**Estimated effort**: 2 days
**Goal**: Extract mode-specific logic from `execute_graphton.py` into interface-backed modules, creating clean seams for workspace provisioning to plug into.

**Files**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` -- Extract mode-specific code blocks
- NEW: `backend/services/agent-runner/worker/workspace/__init__.py`
- NEW: `backend/services/agent-runner/worker/workspace/backend.py` -- `WorkspaceBackend` protocol

**What to extract**:

1. **Workspace root resolution**: The current code computes `root_dir` differently in local vs cloud mode. Extract this into a `WorkspaceBackend.get_root_dir()` method.

2. **Skill writing**: The `is_local_mode()` branch for writing skills to filesystem vs Daytona sandbox. Extract into `WorkspaceBackend.write_file()`.

3. **Attachment injection**: The `local_root` parameter threading. Extract into `WorkspaceBackend.inject_file()`.

**Key interface** (protocol, not ABC -- Pythonic):
```python
class WorkspaceBackend(Protocol):
    """Unified interface for workspace file operations.

    Abstracts over filesystem (local) and Daytona (cloud) backends.
    execute_graphton.py calls this interface instead of branching on mode.
    """
    def get_root_dir(self) -> str: ...
    async def write_file(self, rel_path: str, content: bytes) -> None: ...
    async def read_file(self, rel_path: str) -> bytes: ...
    async def file_exists(self, rel_path: str) -> bool: ...
```

**What NOT to refactor**: This is a targeted extraction, not a rewrite. Only the code paths that workspace provisioning needs to plug into. The goal is ~3-4 `is_local_mode()` checks removed, not all 8+. The remaining ones can be cleaned up after workspace provisioning lands.

**Tests**: Unit tests for `WorkspaceBackend` implementations (filesystem backend, Daytona backend stub).
- `backend/services/agent-runner/tests/workspace/test_backend.py`

**Risk**: Medium. Touches `execute_graphton.py` but only extracts existing logic behind an interface. No behavioral change.

---

### Phase 1: Proto Changes (SessionSpec + WorkspaceSource)
**Estimated effort**: 1 day
**Depends on**: Nothing (can run parallel with Phase 0)

**Files**:
- NEW: `apis/ai/stigmer/agentic/session/v1/workspace.proto` -- `WorkspaceSource`, `GitRepoSource` messages
- `apis/ai/stigmer/agentic/session/v1/spec.proto` -- Add `workspace_source` field to `SessionSpec`

**Changes**:
```protobuf
// workspace.proto
syntax = "proto3";
package ai.stigmer.agentic.session.v1;

import "google/protobuf/wrappers.proto";

// WorkspaceSource defines where the agent's workspace content comes from.
// When not set on a SessionSpec, the workspace is empty (existing default behavior).
//
// Local path workspace is handled at the runner level, not the proto level,
// because it is only valid in local deployment mode (see AD-09).
message WorkspaceSource {
  oneof source {
    GitRepoSource git_repo = 1;
  }
}

// GitRepoSource provisions a workspace by cloning a git repository.
// HTTPS-only for MVP. Authentication via GITHUB_TOKEN in merged environment.
message GitRepoSource {
  // HTTPS clone URL (required).
  // Example: "https://github.com/acme/my-app.git"
  // SSH URLs are not supported in MVP.
  string url = 1;

  // Branch to clone (optional).
  // When empty, the repository's default branch is used.
  string branch = 2;

  // Specific commit SHA to checkout after clone (optional).
  // When set, the workspace is checked out to this exact commit (detached HEAD).
  string commit = 3;

  // Shallow clone depth (optional).
  // When null/absent, defaults to depth=1 (shallow clone).
  // Set to 0 for full clone with complete history.
  // Using wrapper type to distinguish "not set" (default shallow) from "set to 0" (full clone).
  google.protobuf.Int32Value depth = 4;
}
```

```protobuf
// session/v1/spec.proto addition
import "ai/stigmer/agentic/session/v1/workspace.proto";

message SessionSpec {
  // ... existing fields 1-5 ...

  // Workspace source configuration (optional).
  // Defines where the workspace content comes from.
  // When absent, an empty workspace is created (existing behavior).
  // Provisioned on first execution; subsequent executions reuse it.
  WorkspaceSource workspace_source = 6;
}
```

**Validation rules**:
- `git_repo.url` must be HTTPS (reject SSH URLs with clear error message)
- `git_repo.url` must parse as a valid URL
- `git_repo.depth` if set, must be >= 0

**Tests**: Proto validation tests.
- Verify `WorkspaceSource` with `git_repo` passes validation
- Verify empty `WorkspaceSource` (no source set) passes validation
- Verify `git_repo` with SSH URL is rejected

**Risk**: Low (additive, backward-compatible). `WorkspaceSource` is optional.

---

### Phase 2: Workspace Provisioner Module
**Estimated effort**: 3 days (including tests)
**Depends on**: Phase 0 (WorkspaceBackend interface), Phase 1 (proto types)

**New files**:
- `backend/services/agent-runner/worker/workspace/provisioner.py`
- `backend/services/agent-runner/worker/workspace/sources/git.py`
- `backend/services/agent-runner/worker/workspace/sources/empty.py`
- `backend/services/agent-runner/tests/workspace/test_provisioner.py`
- `backend/services/agent-runner/tests/workspace/test_git_source.py`

**Key interface**:
```python
@dataclass
class ProvisionResult:
    root_dir: str
    consumed_keys: list[str]       # Keys to strip from agent env
    workspace_description: str     # For system prompt injection
    source_type: str               # "git_repo" | "empty" | "local_path"
    git_metadata: GitMetadata | None  # Repo info for output delivery

@dataclass
class GitMetadata:
    """Read-only metadata about the cloned repo.
    NO tokens or credentials. Only used for system prompt and output delivery.
    """
    repo_url: str       # Clone URL (HTTPS, no token)
    branch: str         # Branch that was cloned
    base_commit: str    # HEAD SHA at clone time

class WorkspaceProvisioner:
    async def provision(
        self,
        workspace_source: WorkspaceSource | None,
        backend: WorkspaceBackend,
        merged_env: dict[str, EnvironmentValue],
        session_id: str,
    ) -> ProvisionResult:
        """Provisions workspace. Returns root_dir and consumed credential keys.

        Logs consumed keys explicitly for debugging:
            "Key 'GITHUB_TOKEN' consumed by workspace provisioning (git clone).
             This key will not be forwarded to the agent runtime environment."
        """
```

**Git source implementation**:
- Resolve `GITHUB_TOKEN` from merged environment
- Inject into clone URL: `https://x-access-token:{token}@github.com/...`
- Determine depth: if `depth` wrapper is null, use depth=1; if `depth.value == 0`, full clone; otherwise use `depth.value`
- Clone into workspace root via `WorkspaceBackend`
- Log: `"Key 'GITHUB_TOKEN' consumed by workspace provisioning (git clone)"`
- Return `consumed_keys=["GITHUB_TOKEN"]`
- Return `GitMetadata` with repo URL (without token), branch, and base commit SHA
- If clone fails: raise `WorkspaceProvisionError` with clear message (auth failure, network error, repo not found)

**Empty source implementation** (default, when `workspace_source` is None):
- Create session-scoped directory (existing behavior)
- Return it as `root_dir`
- Return empty consumed keys
- No `GitMetadata`

**Local path support** (runner-level, not proto-level):
- When runner config has `local_workspace_path` set (local mode only):
  - Validate path exists and is a directory
  - Return the path directly as `root_dir` (no copy)
  - Return empty consumed keys
- When runner is in cloud mode and `local_workspace_path` is set: raise `ConfigurationError`

**Tests**:
- Git clone with PAT token (mocked git subprocess)
- Git clone without auth (public repo)
- Git clone with depth wrapper null (defaults to shallow)
- Git clone with depth=0 (full clone)
- Empty workspace creation
- Credential stripping: `GITHUB_TOKEN` in consumed_keys
- Clone failure handling (auth error, network error, repo not found)
- `GitMetadata` does NOT contain the token
- Local path: valid directory succeeds
- Local path: nonexistent directory fails
- Local path: cloud mode rejection

**Risk**: Medium (new code). Mitigated by clear interface contract and mocked tests.

---

### Phase 3: Integrate Provisioner into Execution Flow + Workspace State
**Estimated effort**: 3 days (including tests)
**Depends on**: Phase 0, Phase 2

**Files**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` -- Add provisioning step
- `apis/ai/stigmer/agentic/session/v1/api.proto` -- Add `workspace_state` to session status

**Workspace provisioning state on session**:
```protobuf
// In session status (or equivalent)
enum WorkspaceState {
  WORKSPACE_STATE_UNSPECIFIED = 0;  // No workspace source configured
  WORKSPACE_PENDING = 1;            // Provisioning not yet started
  WORKSPACE_PROVISIONING = 2;       // Provisioning in progress
  WORKSPACE_READY = 3;              // Successfully provisioned
  WORKSPACE_FAILED = 4;             // Provisioning failed
}
```

This prevents the second execution from running in a half-provisioned workspace if the first execution's provisioning failed or crashed.

**Execution flow change**:
```
Current:
  1. Resolve environment
  2. Create sandbox
  3. Inject skills
  4. Inject attachments
  5. Create agent
  6. Execute

New:
  1. Resolve environment -> MERGED_ENV
  2. Create sandbox (or get WorkspaceBackend)
  3. Check workspace_state on session:
     - READY -> skip provisioning, reuse workspace
     - FAILED -> re-attempt provisioning (idempotent)
     - PENDING/UNSPECIFIED -> provision
     - PROVISIONING -> wait or fail (concurrent execution guard)
  4. Provision workspace (NEW) -> ProvisionResult
  5. Update session workspace_state -> READY (or FAILED)
  6. Strip consumed keys from MERGED_ENV (NEW)
  7. Inject skills into workspace
  8. Inject input files into {session_root}/.stigmer-inputs/ (NEW path)
  9. Create agent (with workspace-aware prompt)
  10. Execute
  11. Post-execution: generate git diff artifact if git_repo workspace (NEW)
```

**Post-execution git diff artifact** (cloud output for git workspaces):
After agent execution completes, if `ProvisionResult.source_type == "git_repo"`:
1. Run `git diff` in the workspace to capture all changes
2. If there are changes, save the diff as `{execution_id}.patch`
3. Upload the patch file as an `ExecutionArtifact` alongside the regular file artifacts
4. The existing `_auto_publish_written_files` mechanism handles individual file artifacts (unchanged)

This gives cloud users two ways to consume the output:
- **Individual files**: Download URLs for each modified file (existing behavior)
- **Unified patch**: A `.patch` file they can `git apply` to their local checkout

**Input file placement**:
Input files (attachments) are injected into `{session_root}/.stigmer-inputs/` which is a sibling directory to the workspace root, NOT inside the git working tree. The system prompt includes the absolute path to this directory.

**Tests**:
- Provisioning integrates into execution flow (mocked provisioner)
- Consumed keys are stripped before agent creation
- Workspace state transitions: PENDING -> PROVISIONING -> READY
- Workspace state: FAILED triggers re-provisioning
- Workspace state: READY skips provisioning
- Git diff artifact is generated for git_repo workspaces
- Git diff artifact is NOT generated for empty workspaces
- Input files placed in `.stigmer-inputs/` sibling directory
- Backward compatibility: no `workspace_source` = empty workspace (existing behavior)

**Risk**: High (touches critical execution path). Mitigate with:
- Feature flag: `STIGMER_WORKSPACE_PROVISIONING_ENABLED=true` (default: false initially)
- When flag is off, entire provisioning step is skipped (existing behavior)
- Gradual rollout: enable for specific agents/sessions first

---

### Phase 4: Workspace Awareness in System Prompt
**Estimated effort**: 1 day (including tests)
**Depends on**: Phase 3

**Files**:
- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` -- Add workspace section builder
- `backend/services/agent-runner/worker/activities/execute_graphton.py` -- Generate and inject workspace section

**Workspace prompt sections** (examples):

For git repo source:
```
## Workspace

Your workspace has been initialized from: https://github.com/acme/my-app (branch: main, commit: a1b2c3d)
Use your file system tools (ls, read, glob, grep) to explore the codebase.
Start by listing the root directory to understand the project structure.

Changes you make will be captured as artifacts when execution completes.
```

For local path source (runner-level):
```
## Workspace

Your workspace is the user's project directory: /path/to/project
IMPORTANT: You are operating directly on the user's files. Changes are immediate and persistent.
Use git to track and verify your changes before finalizing.
```

For empty workspace (default):
```
## Workspace

Your workspace is empty. Create files and directories as needed for your task.
```

For input files (when present):
```
## Input Files

The following files were provided for this execution:
- config.yaml (at /sessions/{id}/.stigmer-inputs/config.yaml)
- data.csv (at /sessions/{id}/.stigmer-inputs/data.csv)

These are read-only reference files. Do not modify them.
```

**Tests**:
- Prompt generation for git_repo workspace includes repo URL, branch, commit
- Prompt generation for empty workspace
- Prompt generation with input files includes correct `.stigmer-inputs/` paths
- Prompt generation with no workspace source (backward-compatible)

**Risk**: Low (additive, no existing behavior changes).

---

### Phase 5: Local-Mode Input File Optimization
**Estimated effort**: 1.5 days (including tests)
**Depends on**: Phase 3

**Files**:
- `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` -- Add optional `local_path` to `Attachment`
- `backend/services/agent-runner/worker/activities/execute_graphton.py` -- In `inject_attachments`, support `local_path` (symlink/copy) alongside `storage_key`

**Change**: When running in local mode and `Attachment.local_path` is set, skip storage download and instead symlink/copy the file directly into `{session_root}/.stigmer-inputs/`.

```protobuf
message Attachment {
  string filename = 1;
  string storage_key = 2;  // Existing: required for cloud mode
  string mount_path = 3;
  string content_type = 4;
  bool extract = 5;
  // Local filesystem path for local-mode optimization (optional).
  // When set in local mode, file is symlinked/copied directly
  // instead of downloading from storage.
  // Ignored in cloud mode.
  string local_path = 6;
}
```

**Tests**:
- Local mode with `local_path` set: file symlinked (no storage download)
- Local mode with only `storage_key`: existing behavior (storage download)
- Cloud mode with `local_path` set: ignored, uses `storage_key`
- Backward compatibility: `local_path` absent = existing behavior

**Risk**: Low (optimization, not functional change).

## Phasing Strategy

| Phase | Description | Depends On | Est. Effort | Risk |
|-------|-------------|-----------|-------------|------|
| 0 | Targeted refactor: extract WorkspaceBackend interface | None | 2 days | Medium |
| 1 | Proto changes (WorkspaceSource + GitRepoSource) | None | 1 day | Low |
| 2 | Workspace provisioner module | Phase 0, 1 | 3 days | Medium |
| 3 | Integration into execution flow + workspace state + patch artifact | Phase 0, 2 | 3 days | High |
| 4 | Workspace awareness in system prompt | Phase 3 | 1 day | Low |
| 5 | Local-mode input file optimization | Phase 3 | 1.5 days | Low |

**Total estimated effort**: ~11.5 days

**Execution order**:
- Phase 0 and Phase 1 can run in parallel (proto changes + refactor are independent)
- Phase 2 depends on both Phase 0 and Phase 1
- Phase 3 depends on Phase 2
- Phase 4 and Phase 5 can run in parallel after Phase 3

```
Phase 0 ──┐
           ├── Phase 2 ── Phase 3 ──┬── Phase 4
Phase 1 ──┘                         └── Phase 5
```

## Cloud Output Delivery: Why Deferring Auto-PR Is Safe

**The concern**: When workspace source is `git_repo` in cloud mode, the agent modifies files in a Daytona sandbox. Without auto-PR, how does the user get their changes?

**The answer**: The existing `_auto_publish_written_files` mechanism handles this with zero changes. It detects modified files, uploads them to R2 storage, and returns download URLs. This mechanism doesn't care whether the workspace started empty or was cloned from git -- it sees modified files and publishes them.

**MVP enhancement**: Generate a `git diff` (or `git format-patch`) in the workspace post-execution and include it as an additional artifact. This gives the user a `.patch` file they can `git apply` cleanly to their local checkout. This is a ~20-line addition in Phase 3, not a separate feature.

**What the user gets (MVP, cloud + git_repo)**:
1. Download URLs for each modified file (existing artifact behavior)
2. A `.patch` file artifact containing the unified diff (new, trivial)
3. The execution status shows which files were modified (existing)

**Why auto-PR can be added later without breaking changes**:
- Auto-PR is a new output delivery strategy layered ON TOP of the provisioner
- It needs `GitContext` (repo URL, branch, token, base commit) -- this can be added to `ProvisionResult` at that time
- The `ProvisionResult.git_metadata` field in this MVP already carries repo URL, branch, and base commit (everything except the token)
- Adding token to a `GitContext` for auto-PR is a single-field addition to the provisioner, not a schema change
- `ExecutionArtifact.pull_request_url` can be added to the proto additively (field 9 is available)
- No existing behavior changes -- auto-PR is a NEW delivery path, not a modification of the existing one

## Backward Compatibility

- `WorkspaceSource` is optional on `SessionSpec`. When absent, existing behavior (empty workspace) is preserved.
- `Attachment.local_path` is optional. When absent, existing `storage_key` flow is used.
- No breaking changes to any existing RPC or message format.
- Feature flag (`STIGMER_WORKSPACE_PROVISIONING_ENABLED`) allows gradual rollout.
- `workspace_state` on session defaults to `UNSPECIFIED` (no provisioning, existing behavior).

## Out of Scope (Future)

### Fast-Follow: Auto-PR for Git Workspaces
- Separate project with its own ADR and phasing
- Creates branch, commits changes, pushes, opens PR
- Requires `GitContext` with token (provisioner enhancement)
- `GitRepoSource.auto_pr` field (use enum, not bool, to handle proto3 default correctly)
- `ExecutionArtifact.pull_request_url` field
- GitHub API integration for PR creation
- Permission failure fallback (patch file)
- Branch naming convention and conflict handling

### Future Enhancements
- GitHub App authentication
- SSH key authentication for git
- Vault-backed credential resolution
- `CredentialScope` enum on `EnvironmentValue`
- Workspace snapshots (save/restore workspace state)
- Shallow file tree in system prompt (optimization)
- CLI `--workspace` flag (CLI changes deferred to separate project)
- Monorepo subdirectory support (`GitRepoSource.path`)
- `LocalPathSource` in proto (if there's a use case for non-local-mode local paths)

## Notes

- The key invariant: **the agent is deployment-agnostic**. This must hold after every phase.
- Phase 3 is the highest-risk phase. The feature flag mitigates rollout risk.
- Phase 0 exists because adding workspace provisioning into an already-tangled `execute_graphton.py` (2800+ lines, 8+ mode branches) without clean interfaces would compound tech debt.
- Each phase includes its own test requirements. There is no deferred "testing phase."
- `GitMetadata` (in `ProvisionResult`) deliberately excludes the token. It carries only the information needed for system prompts and artifact labeling. The token is consumed and discarded by the provisioner after clone.
- Input files live in `{session_root}/.stigmer-inputs/` (sibling to workspace root), not inside the workspace. This prevents git pollution and directory collisions.
