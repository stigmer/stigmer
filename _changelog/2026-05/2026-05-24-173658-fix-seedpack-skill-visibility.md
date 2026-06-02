# Fix Seedpack Skill Visibility (Private -> Public)

**Date**: May 24, 2026

## Summary

Seedpack skills were being uploaded without a visibility field, making them invisible to external users while all other seedpack resources (agents, MCP servers, workflows) were correctly public. Added a seedpack-only post-push step that calls the existing `UpdateVisibility` RPC to set skills public, triggered by a hidden `--public-skills` CLI flag.

## Problem Statement

Skills uploaded through the seedpack bootstrap had no `visibility` field in MongoDB, effectively making them private. This meant the 12 platform skills (e.g., `data-analyst`, `code-reviewer`, `brand-guidelines`) were not discoverable by users outside the `stigmer` org.

### Pain Points

- The `notification-analyst` agent in tt-demo references `stigmer/data-analyst` skill, but the skill was inaccessible (permission denied on `get_skill`)
- Searching for skills in the `stigmer` org returned 0 results, while agents/MCP servers/workflows were all visible
- The root cause was architectural: skills use `push` (zip artifact) not `apply` (YAML), and `PushSkillRequest` has no visibility field — so the backend leaves it at the protobuf zero value

## Solution

Seedpack-only approach that avoids modifying the SKILL.md frontmatter spec, proto definitions, or backend push handlers:

1. Push skills normally (unchanged behavior)
2. After push, call `UpdateVisibility(public)` for each skill — but only when the hidden `--public-skills` flag is set
3. The seedpack bootstrap automatically passes this flag

## Implementation Details

Four files changed in the CLI:

- **`artifact/skill.go`**: Added `ID` field to `SkillArtifactResult` to expose the resource ID from the push response (needed for the `UpdateVisibility` call)
- **`apply.go`**: Added hidden `--public-skills` flag and `PublicSkills` field in `projectApplyOptions`
- **`apply_declarative.go`**: Introduced `pushedSkillInfo` struct, updated `pushSkillDirectory` to return both ref and ID, added `setSkillsVisibilityPublic` helper that calls the existing `UpdateVisibility` RPC
- **`seedpackbootstrap/apply.go`**: Added `--public-skills` to the subprocess args in `applyProject`

## Benefits

- Platform skills become discoverable in marketplace search
- Cross-org skill references (e.g., tt-demo agents using `stigmer/data-analyst`) work correctly
- No changes to user-facing behavior — user skills remain private by default
- No proto, backend, or SKILL.md spec changes required

## Impact

- **Seedpack bootstrap**: All 15 skills will be set to public on next bootstrap run
- **Existing production data**: The 12 skills missing visibility will be fixed when the next `stigmer seedpack apply` runs after deployment (the `UpdateVisibility` RPC also creates FGA public viewer tuples)
- **User workflows**: No impact — the `--public-skills` flag is hidden and only used internally by seedpack bootstrap

## Related Work

- MongoDB investigation confirmed the visibility gap: 12 skills had no visibility field while 3 older skills and all agents/MCP servers/workflows had `visibility_public`
- Both Go (local) and Java (cloud) backends already had `UpdateVisibility` RPC handlers, so no backend changes were needed

---

**Status**: Production Ready
**Timeline**: ~1 hour
