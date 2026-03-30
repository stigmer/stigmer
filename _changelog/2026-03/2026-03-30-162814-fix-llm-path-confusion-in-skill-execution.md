# Fix LLM Path Confusion in Skill Execution

**Date**: March 30, 2026

## Summary

Eliminated 3-5 wasted tool calls per skill execution by making `.stigmer/` virtual-mount paths resolve transparently in shell commands. The LLM no longer needs to know about two different path schemes (`.stigmer/` for file tools vs `$STIGMER_PLATFORM_DIR` for shell) — one path works everywhere.

## Problem Statement

When the skill-creator agent (or any agent with bundled skills) needed to execute a script, the LLM would see the skill Location as `.stigmer/skills/skill-creator/` and the SKILL.md instruction as `scripts/init_skill.py`. It naturally combined them into `.stigmer/skills/skill-creator/scripts/init_skill.py` and tried to execute it in the shell.

### Pain Points

- `.stigmer/` is a virtual mount that only resolves through file tools (`read`, `write`, `glob`). In the shell, `.stigmer/` does not exist as a real directory. Every execution attempt failed.
- The LLM would then flounder for 3-5 tool calls: running `ls` checks, `find / -name ...` across the entire filesystem, and hallucinating paths like `cd /home/user/repo`.
- Each wasted tool call adds 5-15 seconds of latency (LLM inference + tool execution), costing users 30-60 seconds of unnecessary wait time per skill scaffolding operation.
- The system prompt explained a dual-path scheme (read with `.stigmer/`, execute with `$STIGMER_PLATFORM_DIR`) but the LLM often ignored or confused the two conventions.

## Solution

Made the platform bridge the gap instead of burdening the LLM with two path schemes. The `execute` tool now auto-resolves `.stigmer/` references in shell commands to `$STIGMER_PLATFORM_DIR/` before passing them to `subprocess`. This means the LLM's natural behavior — combining the Location path with the relative script path — just works.

## Implementation Details

### Core: `resolve_platform_command()` in `platform_mount.py`

Added a new function that is the inverse of the existing `humanize_platform_refs()`:
- `humanize_platform_refs`: `$STIGMER_PLATFORM_DIR` → `.stigmer` (for display)
- `resolve_platform_command`: `.stigmer` → `$STIGMER_PLATFORM_DIR` (for execution)

The regex matches `.stigmer` as a standalone path component, avoiding false positives on `foo.stigmer` (preceded by word char) or `path/.stigmer` (preceded by `/`).

### Edge case: real `.stigmer/` directory

The auto-resolve is guarded by `if self._platform_root is not None` — the same condition that controls the virtual mount for file tools. When no platform mount is active, `.stigmer/` is a real path and is left alone.

### Wiring: three execute paths

- `filesystem.py` `execute()` and `execute_streaming()` (graphton library)
- `local.py` `execute()` (agent-runner workspace backend)

Each adds one guarded line before the subprocess call.

### Prompt simplification

- **skill_writer.py**: Replaced the 12-line dual-path "Working with Skill Files" section with a 4-line unified version. One path scheme, two examples.
- **skill-creator.yaml**: Deleted the "Runtime Path Conventions" section (11 lines). Updated scaffold/package commands from `$STIGMER_PLATFORM_DIR/...` to `.stigmer/...`.
- **prompt_enhancement.py**: Added "File or Path Not Found" recovery section that explicitly discourages `find /` and directs to `glob`.

## Benefits

- **First-try success**: The LLM executes the correct command on the first attempt instead of floundering for 3-5 calls
- **30-60 seconds saved** per skill scaffolding operation (eliminates wasted tool calls)
- **~80 tokens saved** per prompt (removed dual-path explanation)
- **Simpler mental model**: One path scheme instead of two — `.stigmer/` works everywhere
- **Consistent behavior**: Shell commands now resolve `.stigmer/` the same way file tools do

## Impact

- All agents with bundled skills benefit (not just skill-creator)
- The SKILL.md format (Anthropic-authored) is unchanged — bare relative paths work naturally
- `$STIGMER_PLATFORM_DIR` env var is still set (backwards compatible for any agents that already use it)
- Zero proto/RPC/collection changes

## Related Work

- AD-01 v3: Virtual platform mount design decision
- `classify_platform_path()` and `humanize_platform_refs()` — the existing platform-path functions that this complements

---

**Status**: Production Ready
**Timeline**: Single session
