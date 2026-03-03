# Task T01: Multi-Source Workspace — Phased Implementation Plan

**Created**: 2026-03-04
**Status**: PENDING REVIEW
**Type**: Feature Development (MVP, phased)

> **This plan requires your review before execution.**

## Problem Statement

Today, a session supports exactly **one** `WorkspaceSource` (a git repo OR a local path). The singular assumption is embedded across 6 architectural layers and ~33 code locations. We want sessions to support **multiple** workspace sources — multiple local directories and/or multiple git repos — treated as a single unified workspace (VS Code multi-root model).

## Architectural Decisions (confirmed by developer)

| Decision | Choice |
|----------|--------|
| Backward compatibility | **None required** — clean break, delete `workspace_source` |
| Branch/commit with multi-workspace | **Reject** `--branch`/`--commit` when >1 workspace; support only for single git workspace. Richer inline syntax deferred to future. |
| Entry naming | **Auto-derive** from repo name (last URL path segment sans `.git`) or directory basename |
| Local-path multi-workspace layout | **No symlinks for MVP** — first local path becomes `root_dir` (agent CWD); all paths listed in system prompt with absolute paths. Agent navigates between them. |
| Cloud multi-workspace layout | Git repos cloned into **named subdirectories** of workspace root: `{workspace_root}/{entry_name}/` |

## Gap Inventory (33 items across 6 layers)

### Proto Schema (Gaps 1-2)
| # | File | Gap |
|---|------|-----|
| 1 | `workspace.proto` | No multi-entry type; `WorkspaceSource` has no name/identity |
| 2 | `spec.proto` | `workspace_source` is singular field (field 6) |

### CLI (Gaps 3-12)
| # | File | Gap |
|---|------|-----|
| 3 | `run_agent_exec.go` | `WorkspaceFlag` is `string`, not `[]string` |
| 4 | `run_agent_exec.go` | `BranchFlag`/`CommitFlag` are global, not per-source |
| 5 | `run_workspace.go` | `parseWorkspaceSource()` returns single `*WorkspaceSource` |
| 6 | `run.go` | `localWorkspaceRoot()` returns single string |
| 7 | `run_create.go` | `createSessionForAgent()` accepts single `*WorkspaceSource` |
| 8 | `run_attachments.go` | `ProcessFiles()` accepts single `workspaceRoot` |
| 9 | `run_attachments.go` | `workspaceRelativePath()` checks against one root |
| 10 | `run_agent_exec.go` | `preparedAgentExec.WorkspaceSource` is singular |
| 11 | `run_agent_exec.go` | `resolvedAgentExecInput.WorkspaceSource` is singular |
| 12 | `draft_handler.go` | Draft commands pass singular workspace source |

### Backend Provisioner (Gaps 13-20)
| # | File | Gap |
|---|------|-----|
| 13 | `provisioner.py` | `provision()` accepts one `workspace_source` |
| 14 | `provisioner.py` | `_dispatch()` exits after first source match |
| 15 | `provisioner.py` | `ProvisionResult.root_dir` is singular |
| 16 | `provisioner.py` | `ProvisionResult.git_metadata` is singular |
| 17 | `sources/git.py` | Clones into `backend.root_dir` directly (not a subdirectory) |
| 18 | `sources/local_path.py` | Returns user's path as sole `root_dir` |
| 19 | `sources/git.py` | `_detect_existing_repo()` checks `.git` at workspace root only |
| 20 | `sources/git.py` | `_recover_non_empty_workspace()` wipes entire workspace root |

### Workspace Backend (Gaps 21-22)
| # | File | Gap |
|---|------|-----|
| 21 | `backend.py` | `WorkspaceBackend.root_dir` is singular |
| 22 | `local.py` / `daytona.py` | Backends initialized with single root |

### Execute Graphton Integration (Gaps 23-27)
| # | File | Gap |
|---|------|-----|
| 23 | `execute_graphton.py` | One `provision_result`, wholesale backend replacement |
| 24 | `execute_graphton.py` | `build_workspace_prompt_section()` takes single result |
| 25 | `execute_graphton.py` | `_generate_git_diff_artifact()` handles one repo |
| 26 | `provisioner.py` | `_enrich_with_file_tree()` generates one tree |
| 27 | `sources/git.py` | `_setup_git_excludes()` targets one `.git` |

### Sandbox & Infrastructure (Gaps 28-29)
| # | File | Gap |
|---|------|-----|
| 28 | `sandbox_manager.py` | Single `DAYTONA_WORKSPACE_MOUNT_PATH` (OK for MVP — subdirs under it) |
| 29 | `__init__.py` | `initialize_workspace()` creates one backend |

### Tests (Gaps 30-33)
| # | File | Gap |
|---|------|-----|
| 30 | `run_workspace_test.go` | Tests cover single-source scenarios only |
| 31 | `test_provisioner.py` | Provisioner tests are single-source |
| 32 | `test_workspace_prompt_section.py` | Prompt tests are single-source |
| 33 | `controller/create.go` | Auto-created sessions have no workspace (low impact) |

---

## Phased Delivery

