---
name: Phase 5 tests polish
overview: Phase 5 (Tests + Polish) for multi-source workspace. The original gaps 30-33 are largely addressed by unit tests written during Phases 2-4 (35+ multi-entry unit tests, 7 multi-entry prompt tests, 8 git-diff artifact tests). What remains is integration-level composition tests, guard-rail tests for documented MVP limitations, Daytona cwd conformance verification, and targeted code polish.
todos:
  - id: integration-tests
    content: "Work Item 1: Create integration tests for provision_all -> file tree enrichment -> prompt generation pipeline using real LocalWorkspaceBackend with temp directories"
    status: completed
  - id: guard-rail-tests
    content: "Work Item 2: Add guard-rail tests for MVP limitations (mixed local+git, backend replacement guard, referenced-files primary root)"
    status: completed
  - id: daytona-cwd
    content: "Work Item 3: Extend test_daytona_backend.py with cwd conformance tests verifying subdirectory scoping"
    status: completed
  - id: heading-polish
    content: "Work Item 4 (pending approval): Refactor tree builder to accept heading_level parameter, removing fragile string replace in _build_multi_workspace_section"
    status: completed
isProject: false
---

# Phase 5: Tests + Polish for Multi-Source Workspace

## Current State Assessment

Phases 1-4 delivered 35+ multi-entry unit tests across 4 test files. All 292 backend tests pass. The original gap inventory (30-33) was proactively addressed during implementation:

- **Gap 30 (CLI tests)** -- Covered in Phase 2: `run_workspace_test.go` has multi-entry parsing, name derivation, branch/commit validation, duplicate name tests
- **Gap 31 (Provisioner tests)** -- Covered in Phases 3-4: 11 multi-entry tests in `test_provisioner.py`, 12 subdirectory tests in `test_git_source.py`, 4 cwd-scoping tests in `test_tree.py`, 8 tests in `test_git_diff_artifact.py`
- **Gap 32 (Prompt tests)** -- Covered in Phase 3: 7 multi-entry tests in `TestMultiEntryWorkspacePromptSection`
- **Gap 33 (Controller auto-sessions)** -- Low impact, no action needed

**What remains** is the integration layer, edge case guard-rails, and Daytona conformance -- as identified in the Session 4 checkpoint's open questions.

---

## Work Item 1: Integration tests -- Provisioning-to-Prompt Pipeline

**Goal**: Test the *composed* pipeline where multiple production modules interact, without mocking intermediate layers. Unit tests mock heavily (e.g. `_MockGitRepoSource`, `_MockWorkspaceBackend`); integration tests use real backends with real temp directories.

**New file**: `backend/services/agent-runner/tests/workspace/test_multi_workspace_integration.py`

**Pattern**: Follow [test_platform_mount_integration.py](backend/services/agent-runner/tests/workspace/test_platform_mount_integration.py) which already uses real backends with temp directories.

**Test scenarios** (each exercises `provision_all()` -> file tree enrichment -> `build_workspace_prompt_section()`):


| Scenario                                  | Entries                                               | Validation                                                                                    |
| ----------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Two local-path entries                    | `./frontend`, `./backend` (temp dirs with real files) | Both descriptions in prompt, both file trees present, `### frontend` / `### backend` headings |
| Single local-path entry (backward compat) | `./my-project`                                        | Identical to legacy single-workspace format -- no preamble, no `###` sub-heading              |
| Two git entries (mocked clone)            | Two git URL entries                                   | Both cloned into subdirs, both trees scoped, `{execution_id}-{name}.patch` naming             |
| Single git entry (backward compat)        | One git URL entry                                     | Cloned into root (not subdir), legacy prompt format                                           |


**Key assertions**:

- File tree for each entry reflects only that entry's files, not siblings
- Prompt section heading hierarchy: `## Workspace` -> `### entry-name` -> `#### Project Structure`
- Single-entry output is byte-identical to the legacy format (regression guard)
- `ProvisionResult.entry_name` is populated for every result

**Fixtures**: Create a shared `conftest.py` in `tests/workspace/` ONLY if it reduces meaningful duplication across the new integration tests and existing tests. If the helpers are specific to integration tests, keep them local to the test file.

---

## Work Item 2: Guard-Rail Tests for MVP Limitations

**Goal**: Document intentional boundaries with tests. These tests codify the "this is by design for MVP" behavior so future developers don't accidentally change it without understanding the implications.

### 2a. Mixed local + git entries -- `local_path` ignores `target_subdir`

