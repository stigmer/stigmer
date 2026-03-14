# Diff-Based Output Optimization: Prompt Engineering for Token-Efficient Editing

**Date**: March 14, 2026

## Summary

Added dual-layer prompt guidance — enhanced tool docstrings and a new system prompt section — to steer LLMs toward using the `edit` (search-and-replace) tool instead of full-file `write` rewrites when making targeted code changes. This is a zero-infrastructure prompt engineering optimization that reduces output tokens by encouraging minimal diffs over whole-file regeneration.

## Problem Statement

When an LLM agent modifies an existing file, it can either rewrite the entire file (using `write`) or replace only the changed section (using `edit`). The sandbox already supported both operations, but nothing in the prompt or tool descriptions steered the model toward the more efficient path.

### Pain Points

- Full-file `write` for a one-line change in a 500-line file costs ~500 lines of output tokens — the `edit` tool would cost ~5 lines
- Tool docstrings were generic ("write content to a file", "edit a file by replacing text") — no signal about when to prefer one over the other
- System prompt covered file reading efficiency (line-range reads) but said nothing about editing efficiency

## Solution

Two complementary guidance layers that reinforce the same behavioral signal:

1. **Tool docstrings** (primary lever) — Enhanced the `write` and `edit` tool descriptions to make the efficiency tradeoff explicit at the point of tool selection
2. **System prompt** (secondary reinforcement) — Added an "Editing Efficiency" sub-section to the existing `FILESYSTEM_CAPABILITY` constant

## Implementation Details

### Tool Docstring Changes (`tool_wrappers.py`)

**`write` tool** — Docstring now opens with "Create a new file or overwrite an entire file" and explicitly states "This replaces the ENTIRE file content. For targeted changes... prefer the `edit` tool instead." The old docstring was a generic "Write content to a file."

**`edit` tool** — Docstring now opens with "Make a targeted change to an existing file" and states "This is the preferred way to modify existing files — you only specify the changed section, avoiding the cost of regenerating the entire file." Includes guidance on minimal `old_text` context selection. Removed the `Raises` section that documented implementation details irrelevant to tool selection.

### System Prompt Addition (`prompt_enhancement.py`)

Added ~65 words to the `FILESYSTEM_CAPABILITY` constant:

> **Editing Efficiency**: When modifying existing files, prefer `edit` over `write`. The `edit` tool replaces only the targeted section — you specify `old_text` (enough context to locate it uniquely) and `new_text`. This avoids regenerating unchanged content. Use multiple `edit` calls for multiple changes in the same file. Reserve `write` for creating new files or complete rewrites where the structure changes fundamentally.

### Tests (`test_prompt_enhancement.py`)

- `test_filesystem_capability_includes_editing_efficiency` — Verifies the new content is present and references the right tool names and parameters
- `test_filesystem_capability_prefers_edit_over_write` — Validates the directional guidance (prefer edit, reserve write)
- Adjusted `test_prompt_size_reasonable` upper bound from 1500 to 1600 words to accommodate intentional growth

## Benefits

- **Output token reduction**: For targeted edits (the common case), output can shrink by 10-100x compared to full-file rewrites
- **Cost reduction**: Fewer output tokens directly reduce LLM API costs per execution
- **Zero runtime overhead**: Pure prompt engineering — no new code paths, no middleware, no configuration
- **Minimal prompt budget**: ~65 words added (~0.3% of typical context window)

## Impact

- **Agent executions**: All executions benefit — the enhanced tool descriptions are loaded for every agent run
- **Cost optimization project**: This is Phase 8 of 9 in the usage-metrics-and-cost-optimization project
- **Probabilistic**: As a prompt engineering change, the impact is behavioral — LLMs are more likely to choose `edit` but are not forced to. Production monitoring of edit-to-write ratios will quantify the actual shift.

## Related Work

- Part of project `20260313.01.usage-metrics-cost-optimization` (Phases 1-8 complete)
- Builds on Phase 4's tool result truncation middleware (input side) — this addresses the output side
- Phase 9 (Smart Context / Selective Inclusion) will further reduce token costs by pruning irrelevant tools and skills from prompts

---

**Status**: ✅ Production Ready
**Timeline**: Single session
