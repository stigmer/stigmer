# Phase 5: Multi-Source Workspace — Tests + Polish

**Date**: March 4, 2026

## Summary

Phase 5 completes the multi-source workspace feature with integration tests that exercise the full provisioning-to-prompt pipeline, guard-rail tests that document MVP limitations, Daytona `cwd` conformance tests, and a refactor that removes the fragile heading string-replace in favor of a configurable tree heading level. All 1071 backend tests pass with zero regressions.

## Problem Statement

Phases 1–4 delivered the multi-workspace implementation (proto, CLI, provisioner, git subdirectory cloning, prompt formatting). The original gap inventory (Gaps 30–33) was largely addressed by unit tests written during implementation, but the plan called for integration-level composition tests, explicit guard-rails for documented MVP behavior, verification of Daytona’s `cwd` contract, and removal of a brittle string-replace used to adjust tree heading level in multi-entry prompts.

### Pain Points

- Unit tests mock backends and sources heavily; composition bugs could slip through.
- MVP limitations (mixed local+git, backend replacement rule, single-root referenced files) were only implied by code; no tests codified them.
- Session 4 left open whether Daytona’s `execute(cmd, cwd=subdir)` correctly scopes to subdirectories.
- `_build_multi_workspace_section` used `result.file_tree.replace("### Project Structure", "#### Project Structure", 1)`, which is fragile if the tree format changes.

## Solution

1. **Integration tests** — New file `test_multi_workspace_integration.py` runs the real pipeline: `provision_all()` → file-tree enrichment → `build_workspace_prompt_section()` using `LocalWorkspaceBackend` and temp directories. Covers two local entries, single local (backward compat), two git entries (mocked clone), single git (backward compat), plus guard-rails for backend replacement and referenced-files primary root.
2. **Guard-rail tests** — Mixed local+git in `test_provisioner.py`; backend replacement and referenced-files behavior in the integration file.
3. **Daytona cwd conformance** — New tests in `test_daytona_backend.py` verify `cwd` scopes to subdirectory, default is root, leading slash is stripped, and nested paths work.
4. **Heading-level polish** — `_format_workspace_tree` and `build_workspace_file_tree` accept `heading_level`; `provision_all()` passes `tree_heading_level=4` when `use_subdirs` is true; `_build_multi_workspace_section` no longer performs string replace.

## Implementation Details

- **tree.py**: Added `TREE_HEADING_TITLE`, `heading_level` parameter to `_format_workspace_tree` and `build_workspace_file_tree` (default 3).
- **provisioner.py**: `provision()` and `_enrich_with_file_tree()` accept `tree_heading_level` / `heading_level`; `provision_all()` sets `heading_level=4` when `len(entries) > 1`.
- **execute_graphton.py**: Removed the `replace("### Project Structure", "#### Project Structure", 1)` in `_build_multi_workspace_section`; tree is formatted at the correct level during provisioning.
- **test_multi_workspace_integration.py**: 21 tests (multi-local, single local compat, multi-git, single git compat, backend replacement guard, referenced-files primary root guard).
- **test_provisioner.py**: `TestMixedLocalGitGuardRail` (2 tests) — local entry keeps original path, git gets subdir in mixed sessions.
- **test_daytona_backend.py**: `TestCwdConformance` (4 tests) — cwd scoping, no-cwd root, strip leading slash, nested path.
- **test_workspace_prompt_section.py**: `test_multi_entry_file_tree_heading_preserved` — fixture uses `####` to reflect provisioner output; docstring updated.

## Benefits

- Composition bugs are caught by integration tests that wire real backends and provisioner.
- MVP boundaries are explicit in tests, reducing accidental behavior changes.
- Daytona’s `cwd` contract is verified; Session 4 open question closed.
- Tree heading is set at build time instead of by string surgery; no dependency on exact heading text in the prompt builder.

## Impact

- **Backend (agent-runner)**: 4 production files changed (tree, provisioner, execute_graphton), 4 test files modified, 1 new test file. Full test suite: 1071 passed.
- **Project 20260304.01.multi-source-workspace**: Phase 5 complete; project ready for release prep (e.g. stigmer-cloud stub regeneration).

## Related Work

- Phases 1–4: Proto schema, CLI multi-workspace, backend provisioner (local + git), subdirectory cloning (see checkpoints 2026-03-04-session-1 through session-4).
- Changelogs: `2026-03-04-005215-multi-source-workspace-proto-schema.md`, `2026-03-04-011542-cli-multi-workspace-support.md`, `2026-03-04-014342-backend-multi-workspace-provisioner.md`, `2026-03-04-022307-multi-git-subdirectory-provisioning.md`.

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (Phase 5)
