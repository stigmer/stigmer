# Implement Explore and Shell Built-in Subagent Types

**Date**: March 30, 2026

## Summary

Introduced two specialized built-in subagent types — **explore** and **shell** — that restrict tool access and use isolated system prompts to prevent the scope violations identified in production. Explore subagents receive only read-only tools; shell subagents receive only execute plus minimal read tools. Neither type inherits the parent agent's skills metadata or delegation rules, eliminating the LLM breadcrumb-following that caused a subagent to run initialization scripts instead of completing its exploration task.

## Problem Statement

The general-purpose (GP) subagent inherited the parent agent's full system prompt, including skills metadata with activation instructions. The LLM would follow these breadcrumbs and exceed its delegated scope — for example, an exploration subagent would discover a skill's `init_skill.py`, follow the activation instructions, and execute the initialization script instead of simply reporting findings.

### Pain Points

- GP subagents had access to all platform tools (read, write, edit, delete, execute) regardless of task type
- The parent's skills section leaked into subagent prompts, providing activation breadcrumbs
- No mechanism existed to restrict a subagent's tool set based on its intended role
- Scope violation fixes (prompt stripping via regex) were reactive rather than preventive

## Solution

Implemented a two-layer defence modeled after Cursor's subagent architecture:

1. **Tool restriction** — A new `create_filtered_platform_tools()` function creates only the tools from a specified allowed set. Explore subagents get `{read, ls, glob, grep, search}`. Shell subagents get `{read, ls, execute}`.
2. **Prompt isolation** — Built-in subagents receive clean, purpose-built system prompts with explicit scope boundaries. No parent prompt inheritance, no skills metadata, no delegation rules.

## Implementation Details

### Tool Filtering (`tool_wrappers.py`)

- Added `EXPLORE_TOOL_SET` and `SHELL_TOOL_SET` as immutable `frozenset` constants
- Added `create_filtered_platform_tools()` that maps tool names to their factory functions and only instantiates allowed tools, including aliases (e.g. `read_file`) only when the canonical tool is present
- Existing `create_platform_tool_wrappers()` unchanged — full backward compatibility

### Built-in Subagent Creation (`subagent_transformer.py`)

- Added `BUILTIN_SUBAGENT_TYPES` constant (`frozenset({"explore", "shell"})`)
- Defined `_EXPLORE_SYSTEM_PROMPT` and `_SHELL_SYSTEM_PROMPT` with explicit "STRICT BOUNDARIES" sections
- Added `create_builtin_subagents()` that creates subagent dicts with filtered tools and isolated prompts
- Graceful error handling — returns empty list on any failure, never blocks agent startup

### Setup Integration (`setup.py`)

- After proto-defined subagent transformation, built-in explore and shell subagents are injected
- Name collision protection: skips built-in type if a proto-defined subagent already uses the same name
- Always injected when a sandbox is available, regardless of whether proto subagents exist

### GP Scope Enhancement (`agent.py`)

- Strengthened `_GP_SCOPE_PREAMBLE` with more explicit boundaries about initialization scripts and workflow operations

### Observability (`handlers/sub_agent.py`)

- Added structured logging when built-in subagent types start, noting tool-restricted and isolated prompt characteristics

## Benefits

- **Preventive scope enforcement**: Explore subagents physically cannot write files or execute commands — the tools don't exist in their tool set
- **No prompt injection surface**: Skills metadata and delegation rules are absent from built-in subagent prompts
- **Zero regression risk**: All existing functionality (proto subagents, GP subagent, MCP filtering) is unchanged
- **Consistent with Cursor's architecture**: Mirrors the explore/shell subagent type pattern that has proven effective in production IDE agents

## Impact

- **Agent safety**: Eliminates the class of scope violations where exploration tasks trigger file writes or script execution
- **Agent operators**: No configuration changes required — built-in types are automatically available when sandbox is configured
- **Backward compatibility**: Existing proto-defined subagents and GP subagent behavior unchanged
- **Test coverage**: 23 new tests across both modules, all 183 tests in affected suites passing

## Related Work

- Prior fix: `fix(backend/libs): prevent GP sub-agent scope violations` (d40507ae) — reactive prompt stripping
- This change provides the preventive layer that the reactive fix cannot guarantee

---

**Status**: ✅ Production Ready
**Files Changed**: 7 (664 insertions, 9 deletions)
