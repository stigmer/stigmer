# Discourage Tool Alias Usage via Descriptions and System Prompt

**Date**: March 4, 2026

## Summary

Steers LLMs toward canonical tool names (`read`, `write`, `edit`) by marking the three deepagents-override aliases (`read_file`, `write_file`, `edit_file`) as internal-only in both their tool descriptions and the system prompt. The aliases remain fully functional for approval-checking safety, but the LLM is now explicitly told not to call them.

## Problem Statement

After the multi-source workspace project added support for multiple `--workspace` entries, agents see 11 tools in their tool list: 8 canonical plus 3 aliases. Because the aliases were produced by the same factory, they had **identical descriptions** to their canonical counterparts. LLMs wasted turns reasoning about which to use.

### Pain Points

- LLM sees `read` and `read_file` with the same description and deliberates unnecessarily
- Duplicate tool descriptions consume context window budget
- Agents occasionally pick `read_file` over `read`, creating inconsistent tool call patterns

## Solution

Two-pronged approach -- alias-side descriptions plus system prompt reinforcement:

1. **Alias descriptions**: Each alias now carries a short, directive description: *"Internal override for 'read'. Do not call directly -- use 'read' instead (identical parameters and behavior)."*
2. **System prompt**: `FILESYSTEM_CAPABILITY` now includes canonical-name guidance immediately after the tool list: *"Always use these canonical tool names. Do not use `read_file`, `write_file`, or `edit_file` -- they are internal overrides with identical behavior."*

## Implementation Details

### `_register_alias` helper (`tool_wrappers.py`)

Extracted a `_register_alias()` function and a `_ALIAS_DESCRIPTION_TEMPLATE` module constant that centralizes the alias registration pattern (name override + description override + append). The three inline alias blocks (12 lines) are replaced by three concise calls. The description template is a single contract -- if wording needs tuning, it changes in one place.

### Prompt enhancement (`prompt_enhancement.py`)

Added two sentences to `FILESYSTEM_CAPABILITY` right after the canonical tool list intro. Placed before the usage bullets so it reads as a natural continuation of the tool enumeration.

### Tests

- `test_alias_tools_have_redirect_descriptions` -- verifies each alias's description contains "do not call directly", references the canonical name, and differs from the canonical tool's description.
- `test_filesystem_capability_discourages_alias_names` -- verifies `FILESYSTEM_CAPABILITY` mentions all three alias names and contains "internal override" language.

Existing tests for tool count (11) and tool names pass unchanged.

## Benefits

- LLMs stop wasting turns deliberating between duplicate tools
- Reduced context window consumption (alias descriptions are ~25 words vs ~80+ for the full canonical docstring)
- No safety regression -- aliases still carry full approval checking
- Centralized description template makes future wording changes trivial

## Impact

- **Agents**: Cleaner tool selection behavior in both single- and multi-workspace sessions
- **Users**: Fewer wasted agent turns means faster task completion
- **Maintainers**: Alias registration is now a single helper with clear intent

## Related Work

- Part of project `20260304.03.multi-workspace-agent-polish` (T01)
- Follows multi-source workspace provisioning (`20260304.01`)
- Precedes T02 (relevance signaling), T03 (gitignore), T04 (system prompt) in the same project

---

**Status**: Production Ready
**Timeline**: Single session