### Phase 1: Proto Schema + Code Generation
**Scope**: Gaps 1, 2
**Effort**: Small
**Deliverable**: New proto types, generated Go/Python stubs

#### Changes

**`workspace.proto`** — Add `WorkspaceEntry`:
```protobuf
message WorkspaceEntry {
  string name = 1 [(buf.validate.field).string.min_len = 1];
  WorkspaceSource source = 2 [(buf.validate.field).required = true];
}
```

**`spec.proto`** — Replace singular field with repeated:
```protobuf
message SessionSpec {
  string agent_instance_id = 1;
  string subject = 2;
  string thread_id = 3;
  string sandbox_id = 4;
  map<string, string> metadata = 5;
  // Field 6 deleted (was: WorkspaceSource workspace_source)
  reserved 6;
  reserved "workspace_source";
  repeated WorkspaceEntry workspace_sources = 7;
}
```

**Post-step**: Run `buf generate` to regenerate Go and Python stubs.

#### Why `repeated WorkspaceEntry` on `SessionSpec` directly?
For MVP, we skip the `Workspace` wrapper message. A repeated field is simpler, and the session already *is* the workspace container. If we later need workspace-level metadata (e.g., a workspace name), we can wrap it then.

---

### Phase 2: CLI Multi-Workspace Support
**Scope**: Gaps 3-12
**Effort**: Medium
**Deliverable**: Users can pass `--workspace` multiple times

#### 2a. Flag + Parsing (Gaps 3, 4, 5)

| File | Change |
|------|--------|
| `run_agent_exec.go` | `WorkspaceFlag string` → `WorkspaceFlags []string` (StringArrayVar) |
| `run_agent_exec.go` | `--branch`/`--commit` kept as-is; validated at parse time |
| `run_workspace.go` | `parseWorkspaceSource()` → `parseWorkspaceEntries(workspaces []string, branch, commit string) ([]*sessionv1.WorkspaceEntry, error)` |

`parseWorkspaceEntries` logic:
1. If `len(workspaces) == 0` and branch/commit set → error
2. If `len(workspaces) > 1` and branch/commit set → error ("--branch/--commit only valid with a single git workspace")
3. For each workspace string: detect git vs local, parse, auto-derive name
4. Validate name uniqueness across entries
5. Return `[]*sessionv1.WorkspaceEntry`

Auto-derive name:
- Git URL `https://github.com/acme/my-app.git` → `my-app`
- Local path `/Users/dev/my-project` → `my-project`
- Local path `.` → basename of resolved absolute path

#### 2b. Plumbing structs (Gaps 10, 11, 12)

| Struct | Change |
|--------|--------|
| `preparedAgentExec` | `WorkspaceSource *sessionv1.WorkspaceSource` → `WorkspaceEntries []*sessionv1.WorkspaceEntry` |
| `resolvedAgentExecInput` | Same change |
| Draft handler | Pass-through (already delegates to `prepareAgentExec`) |

#### 2c. Session creation (Gap 7)

| File | Change |
|------|--------|
| `run_create.go` | `createSessionForAgent(instanceID, orgID string, entries []*sessionv1.WorkspaceEntry, conn)` — set `SessionSpec.WorkspaceSources = entries` |

#### 2d. Local workspace root + attachments (Gaps 6, 8, 9)

| File | Change |
|------|--------|
| `run.go` | `localWorkspaceRoot()` → `localWorkspaceRoots(entries []*sessionv1.WorkspaceEntry) []string` — returns all local-path entries |
| `run_attachments.go` | `ProcessFiles(paths, workspaceRoot string)` → `ProcessFiles(paths, workspaceRoots []string)` |
| `run_attachments.go` | Containment check iterates over all roots, uses the first match |

---

### Phase 3: Backend Provisioner — Multiple Local Paths
**Scope**: Gaps 13-15, 18, 23-24, 29
**Effort**: Medium
**Deliverable**: Multiple local-path workspaces provisioned and described in system prompt

#### 3a. Provisioner iteration (Gaps 13, 14)

| File | Change |
|------|--------|
| `provisioner.py` | New `provision_all(entries, backend, merged_env, is_local_mode) -> list[EntryProvisionResult]` |
| `provisioner.py` | Iterates `entries`, dispatches each, collects results |

New domain type:
```python
@dataclass(frozen=True)
class EntryProvisionResult:
    entry_name: str
    root_dir: str
    source_type: SourceType
    consumed_keys: tuple[str, ...]
    workspace_description: str
    file_tree: str | None = None
    git_metadata: GitMetadata | None = None
```

#### 3b. Local-path source (Gap 18)

No change to `sources/local_path.py` — it already returns the user's path. The provisioner wraps the result with `entry_name`.

#### 3c. ProvisionResult composition (Gap 15)

The provisioner returns a **list** of `EntryProvisionResult`. Callers compose as needed. A helper `composite_root_dir(results)` returns the first entry's root_dir (for CWD) or the common parent.

For local-mode multi-workspace:
- `root_dir` = first entry's path (agent's CWD)
- All entry paths listed in system prompt

#### 3d. Execute Graphton integration (Gaps 23, 29)

