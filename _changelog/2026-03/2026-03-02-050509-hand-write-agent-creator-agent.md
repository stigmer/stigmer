# Hand-Write the Agent-Creator Agent

**Date**: March 2, 2026

## Summary

Replaced the LLM-generated agent-creator agent YAML with a hand-maintained version following the same pattern as the skill-creator agent. This eliminates the non-deterministic generation script dependency and gives the team full ownership of this foundational system agent.

## Problem Statement

The agent-creator agent (`seedpack/agents/agent-creator.yaml`) was produced by running `stigmer draft agent` via a shell script (`03_draft-agent-creator-agent.sh`). This script required a running stigmer server, an `ANTHROPIC_API_KEY`, and produced non-deterministic output every time it ran.

### Pain Points

- Non-deterministic: each regeneration could produce different instructions, making code review meaningless
- Fragile dependency chain: required a running server + LLM provider just to maintain a YAML file
- Generic instructions: the LLM output lacked runtime-specific conventions (path schemes, `OUTPUT_DIR`, tool invocation patterns) that make the skill-creator agent effective
- Inconsistent metadata: missing `org: local`, wrong field ordering in resource references

## Solution

Hand-write the agent-creator agent YAML, modeled after the skill-creator agent (the established hand-maintained reference pattern). Delete the generation script and update `regenerate_all.sh` to note the agent is hand-maintained.

## Implementation Details

### Agent YAML (`seedpack/agents/agent-creator.yaml`)

Rewrote from 92 lines to 154 lines with the following structure:

1. **Before You Begin** -- directs the agent to read its bundled skill and follow the four-phase methodology
2. **Runtime Path Conventions** -- concrete paths for reading skill references and invoking MCP discovery tools
3. **Workflow** (5 steps) -- Gather Intent, Discover Real Resources, Draft the YAML, Validate, Present and Explain
4. **Key Principles** -- verify before referencing, minimal but complete, clear instructions, always summarize
5. **Output Rules** -- Agent YAML only, valid references only, file naming convention

Key additions:
- `org: local` in metadata for consistency with mcp-server-creator
- `env_spec` with `OUTPUT_DIR` (matching skill-creator's pattern)
- Canonical `org`, `kind`, `slug` field ordering in all resource references
- Explicit guidance on silent failure modes (tool name typos, invalid slugs)

### Deleted Files

- `seedpack/tools/03_draft-agent-creator-agent.sh` -- replaced by the hand-written YAML

### Updated Files

- `seedpack/tools/regenerate_all.sh` -- removed script invocation, added hand-maintained note alongside skill-creator

### Architectural Decisions

1. **No apply capability**: The agent keeps only read-only MCP tools (`search`, `get_agent`, `get_mcp_server`, `get_skill`, `get_workflow`). Write tools (`apply_agent`) are deliberately excluded for safety -- the user reviews the YAML before applying.
2. **Skill untouched**: The agent-creator skill (`seedpack/skills/agent-creator/`) was left as-is. The skill contains the domain knowledge (schema, examples, validation rules); the agent YAML defines runtime behavior.

## Benefits

- Deterministic: the YAML is version-controlled, reviewable, and stable
- No external dependencies for maintenance
- Richer instructions with runtime-specific conventions that improve agent behavior
- Consistent patterns across the two hand-maintained agents (skill-creator, agent-creator)

## Impact

- **Seedpack**: agent-creator agent is now hand-maintained like skill-creator
- **Tests**: all 4 seedpack tests pass (`TestExtractToDir`, `TestExtractToDir_ProducesApplyableProject`, `TestContentHash_Deterministic`, `TestContentHash_NonEmpty`)
- **regenerate_all.sh**: now skips the agent-creator agent script (runs 3 scripts instead of 4)

## Related Work

- skill-creator agent (the reference pattern this follows)
- mcp-server-creator agent (still LLM-generated; candidate for same treatment as a follow-up)
- Agent-creator skill (out of scope, left untouched)

---

**Status**: Production Ready
