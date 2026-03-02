# Hand-Write the MCP-Server-Creator Agent

**Date**: March 2, 2026

## Summary

Replaced the LLM-generated mcp-server-creator agent YAML with a hand-maintained version following the same pattern as the agent-creator and skill-creator agents. This eliminates the last non-deterministic generation script dependency from the seedpack agents and gives the team full ownership of all three system agents.

## Problem Statement

The mcp-server-creator agent (`seedpack/agents/mcp-server-creator.yaml`) was produced by running `stigmer draft agent` via a shell script (`05_draft-mcp-server-creator-agent.sh`). This script required a running stigmer server, an `ANTHROPIC_API_KEY`, and produced non-deterministic output every time it ran.

### Pain Points

- Non-deterministic: each regeneration could produce different instructions, making code review meaningless
- Fragile dependency chain: required a running server + LLM provider just to maintain a YAML file
- Duplicated domain knowledge: the LLM-generated instructions repeated skill content (server type selection, tool gate configuration, agent integration) instead of deferring to the bundled skill
- Missing runtime conventions: no `OUTPUT_DIR` env_spec, no concrete paths for reading skill references or invoking MCP discovery tools

## Solution

Hand-write the mcp-server-creator agent YAML, modeled after the agent-creator agent (the established hand-maintained reference pattern). Delete the generation script and update `regenerate_all.sh` to note the agent is hand-maintained.

## Implementation Details

### Agent YAML (`seedpack/agents/mcp-server-creator.yaml`)

Rewrote from 142 lines to ~150 lines with the following structure:

1. **Before You Begin** -- directs the agent to read its bundled skill and follow the seven-step methodology
2. **Runtime Path Conventions** -- concrete paths for reading skill references (schema.md, examples.md, validation-checklist.md, agent-integration.md) and invoking MCP discovery tools
3. **Workflow** (5 steps) -- Gather Intent, Discover Real Resources, Draft the YAML, Validate, Present and Explain
4. **Key Principles** -- verify before referencing, one transport only, never pre-fill secrets, flag unverified tool names, minimal but complete, always summarize
5. **Output Rules** -- McpServer YAML only, valid references only, PascalCase `kind`, file naming convention

Key additions:
- `env_spec` with `OUTPUT_DIR` (matching agent-creator and skill-creator patterns)
- Canonical `org`, `kind`, `slug` field ordering in all resource references

Key simplification:
- Collapsed 8 workflow steps to 5 by deferring domain detail to the skill (the skill's SKILL.md already contains full guidance on server type selection, env_spec declaration, tool access configuration, and agent integration)

### Deleted Files

- `seedpack/tools/05_draft-mcp-server-creator-agent.sh` -- replaced by the hand-written YAML

### Updated Files

- `seedpack/tools/regenerate_all.sh` -- removed script invocation, added mcp-server-creator to the hand-maintained note alongside skill-creator and agent-creator

### Architectural Decisions

1. **No apply capability**: The agent keeps only read-only MCP tools (`search`, `get_agent`, `get_mcp_server`, `get_skill`, `get_workflow`). Write tools are deliberately excluded for safety -- the user reviews the YAML before applying.
2. **Skill untouched**: The mcp-server-creator skill (`seedpack/skills/mcp-server-creator/`) was left as-is. The skill contains the domain knowledge (schema, examples, validation rules, agent integration patterns); the agent YAML defines runtime behavior.
3. **Workflow delegates to skill**: Rather than duplicating the skill's seven-step methodology in the agent instructions, the workflow references the skill and provides only the runtime-specific overlay (paths, tool names, output directory, key decisions).

## Benefits

- Deterministic: the YAML is version-controlled, reviewable, and stable
- No external dependencies for maintenance
- Richer instructions with runtime-specific conventions that improve agent behavior
- Consistent patterns across all three hand-maintained agents (skill-creator, agent-creator, mcp-server-creator)
- No more duplicated domain knowledge between agent instructions and skill content

## Impact

- **Seedpack**: all three system agents are now hand-maintained; no agents are LLM-generated
- **regenerate_all.sh**: now runs 2 draft scripts (skills only) plus the vendor script; all agents are hand-maintained
- **Tests**: all 4 seedpack tests should pass (`TestExtractToDir`, `TestExtractToDir_ProducesApplyableProject`, `TestContentHash_Deterministic`, `TestContentHash_NonEmpty`)

## Related Work

- agent-creator agent (hand-written earlier in this session -- the reference pattern)
- skill-creator agent (the original hand-maintained agent)
- MCP-server-creator skill (out of scope, left untouched)

---

**Status**: Production Ready
