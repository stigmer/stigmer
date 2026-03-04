---
name: T04 Multi-Workspace Prompt
overview: Rewrite the multi-workspace system prompt section so agents know their CWD, understand path resolution rules, and see context-appropriate per-entry descriptions instead of generic "Your workspace is..." phrasing.
todos:
  - id: arch-decision
    content: Get approval on prompt-builder-only approach (no source provisioner changes)
    status: completed
  - id: format-entry-desc
    content: Add _format_entry_description() helper in execute_graphton.py
    status: completed
  - id: rewrite-multi-section
    content: Rewrite _build_multi_workspace_section() with container_root param, CWD, path resolution rules
    status: completed
  - id: update-public-api
    content: Update build_workspace_prompt_section() signature and call site
    status: completed
  - id: update-tests
    content: Update 7 existing multi-entry tests + add ~8 new tests
    status: completed
  - id: run-tests
    content: Run full agent-runner test suite and verify no regressions
    status: completed
isProject: false
---

# T04: Improve Multi-Workspace System Prompt

## Architectural Decision: Prompt-Builder-Only vs Source-Provisioner Changes

The original plan (in [tasks/T01_0_plan.md](backend/services/agent-runner/worker/workspace/provisioner.py)) calls for modifying three files:

- `execute_graphton.py` -- rewrite `_build_multi_workspace_section()`
- `local_path.py` -- make `workspace_description` multi-workspace-aware
- `git.py` -- same adaptation

**I recommend changing ONLY `execute_graphton.py` (and tests), NOT the source provisioners.** Here is why:

1. `**ProvisionResult` already carries all the structured data needed**: `source_type`, `root_dir`, `entry_name`, `git_metadata`. The multi-workspace section builder can generate appropriate descriptions from these fields directly.
2. **Separation of concerns**: Source provisioners (`local_path.py`, `git.py`) are the data/provisioning layer. How descriptions render in a multi-workspace system prompt is a presentation concern that belongs in the prompt builder.
3. **No parameter threading**: The source-provisioner approach would require adding `is_multi_entry` or `entry_name` parameters through `provision_all()` -> `provision()` -> `_dispatch()` -> each source's `provision()` -- four layers of plumbing for a display string.
4. **Backward compatibility is free**: `workspace_description` continues to be used by `_build_single_workspace_section()` for single-workspace mode. No regression risk.
5. **Safe fallback**: If a new source type is added, `_format_entry_description()` falls back to using the source's own `workspace_description`. No breakage.

**The trade-off**: The prompt builder gains source-type-specific knowledge. But `SourceType` is already an explicit discriminator on `ProvisionResult` -- pattern-matching on it in the view layer is idiomatic.

---

## Files Changed

Only **two files** are modified:

- [backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) -- production code
- [backend/services/agent-runner/tests/test_workspace_prompt_section.py](backend/services/agent-runner/tests/test_workspace_prompt_section.py) -- tests

Source provisioners are **NOT changed**:

- `local_path.py` -- unchanged
- `git.py` -- unchanged
- `empty.py` -- unchanged

---

## Change 1: Add `_format_entry_description()` helper

New private function in `execute_graphton.py` that generates a multi-workspace-appropriate description for a single entry, using structured data from `ProvisionResult`:

```python
def _format_entry_description(result: ProvisionResult) -> str:
    name = result.entry_name or "this entry"

    if result.source_type == SourceType.LOCAL_PATH:
        return (
            f"Workspace entry **{name}** is the user's project directory "
            f"at `{result.root_dir}`.\n"
            "You are operating directly on the user's files -- changes are "
            "immediate and persistent. Use git to track and verify your changes."
        )

    if result.source_type == SourceType.GIT_REPO and result.git_metadata:
        meta = result.git_metadata
        short_sha = (
            meta.base_commit[:7]
            if len(meta.base_commit) >= 7
            else meta.base_commit
        )
        return (
            f"Workspace entry **{name}** was initialized from "
            f"{meta.repo_url} (branch: {meta.branch}, commit: {short_sha}).\n"
            "Changes you make will be captured as artifacts when "
            "execution completes."
        )

    if result.source_type == SourceType.EMPTY:
        return (
            f"Workspace entry **{name}** is an empty workspace.\n"
            "Create files and directories as needed for your task."
        )

    # Unknown source type -- fall back to the source's own description.
    return result.workspace_description
```

Key content preserved from the source provisioners:

- **LOCAL_PATH**: persistence warning ("changes are immediate and persistent")
- **GIT_REPO**: artifact capture note, repo URL, branch, commit SHA
- **EMPTY**: "create files as needed" guidance

What changes:

- "Your workspace is..." becomes "Workspace entry **{name}** is..."
- Exploratory guidance ("Start by listing the root directory...") is removed -- redundant in multi-workspace context where the file tree is already shown per entry.

---

## Change 2: Rewrite `_build_multi_workspace_section()`

Current signature (line 656):

```656:656:backend/services/agent-runner/worker/activities/execute_graphton.py
def _build_multi_workspace_section(results: list[ProvisionResult]) -> str:
```

New signature adds `container_root`:

```python
def _build_multi_workspace_section(
    results: list[ProvisionResult], container_root: str,
) -> str:
```

New body generates three sections:

**a) Preamble** -- entry count + CWD + path resolution rules:

```
## Workspace

This session has {N} workspace entries.

**Current working directory**: `{container_root}`
**Path resolution**: All file tools (read, write, edit, ls, glob, grep) resolve
paths relative to the current working directory. Use entry-relative paths
(e.g., `{first_entry_name}/src/main.py`) or absolute paths.
```

