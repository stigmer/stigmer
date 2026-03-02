# Fix Glob Tool Pattern Matching and Skill Path Resolution

**Date**: March 2, 2026

## Summary

Fixed two compounding bugs that broke agent workflows when using skills with bundled resources. The glob tool used incorrect criteria for pattern matching (checking for `**` instead of `/` to decide full-path vs basename matching), and the system prompt's Workspace rule was incomplete -- it only guided agents on shell execution of skill scripts, not on reading skill-relative files.

## Problem Statement

When running `stigmer draft skill` to generate the agent-creator skill, the agent was unable to find files using path-containing glob patterns and could not resolve skill-internal references.

### Pain Points

- `glob("docs/product/what-is-*.md")` returned "No files matching" despite the files existing, because the pattern was matched against basenames only (`what-is-agent.md` vs `docs/product/what-is-*.md`)
- `glob("scripts/init_skill.py")` similarly failed, preventing the agent from discovering skill-bundled scripts
- The agent could read `SKILL.md` but could not resolve relative references within it (`scripts/`, `references/`, `assets/`) because the system prompt only explained shell execution paths, not file reading paths

## Solution

Two targeted fixes addressing each root cause:

1. **Glob tool**: Changed the branching criterion from `"**" in pattern` to `"/" in pattern` -- patterns containing path separators now match against full paths, while filename-only patterns continue matching against basenames.

2. **Workspace rule**: Extended the existing Workspace rule paragraph in `generate_prompt_section()` with a single generic instruction for resolving skill-relative paths from the skill's Location directory. This completes an instruction that was written with only shell execution in mind.

## Implementation Details

### Glob fix (`tool_wrappers.py`)

The pattern matching logic was:

```python
if "**" in pattern:
    matches = [f for f in all_files if fnmatch.fnmatch(f, pattern)]
else:
    matches = [f for f in all_files if fnmatch.fnmatch(os.path.basename(f), pattern)]
```

Changed to:

```python
if "/" in pattern:
    matches = [f for f in all_files if fnmatch.fnmatch(f, pattern)]
else:
    matches = [f for f in all_files if fnmatch.fnmatch(os.path.basename(f), pattern)]
```

This correctly handles all pattern categories:
- `docs/product/what-is-*.md` -- contains `/`, matches full path
- `**/*.md` -- contains `/`, matches full path (subsumes the old `**` case)
- `*.py` -- no `/`, matches basename only

### Workspace rule (`skill_writer.py`)

Added path resolution guidance to the existing Workspace rule:

> When a skill's SKILL.md references relative paths (e.g. `scripts/run.py`, `references/schema.md`), resolve them from the skill's Location directory.

### Tests

- Added `TestGlobToolPathPatterns` with 11 tests covering path-component patterns, recursive `**` patterns, basename patterns, and path-scoped searches using a realistic mock filesystem mirroring the `.stigmer/skills/` structure
- Added `test_workspace_rule_covers_read_and_execute` verifying the Workspace rule contains both read and execute guidance

## Benefits

- Agents can now reliably find files using path-containing glob patterns like `docs/product/what-is-*.md`
- Skill-bundled resources (scripts, references, assets) are discoverable when agents follow the Workspace rule
- The `stigmer draft skill` command can operate correctly with workspace-scoped file searches

## Impact

- **Agent runner**: All agents using the glob tool benefit from correct path-pattern matching
- **Skill system**: Skills with bundled resources (skill-creator, mcp-server-creator, future skills) work correctly when their SKILL.md references internal files
- **Seedpack**: The `02_draft-agent-creator-skill.sh` pipeline should now complete without find/glob failures

## Related Work

- Skill architecture: `backend/services/agent-runner/docs/architecture/skill-architecture.md`
- Skill-creator skill (vendored from Anthropic): `seedpack/skills/skill-creator/`

---

**Status**: Production Ready