| File | Change |
|------|--------|
| `execute_graphton.py` | Read `session.spec.workspace_sources` (repeated), call `provision_all()` |
| `execute_graphton.py` | Backend replacement: use first entry's `root_dir` for local mode |
| `__init__.py` | `initialize_workspace()` unchanged (still creates one backend); provisioner sets the effective root |

#### 3e. System prompt (Gap 24)

| File | Change |
|------|--------|
| `execute_graphton.py` | `build_workspace_prompt_section(results: list[EntryProvisionResult])` — generates multi-entry description |

Example prompt output:
```
## Workspace

This is a multi-root workspace with 2 entries:

### frontend
Your workspace entry at: /Users/dev/frontend
IMPORTANT: You are operating directly on the user's files.

### backend  
Your workspace entry at: /Users/dev/backend
IMPORTANT: You are operating directly on the user's files.
```

---

### Phase 4: Backend Provisioner — Multiple Git Repos (Cloud Mode)
**Scope**: Gaps 17, 19, 20, 25-27
**Effort**: Medium
**Deliverable**: Multiple git repos cloned into named subdirectories

#### 4a. Git source subdirectory cloning (Gaps 17, 19, 20)

| File | Change |
|------|--------|
| `sources/git.py` | `provision()` accepts an optional `target_subdir` parameter |
| `sources/git.py` | When `target_subdir` set: clone into `{backend.root_dir}/{target_subdir}/` |
| `sources/git.py` | `_detect_existing_repo()` checks `.git` in subdirectory |
| `sources/git.py` | `_recover_non_empty_workspace()` only cleans the subdirectory |

The provisioner passes `entry.name` as `target_subdir` when there are multiple entries. For a single entry, `target_subdir` can be omitted (clone into root, preserving current behavior for simplicity).

#### 4b. Git diff artifacts (Gap 25)

| File | Change |
|------|--------|
| `execute_graphton.py` | `_generate_git_diff_artifact()` iterates over `EntryProvisionResult` list, generates one diff per git entry |

#### 4c. File tree + git excludes (Gaps 26, 27)

| File | Change |
|------|--------|
| `provisioner.py` | `_enrich_with_file_tree()` called per entry |
| `sources/git.py` | `_setup_git_excludes()` operates on scoped subdirectory |

---

### Phase 5: Tests + Polish
**Scope**: Gaps 30-33
**Effort**: Small-Medium

| Area | What |
|------|------|
| CLI tests | `run_workspace_test.go`: multi-workspace parsing, name derivation, branch/commit rejection |
| Provisioner tests | `test_provisioner.py`: multi-entry dispatch, local and git |
| Prompt tests | `test_workspace_prompt_section.py`: multi-entry output |
| Integration | End-to-end test with `--workspace ./a --workspace ./b` |

---

## Phase Dependency Graph

```
Phase 1 (Proto)
    │
    ▼
Phase 2 (CLI)
    │
    ▼
Phase 3 (Backend: local paths)  ← MVP milestone — delivers core value
    │
    ▼
Phase 4 (Backend: git repos)
    │
    ▼
Phase 5 (Tests + polish)
```

**MVP milestone**: After Phase 3, the user can run:
```bash
stigmer run agent code-reviewer --workspace ./frontend --workspace ./backend -m "Review both"
```

---

## Files Touched (Summary)

| Layer | Files | Phase |
|-------|-------|-------|
| Proto | `workspace.proto`, `spec.proto` | 1 |
| Generated | `workspace.pb.go`, `spec.pb.go`, `*_pb2.py` (auto) | 1 |
| CLI | `run_workspace.go`, `run_workspace_test.go` | 2 |
| CLI | `run_agent_exec.go` (flags + structs) | 2 |
| CLI | `run.go` (`localWorkspaceRoots`) | 2 |
| CLI | `run_create.go` (session creation) | 2 |
| CLI | `run_attachments.go` (multi-root containment) | 2 |
| CLI | `draft_handler.go` (pass-through) | 2 |
| Backend | `provisioner.py` (new `provision_all`, `EntryProvisionResult`) | 3 |
| Backend | `execute_graphton.py` (multi-result wiring, prompt) | 3 |
| Backend | `sources/git.py` (subdirectory cloning) | 4 |
| Backend | `sources/git.py` (idempotency for subdirs) | 4 |
| Tests | `run_workspace_test.go` | 5 |
| Tests | `test_provisioner.py`, `test_workspace_prompt_section.py` | 5 |

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| `WorkspaceBackend.root_dir` is singular | For MVP, we keep the backend's root as the first entry's path (local) or the sandbox root (cloud). No protocol change needed. |
| Git idempotency breaks | Scope `.git` detection to entry subdirectory, not workspace root |
| Mixed local+git in same session | Defer to Phase 4; Phase 3 only handles all-local workspaces |
| Agent confusion with multi-root | Clear system prompt section naming each entry with its path |

## Out of Scope (deferred)

- Inline branch syntax (`--workspace "url#branch=main"`)
- `Workspace` wrapper message with workspace-level metadata
- Symlink-based unified workspace root
- Workspace entry removal/modification after session creation
- TUI workspace picker
- Project-level workspace configuration (stigmer.yaml)
