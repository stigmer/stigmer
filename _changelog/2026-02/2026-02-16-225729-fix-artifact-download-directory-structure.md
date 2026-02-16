# Fix Artifact Download Directory Structure Preservation

**Date**: February 16, 2026

## Summary

Fixed a three-layer bug in the `stigmer draft skill` pipeline that caused downloaded skill artifacts to lose their directory hierarchy. Files like `SKILL.md` and `references/examples.md` were flattened into the same directory, breaking relative path references. The fix spans auto-publish grouping (Python), CLI download extraction (Go), and platform-level workspace boundary rules.

## Problem Statement

When running `stigmer draft skill`, the generated skill package was downloaded with all files flat in one directory, despite the agent correctly creating them in a structured hierarchy inside the sandbox (`SKILL.md` + `references/` subdirectory). This made the downloaded skill immediately broken -- any `references/examples.md` link in SKILL.md would fail because no `references/` directory existed.

### Pain Points

- SKILL.md referenced `references/examples.md` but the file was downloaded as a sibling, not in a subdirectory
- Generated documentation files (INDEX.md, README.md) contained hardcoded `/bin/skills/` infrastructure paths that only made sense inside the sandbox
- Users had to manually reconstruct the directory structure after every skill download
- The platform leaked internal deployment conventions (`bin/skills/`) into agent-generated content

## Solution

Three targeted fixes working as defense-in-depth layers:

1. **Auto-publish grouping** -- when files span multiple directory trees, group by top-level directory and publish each group as a ZIP directory artifact (preserving internal structure)
2. **CLI directory extraction** -- detect directory artifacts and extract ZIPs on download instead of saving them as opaque files
3. **Platform workspace rules** -- inject a read-only boundary rule into every agent's system prompt so agents never write into `bin/skills/` in the first place

## Implementation Details

### Auto-Publish Multi-Root Grouping (`execute_graphton.py`)

The `_auto_publish_written_files` function previously used `posixpath.commonpath()` across all written files. When files spanned `bin/skills/agent-drafter/` and `outputs/`, commonpath returned empty, triggering a fallback that published each file individually using just its basename.

The fix groups files by their top-level directory segment using `collections.defaultdict`, computes the deepest common path within each group, and publishes each group as a directory artifact. Root-level files (no parent directory) are still published individually.

### CLI Directory Artifact Extraction (`run_handlers.go`)

The `downloadArtifact` function previously used `artifact.GetName()` for all artifacts regardless of kind. Now it checks `artifact.GetKind()`:

- `EXECUTION_ARTIFACT_KIND_DIRECTORY`: Downloads the ZIP, reads it into memory, and extracts using `archive/zip` to `downloadDir/name/` with full path preservation. Includes a zip-slip security guard using `filepath.Clean` prefix checking.
- `EXECUTION_ARTIFACT_KIND_FILE`: Unchanged behavior (direct save).

### Platform Workspace Boundary (`skill_writer.py`)

Added a workspace rule to `generate_prompt_section()` -- the same function that already injects skill locations into every agent's system prompt. The new rule states that `bin/skills/` is read-only platform infrastructure. This prevents the path leakage problem at the source, without requiring any user or agent-author action.

### Skill-Creator Agent Guidelines (`skill-creator-agent.yaml`)

Added an "Output Rules" section reinforcing two agent-specific behaviors: create only skill package files (no extraneous README/SUMMARY/INDEX), and use only relative paths in generated content.

## Benefits

- Skill downloads preserve directory structure out of the box -- `references/` subdirectories work immediately
- Infrastructure paths (`bin/skills/`) no longer leak into generated content
- Zero user burden -- workspace rules are injected automatically for all agents
- Defense in depth -- even if the agent doesn't comply with prompt rules, auto-publish and CLI extraction produce correct structure
- Zip-slip security guard protects against malicious ZIP entries

## Impact

- **All agent executions**: Auto-publish grouping improvement applies universally (only affects the "no common root" fallback, which was previously broken anyway)
- **All CLI downloads**: Directory artifacts are now properly extracted
- **All agents with skills**: See the workspace boundary rule in their system prompt
- **Skill-creator agent**: Gets stricter output guidelines after re-bootstrap

## Related Work

- Part of the `feat/add-skill-creator-agent` branch work
- Builds on the seedpack bootstrap infrastructure and skill-creator agent
- Complements the earlier artifact download URL fix (`fix(backend,cli): artifact download URL construction`)

---

**Status**: Production Ready
**Timeline**: Single session
