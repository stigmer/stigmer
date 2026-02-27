# Task T01: Platform-File Isolation — Virtual Platform Mount

**Created**: 2026-02-28
**Revised**: 2026-02-28 (v3 — virtual mount, zero pollution)
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260227.02.workspace-provisioning (Phase 4)

**This plan requires your review before execution.**

## Objective

Physically isolate all platform files (`bin/skills/`, `.stigmer-inputs/`) outside the workspace root. The backend's tool layer presents them under a virtual `.stigmer/` prefix — the agent sees them as if they're in the workspace, but they physically live in an external platform directory. **Zero modifications to the user's project directory** for any workspace source type.

## Parent Context

Spawned from **20260227.02.workspace-provisioning** task T04. Phases 0–3 are complete (workspace backend, proto changes, provisioner module, integration wire-up). This is the next critical phase.

## Research Summary

Deep research was conducted via ChatGPT Deep Research (see `research.session-root-filesystem-isolation/`). Key findings that shaped this design:

1. **Cursor, Windsurf, and similar tools act as a view layer** — the agent accesses files through tool calls, not the raw filesystem. The IDE/tool layer can serve content from any location transparently. These tools never inject runtime files into the workspace.
2. **Codespaces / Gitpod use the container as the view layer** — bind mounts compose user repo + platform files. Host filesystem unchanged.
3. **`normpath` containment is unsafe** — pure string manipulation; agent-created symlinks bypass it. Rejected.
4. **Symlinks in user's project are still pollution** — even a single managed symlink modifies the user's directory and requires `.git/info/exclude` manipulation.

**Core insight**: We already have a view layer — `WorkspaceBackend` (pre-agent) and `FilesystemBackend` / `DaytonaBackend` (agent-runtime). The backend's `read()`, `write()`, `list_files()` are tool calls that go through path resolution. We can route `.stigmer/*` paths to a separate physical directory without touching the workspace filesystem.

## Architectural Decision: Virtual Platform Mount

### The Principle

**Workspace and platform are separate concerns. They must never share a directory.**

- The workspace is the user's code — it belongs to the user
- Platform files (skills, inputs) are operational runtime state — they belong to the platform
- The backend's tool layer composes them into a unified view for the agent
- The user's directory is never modified, regardless of source type

### Physical Layout

**All source types:**
```
platform_dir/                            external, managed by platform
├── skills/
│   └── skill-a/
│       ├── SKILL.md
│       └── scripts/run.sh
└── inputs/
    └── requirements.pdf

workspace root_dir/                      user's code (NEVER modified by platform)
├── src/
├── README.md
└── ...
```

Where `platform_dir` lives depends on context:
- **Local mode (all source types)**: `~/.stigmer/sessions/{session_id}/platform/`
- **Cloud mode (Daytona)**: `/home/daytona/.stigmer/` (sibling to workspace, inside sandbox)

Where `root_dir` is depends on source type:
- **git_repo**: `session_root/workspace/` (managed clone directory)
- **local_path**: User's actual project directory (e.g., `/Users/dev/my-project/`)
- **empty**: `session_root/workspace/` (managed temp directory)
- **Cloud (Daytona)**: `/home/daytona/workspace/`

### Agent's Virtual View

The agent sees a unified namespace through the tool layer:

```
.                                        agent's root (project)
├── .stigmer/                            VIRTUAL — routed to platform_dir
│   ├── skills/
│   │   └── skill-a/
│   │       ├── SKILL.md
│   │       └── scripts/run.sh
│   └── inputs/
│       └── requirements.pdf
├── src/                                 REAL — resolved within root_dir
├── README.md
└── ...
```

The agent calls `read(".stigmer/skills/skill-a/SKILL.md")` and gets the content. It calls `read("src/main.py")` and gets project code. From the agent's perspective, both are "in the workspace." Physically, they're in different directories.

### Path Resolution: Virtual Mount Rule

Both `WorkspaceBackend` and agent-runtime backends gain a virtual mount rule:

```python
PLATFORM_PREFIX = ".stigmer/"

def _resolve(self, rel_path: str) -> Path:
    clean = rel_path.lstrip("/")

    # Virtual platform mount: .stigmer/* → platform_dir/*
    if self._platform_dir and (
        clean.startswith(PLATFORM_PREFIX) or clean == ".stigmer"
    ):
        platform_rel = clean[len(PLATFORM_PREFIX):] if clean.startswith(PLATFORM_PREFIX) else ""
        resolved = (self._platform_dir / platform_rel).resolve()
        if not str(resolved).startswith(str(self._platform_dir)):
            raise ValueError(f"Path escapes platform root: {rel_path}")
        return resolved

    # Workspace resolution (unchanged from current behavior)
    resolved = (self._root / clean).resolve()
    if not str(resolved).startswith(str(self._root)):
        raise ValueError(f"Path escapes workspace root: {rel_path}")
    return resolved
```

**Security properties:**
- Workspace paths: `resolve()` follows symlinks, checks containment within `root_dir` — unchanged, fully secure
- Platform paths: `resolve()` follows symlinks, checks containment within `platform_dir` — same security model, separate scope
- No relaxation of the traversal guard — no allowlists, no `normpath`, no symlinks
- Agent-created escape symlinks in workspace: `resolve()` catches them (existing behavior)
- Agent writes to `.stigmer/`: goes to `platform_dir` (no modification to user's directory)

### Shell Access: `$STIGMER_PLATFORM_DIR` Environment Variable

The virtual mount works for tool-based access (`read`, `write`, `list_files`). Shell commands (`execute()`) run on the real filesystem and can't see the virtual mount. This is handled via an environment variable:

```python
def execute(self, command: str, *, cwd=None, timeout=30) -> ExecuteResult:
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    if self._platform_dir:
        env["STIGMER_PLATFORM_DIR"] = str(self._platform_dir)
    # ... run command with this env
```

- **Skill activation** (reading SKILL.md): agent uses `read()` tool → virtual mount → works
- **Skill scripts**: agent uses `bash $STIGMER_PLATFORM_DIR/skills/skill-a/scripts/run.sh` → works
- **Input files**: agent uses `read()` tool → virtual mount → works
- **System prompt** tells agent: "Platform files are accessible via the `read` tool at `.stigmer/`. For shell execution of skill scripts, use `$STIGMER_PLATFORM_DIR`."

### Why Each Previous Alternative Was Rejected

| Option | Name | Fatal Flaw |
|--------|------|-----------|
| A | Session-root container | Agent can't reach platform files (`../` blocked by traversal guard) |
| B | Expanded backend scope | CWD vs root_dir mismatch — agent must prefix all paths with `workspace/` |
| C-v1 | Symlink + normpath | `normpath` is string-only — agent-created symlinks escape root |
| C-v2 | Symlink + allowlisted roots | Still modifies user's project directory (symlink + `.git/info/exclude`) |
| D | Dual-scope backend | Over-engineered protocol change — but the virtual mount concept is the lightweight version of this idea |
| E | Virtual filesystem overlay (FUSE) | Heavy dependency, macOS impractical |
| **F** | **Virtual platform mount** | **Selected** — zero pollution, simple path routing, uses existing tool layer as view |

## Implementation Sub-Tasks

### Sub-task 1.1: Virtual Mount in WorkspaceBackend Protocol

**Files**: `worker/workspace/backend.py`

**Change**:
- Add `platform_dir` property to `WorkspaceBackend` protocol (optional, defaults to `None`)
- Document the `.stigmer/` virtual mount convention

### Sub-task 1.2: Virtual Mount in LocalWorkspaceBackend

**Files**: `worker/workspace/local.py`

**Change**:
- `__init__()` accepts optional `platform_dir: str | Path` parameter
- `_resolve()` gains the virtual mount rule: `.stigmer/*` paths resolve against `platform_dir`; all other paths resolve against `root_dir` (unchanged)
- `execute()` injects `STIGMER_PLATFORM_DIR` env var when `platform_dir` is set
- Both platform and workspace scopes use `Path.resolve()` with containment checks (no security relaxation)
- `list_files()` for root path (`.`) merges real workspace listing with virtual `.stigmer` entry when `platform_dir` is set

**Tests**:
- `read(".stigmer/skills/skill-a/SKILL.md")` → reads from platform_dir ✓
- `read("src/main.py")` → reads from root_dir ✓
- `write(".stigmer/skills/new/SKILL.md", ...)` → writes to platform_dir ✓
- `read(".stigmer/../../etc/passwd")` → blocked by platform containment ✓
- `read("../../etc/passwd")` → blocked by workspace containment ✓
- Agent-created symlink in workspace → caught by resolve() ✓
- `list_files(".")` includes `.stigmer` entry when platform_dir set ✓
- `list_files(".stigmer/skills/")` lists from platform_dir ✓
- `execute("echo $STIGMER_PLATFORM_DIR")` → returns platform_dir path ✓
- No platform_dir set → existing behavior unchanged (backward compatible) ✓

### Sub-task 1.3: Virtual Mount in DaytonaWorkspaceBackend

**Files**: `worker/workspace/daytona.py`

**Change**:
- `__init__()` accepts optional `platform_dir: str` parameter
- `_abs()` gains the same virtual mount rule for `.stigmer/*` paths
- `execute()` injects `STIGMER_PLATFORM_DIR` env var into sandbox commands

### Sub-task 1.4: Virtual Mount in Agent-Runtime FilesystemBackend

**Files**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`

**Change**:
- `__init__()` accepts optional `platform_dir: str | Path` parameter
- `_resolve_sandbox_path()` gains the virtual mount rule
- `execute()` injects `STIGMER_PLATFORM_DIR` env var
- `list_files()` merges virtual `.stigmer` entry at root level

### Sub-task 1.5: Virtual Mount in WorkspaceNormalizingBackend (Daytona Agent Runtime)

**Files**: `backend/libs/python/graphton/src/graphton/core/backends/daytona.py`

**Change**:
- `WorkspaceNormalizingBackend.__init__()` accepts optional `platform_dir`
- `_normalize()` routes `.stigmer/*` paths appropriately for the Daytona inner backend
- Or: verify that the inner DaytonaBackend handles it transparently if `.stigmer/` is a physical directory in the sandbox (cloud mode can use a real sibling directory since the sandbox is managed)

### Sub-task 1.6: Platform Directory Creation in initialize_workspace()

**Files**: `worker/workspace/__init__.py`

**Change**:
- Local mode: create `~/.stigmer/sessions/{session_id}/platform/` as the platform directory
- Cloud mode: create `.stigmer/` sibling to workspace inside the sandbox
- Pass `platform_dir` to the backend constructors
- Return `platform_dir` as part of the result so callers can pass it to agent runtime config
- `initialize_workspace()` return type gains a `platform_dir: str | None` field

### Sub-task 1.7: Provisioner Updates

**Files**: `worker/workspace/provisioner.py`, `worker/workspace/sources/git.py`, `worker/workspace/sources/local_path.py`, `worker/workspace/sources/empty.py`

**Change**:
- `ProvisionResult` gains `platform_dir: str | None` field
- Source handlers receive platform_dir context and set it on the result
- `git.py`: no longer needs `.git/info/exclude` entries for platform files (they're not in the workspace)
- `local_path.py`: no symlink creation, no `.git/info/exclude` manipulation — just validates path and returns
- `empty.py`: no change needed

### Sub-task 1.8: SkillWriter Path Change

**Files**: `worker/activities/graphton/skill_writer.py`

**Change**:
- `_SKILLS_RELATIVE_BASE` from `bin/skills` to `.stigmer/skills`
- `SKILLS_BASE_DIR` from `/bin/skills` to `/.stigmer/skills`
- Update `generate_prompt_section()`: paths reference `.stigmer/skills/`, add note about `$STIGMER_PLATFORM_DIR` for shell script execution
- SkillWriter continues to write through `WorkspaceBackend` — the virtual mount transparently routes writes to `platform_dir`

**Tests**: Update existing SkillWriter tests for new paths.

### Sub-task 1.9: inject_attachments Path Change

**Files**: `worker/activities/execute_graphton.py`

**Change**:
- Default `mount_path` from `.stigmer-inputs/{filename}` to `.stigmer/inputs/{filename}`
- Update system prompt text: "Input files are accessible via `read .stigmer/inputs/{filename}`"
- Writes go through backend → virtual mount → platform_dir

**Tests**: Update existing attachment injection tests.

### Sub-task 1.10: Git Diff Artifact Cleanup

**Files**: `worker/activities/execute_graphton.py` (`_generate_git_diff_artifact()`)

**Change**: Remove pathspec exclusions for `.stigmer-inputs` and `bin/skills`. Platform files don't exist in the workspace tree at all — no exclusions needed.

### Sub-task 1.11: Agent Runtime Backend Wiring

**Files**: `worker/activities/execute_graphton.py`

**Change**: Pass `platform_dir` from `initialize_workspace()` / `ProvisionResult` through to the agent runtime backend:
- Local mode: `FilesystemBackend(root_dir=..., platform_dir=...)` in sandbox_config
- Cloud mode: `WorkspaceNormalizingBackend` receives platform_dir; or Daytona sandbox has physical `.stigmer/` directory

### Sub-task 1.12: Integration Tests

**Scope**: End-to-end tests covering:
- Platform directory created correctly for each source type
- Skills written to `.stigmer/skills/` via backend → physically land in platform_dir
- Inputs written to `.stigmer/inputs/` via backend → physically land in platform_dir
- Agent-runtime `read(".stigmer/skills/...")` returns correct content
- `list_files(".")` at workspace root includes virtual `.stigmer` entry
- `list_files(".stigmer/skills/")` lists skills from platform_dir
- `execute("echo $STIGMER_PLATFORM_DIR")` returns platform_dir path
- Traversal guard blocks escapes from both scopes
- Agent-created escape symlinks in workspace → still caught by resolve()
- Git diff artifact produces clean output (no platform file noise)
- **local_path workspace has ZERO modifications** — verify with `git status` and directory listing
- No platform_dir configured → existing behavior unchanged (backward compatible)

## Dependency Graph

```
1.1 (protocol) ──→ 1.2 (local backend) ──┐
                    1.3 (daytona backend) ─┤
                    1.4 (filesystem backend)┤
                    1.5 (normalizing backend)┤
                                            ↓
                    1.6 (initialize_workspace) ──→ 1.7 (provisioner)
                                                        │
1.8 (skill paths) ───────────────────────────────────→  │
1.9 (input paths) ───────────────────────────────────→  │
1.10 (git diff cleanup) ─────────────────────────────→ 1.11 (agent wiring)
                                                              │
                                                              ↓
                                                        1.12 (integration tests)
```

- 1.1 is the protocol foundation; 1.2–1.5 implement it in each backend (can be parallel)
- 1.6 depends on at least 1.2 (local backend) being done
- 1.7 depends on 1.6
- 1.8, 1.9, 1.10 are independent of each other and can run in parallel
- 1.11 wires everything together
- 1.12 validates the full stack

## Success Criteria

1. `ls` inside a `local_path` workspace shows **zero** platform artifacts — no `.stigmer`, no `bin/skills/`, no `.stigmer-inputs/`
2. `git status` inside a `local_path` workspace shows **zero** untracked platform files
3. Agent can `read(".stigmer/skills/skill-a/SKILL.md")` and receives correct content
4. Agent can `list_files(".stigmer/skills/")` and sees skill directories
5. Agent can `execute("ls $STIGMER_PLATFORM_DIR/skills/")` and sees skills
6. Agent-created escape symlinks in workspace are blocked by `resolve()` containment
7. Platform file writes via backend physically land in `platform_dir`, not in workspace
8. Git diff artifact contains no platform file noise
9. All existing tests pass (no regressions)
10. Feature flag `STIGMER_WORKSPACE_PROVISIONING_ENABLED` gates the new behavior
11. Backends without `platform_dir` behave identically to before (backward compatible)

## Out of Scope

- Workspace awareness in system prompt (parent Phase 5)
- Local-mode input file optimization / `Attachment.local_path` (parent Phase 6)
- Proto changes for `SessionStatus` / `workspace_state`
- Bind mount optimization for Daytona (future enhancement — symlink or physical dir in sandbox works for v1)

## Review Process

1. **You review this plan** — consider the approach, sub-tasks, and dependencies
2. **Provide feedback** — any concerns, changes, or questions
3. **I'll revise** → `T01_1_review.md` (feedback) → `T01_2_revised_plan.md`
4. **You approve** → execution begins, tracked in `T01_3_execution.md`
