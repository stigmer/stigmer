# Fix Agent Context Fidelity and Sub-Agent Platform Tools

**Date**: March 1, 2026

## Summary

Two gaps in the agent-runner prevented the Graphton agent from operating efficiently: the "Referenced Files" prompt section told the agent to `read` every attached path (including directories), causing wasted turns on `IsADirectoryError` recovery; and user-defined sub-agents never received platform tools (filesystem + shell execution), making skill scripts like `init_skill.py` unusable from within delegated tasks.

## Problem Statement

Running `stigmer draft skill` with directory attachments (e.g. `--attach apis/ai/stigmer/agentic/agent`) produced an agent that immediately hit errors trying to `read` directories, then had to self-recover with `ls`. Separately, when the agent delegated work to a user-defined sub-agent, that sub-agent lacked the `execute` tool entirely, forcing it to manually simulate Python scripts by reading them and recreating their output file-by-file -- a fragile and incorrect workaround.

### Pain Points

- The agent wasted one full LLM turn per directory attachment on an `IsADirectoryError` + recovery cycle. With three directory attachments (the common case in seedpack scripts), this burned significant tokens and latency before any real work began.
- User-defined sub-agents could not run shell commands. Skills that bundle scripts (e.g. skill-creator's `init_skill.py`) became dead code from the sub-agent's perspective, defeating the purpose of script-equipped skills.
- The `build_referenced_files_prompt_section` function used `os.path.getsize()` which raises `OSError` for directories, silently falling into a catch-all `except` that stripped all metadata -- the agent received no signal that the path was a directory.
- The `subagent_transformer` only wired MCP tools into user-defined sub-agents. Because deepagents uses `spec.get("tools", parent_tools)`, setting an explicit `tools` key (even with only MCP tools) prevented inheritance of the parent's platform tools.

## Solution

Two targeted fixes in the agent-runner backend, one in prompt construction and one in sub-agent transformation.

## Implementation Details

**Fix 1 -- Type-aware Referenced Files prompt (`execute_graphton.py`)**

`build_referenced_files_prompt_section()` now calls `os.stat()` + `os.path.isdir()` on each workspace-relative path. Files are listed with their byte size; directories are tagged with a trailing `/` and `(directory)`. The instruction text changed from "Read them directly... using the `read` tool" to "Use `read` for files and `ls` for directories", giving the agent the right tool choice upfront.

**Fix 2 -- Platform tools for user-defined sub-agents (`subagent_transformer.py`)**

`transform_sub_agents()` now accepts an optional `sandbox_config` parameter. When provided, it creates a sandbox backend and calls `create_platform_tool_wrappers()` once, producing the full platform tool set (read, write, ls, glob, grep, execute). These tools are shared across all sub-agents and prepended to each sub-agent's tool list before any MCP tools. The sub-agent dict now always sets an explicit `tools` key containing platform + MCP tools, ensuring deepagents uses the complete list rather than falling back to partial inheritance.

The call site in `execute_graphton.py` passes `sandbox_config_for_agent` (the same config used by the parent agent) into the transformer.

## Benefits

- Zero wasted turns on directory attachments. The agent sees `(directory)` in the prompt and uses `ls` directly.
- Sub-agents can now execute skill scripts (`python .stigmer/skills/skill-creator/scripts/init_skill.py ...`) instead of manually simulating them.
- Platform tool parity: user-defined sub-agents have the same filesystem and execution capabilities as the general-purpose sub-agent that deepagents auto-creates.
- Graceful degradation preserved: if sandbox creation fails, sub-agents continue with MCP tools only (logged as error).

## Impact

- **Seedpack generation scripts**: `02_draft-agent-creator-skill.sh` and similar scripts that attach directories will produce agents that navigate the workspace without errors on first contact.
- **Skill authors**: Skills that include scripts can now rely on sub-agents executing those scripts, rather than hoping the agent manually replicates their logic.
- **No API or proto changes**: Both fixes are purely in the agent-runner's activity layer and prompt construction.

## Related Work

- Predecessor: `_changelog/2026-03/2026-03-01-043944-fix-localpathsource-agent-sandbox-wiring.md` (sandbox root_dir propagation)
- Sub-agent transformer: `backend/services/agent-runner/worker/activities/graphton/subagent_transformer.py`
- Prompt section builder: `backend/services/agent-runner/worker/activities/execute_graphton.py` (`build_referenced_files_prompt_section`)

---

**Status**: Production Ready