**File**: Extend `test_provisioner.py` or add to integration file

When `provision_all()` receives 2+ entries where one is `local_path` and one is `git_repo`:

- `use_subdirs = True` (len > 1)
- Git entry: `target_subdir = name` -- clones into `{root}/{name}/`
- Local entry: `target_subdir` is passed to `provision()` but `_dispatch()` does NOT forward it to `local_path_source.provision()` -- local entry's `root_dir` is the user's original absolute path

**Test**: Verify that in a mixed session, the local entry's `root_dir` remains the user's original path (not a subdirectory of workspace root). This documents that the local entry is "outside" the workspace root tree.

### 2b. Backend replacement guard -- multi-entry keeps workspace root

**File**: Extend integration tests

Verify that when `len(provision_results) > 1`, the `workspace_backend` is NOT replaced even when the primary entry's `root_dir` differs from `workspace_backend.root_dir`. This is Decision D2 from Phase 4.

### 2c. `build_referenced_files_prompt_section` uses primary root

**File**: Extend `test_workspace_prompt_section.py`

Verify that `build_referenced_files_prompt_section(refs, workspace_root=primary.root_dir)` uses only the first entry's root for path resolution. Document this as a known limitation (multi-root file referencing is future work).

---

## Work Item 3: Daytona `cwd` Conformance Test

**Goal**: Address the open question from Session 4: "Does `DaytonaWorkspaceBackend.execute(cmd, cwd=subdir)` correctly scope to the subdirectory?"

**File**: Extend [test_daytona_backend.py](backend/services/agent-runner/tests/workspace/test_daytona_backend.py)

From reading the production code, `DaytonaWorkspaceBackend.execute(cmd, cwd=subdir)` does:

```python
abs_cwd = self._abs(cwd)  # -> "{workspace_root}/{cwd.lstrip('/')}"
full_cmd = f"cd {abs_cwd} && {command}"
```

**Tests to add**:

- `test_execute_with_cwd_scopes_to_subdirectory` -- `execute("ls", cwd="my-repo")` produces `cd /workspace/my-repo && ls`
- `test_execute_without_cwd_uses_root` -- `execute("ls")` produces `cd /workspace && ls`
- `test_execute_cwd_strips_leading_slash` -- `execute("ls", cwd="/my-repo")` produces same as `cwd="my-repo"` (the `lstrip` behavior)

This verifies the contract established in [backend.py](backend/services/agent-runner/worker/workspace/backend.py) lines 139-157 where `cwd` is documented as "relative to `root_dir`."

---

## Work Item 4: Polish -- Fragile Heading Replace Pattern

**Goal**: The `_build_multi_workspace_section` in [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) does a string replace:

```python
tree = result.file_tree.replace("### Project Structure", "#### Project Structure", 1)
```

This was flagged in Session 3 as fragile (substring `"### Project Structure"` is a match for `"#### Project Structure"` too). The current code uses `replace(..., 1)` to limit to the first occurrence, but this relies on `### Project Structure` appearing before any `#### Project Structure` in the tree string.

**Assessment**: The tree builder in [tree.py](backend/services/agent-runner/worker/workspace/tree.py) always produces exactly `### Project Structure` as the heading. The replace is safe in practice. However, a cleaner approach would be to have the tree builder accept a heading level parameter, avoiding post-hoc string surgery.

**Recommendation**: Flag this for discussion. If you agree it is worth addressing, the change is small:

- `_format_workspace_tree(lines, total, max_entries, heading_level=3)` in `tree.py`
- Caller passes `heading_level=4` for multi-entry context
- Remove the string replace in `_build_multi_workspace_section`

This is a minor polish item and I want your input on whether it is worth the churn.

---

## Out of Scope

- **stigmer-cloud stub regeneration**: The mobile/Java stubs in stigmer-cloud still reference `workspace_source` (singular). Regenerating stubs is a release concern, not a testing concern. Should be done before the feature ships to production.
- **E2E tests requiring infrastructure**: Real Daytona sandbox tests, real git clone tests -- these require CI/CD infrastructure beyond unit/integration scope.
- **Mixed local+git behavior "fix"**: This is an intentional MVP limitation. We document it with guard-rail tests, not fix it.

---

## Question for You

**On Work Item 4 (heading replace polish)**: The string replace pattern works correctly today. Refactoring the tree builder to accept a heading level is cleaner but touches two files (`tree.py` and `execute_graphton.py`) and their tests. Is this worth doing now, or should we defer it?