**b) Per-entry blocks** -- heading with path + generated description + file tree:

```
### frontend (`/Users/dev/frontend`)

Workspace entry **frontend** is the user's project directory at `/Users/dev/frontend`.
You are operating directly on the user's files -- changes are immediate and persistent.
Use git to track and verify your changes.

#### Project Structure
...
```

**c) File tree** -- included verbatim as before (heading level controlled at provisioning time).

---

## Change 3: Update `build_workspace_prompt_section()` signature

Current (line 620):

```620:622:backend/services/agent-runner/worker/activities/execute_graphton.py
def build_workspace_prompt_section(
    provision_results: list[ProvisionResult] | None = None,
) -> str:
```

Add optional `container_root` parameter with empty-string default (preserves backward compat for all existing callers and tests that use single-entry):

```python
def build_workspace_prompt_section(
    provision_results: list[ProvisionResult] | None = None,
    container_root: str = "",
) -> str:
```

The `container_root` is forwarded to `_build_multi_workspace_section()` only. Single-entry path is unchanged.

---

## Change 4: Update call site

Current (approx line 1873):

```python
workspace_section = build_workspace_prompt_section(provision_results)
```

New:

```python
workspace_section = build_workspace_prompt_section(
    provision_results,
    container_root=workspace_backend.root_dir,
)
```

This passes the backend's `root_dir` which is:

- **Cloud mode (multi git entries)**: The container directory (parent of cloned entries)
- **Local mode (multi local paths)**: The original backend root
- **Single entry**: Not used (single-entry path doesn't call `_build_multi_workspace_section`)

---

## Change 5: Import `SourceType`

`SourceType` is likely not directly imported in `execute_graphton.py` today (only accessed on `ProvisionResult` objects). Need to add it to the `from worker.workspace.provisioner import ...` line.

---

## Change 6: Test updates in `test_workspace_prompt_section.py`

### Existing tests to update (7 tests in `TestMultiEntryWorkspacePromptSection`):

All existing multi-entry tests call `build_workspace_prompt_section(entries)` without `container_root`. With the new default `container_root=""`, these tests will still work but assertions need updating:

- `test_multi_entry_preamble_names_primary` -- currently asserts `"starting directory"` and `**frontend`**. The new prompt no longer says "starting directory"; update to assert `"Current working directory"` and `"Path resolution"`.
- `test_two_local_entries_shows_both_paths` -- still passes (paths appear in entry headings).
- `test_multi_entry_headings_use_entry_names` -- update to assert headings include paths: `### frontend (\`/Users/dev/frontend)`.
- `test_multi_entry_entry_count_in_preamble` -- still passes.
- `test_single_entry_identical_to_legacy` -- still passes (single-entry path unchanged).
- `test_multi_entry_starts_with_double_newline` -- still passes.
- `test_multi_entry_file_tree_heading_preserved` -- still passes (tree passthrough unchanged).

### New tests to add:

- `**test_multi_entry_cwd_in_preamble**` -- pass `container_root="/workspace"`, assert `"**Current working directory**: \`/workspace"` appears.
- `**test_multi_entry_path_resolution_rules`** -- assert the path resolution guidance text is present and references the first entry name as an example.
- `**test_multi_entry_local_path_description`** -- two local entries, assert each gets "Workspace entry **{name}** is the user's project directory..." (not "Your workspace is...").
- `**test_multi_entry_git_description`** -- two git entries, assert each gets "Workspace entry **{name}** was initialized from..." with URL, branch, short SHA.
- `**test_multi_entry_empty_description`** -- empty source entry, assert "Workspace entry **{name}** is an empty workspace."
- `**test_multi_entry_mixed_sources`** -- one local + one git entry, assert each gets its source-type-appropriate description.
- `**test_multi_entry_entry_heading_includes_path**` -- assert entry headings are `### {name} (\`{root_dir})`.
- `**test_format_entry_description_fallback`** -- unknown source type falls back to `workspace_description`.

### Fixture additions:

- Update `_two_local_entries()` to optionally accept a `container_root` or just pass it to `build_workspace_prompt_section()` in individual tests.
- Add `_two_git_entries()` helper for git-specific multi-entry tests.
- Add `_mixed_entries()` helper for local+git combo tests.

---

## What the Resulting Multi-Workspace Prompt Looks Like

For a session with `--workspace frontend=/Users/dev/frontend --workspace backend=https://github.com/acme/backend.git`:

```
## Workspace

This session has 2 workspace entries.

**Current working directory**: `/workspace`
**Path resolution**: All file tools (read, write, edit, ls, glob, grep) resolve
paths relative to the current working directory. Use entry-relative paths
(e.g., `frontend/src/main.py`) or absolute paths.

### frontend (`/workspace/frontend`)

Workspace entry **frontend** is the user's project directory at `/workspace/frontend`.
You are operating directly on the user's files -- changes are immediate and persistent.
Use git to track and verify your changes.

#### Project Structure
    ...

### backend (`/workspace/backend`)

Workspace entry **backend** was initialized from https://github.com/acme/backend.git
(branch: main, commit: a1b2c3d).
Changes you make will be captured as artifacts when execution completes.

#### Project Structure
    ...
```

---

## Verification

- Run all agent-runner tests: `cd backend/services/agent-runner && python -m pytest tests/test_workspace_prompt_section.py -v`
- Run the full agent-runner suite to catch regressions: `python -m pytest tests/ -x`
- Confirm single-workspace tests are unchanged (backward compat)

