# Composite Domain Agents: Skills Meet MCP Servers

**Date**: April 10, 2026

## Summary

Created 5 composite domain agents that pair self-composed skills with curated MCP servers, establishing the first non-meta agents in the seedpack. These agents demonstrate how Stigmer's skill + tool composition model works: the skill provides domain methodology, the MCP servers provide tool access, and the agent instructions add identity and behavioral guardrails. The seedpack now has 9 agents total.

## Problem Statement

The seedpack had 4 agents — all focused on platform authoring (assistant, agent-creator, skill-creator, mcp-server-creator). None demonstrated how skills and MCP servers compose into domain-specific agents, which is the core value proposition of Stigmer's agentic layer.

### Pain Points

- No seedpack examples of skill + MCP server composition for end users to reference
- No domain-specific agents (support, code review, documentation, research, data analysis) despite having both the skills and the MCP servers available
- The agent layer of the skills marketplace had zero content — skills and MCP servers existed independently with no bridge

## Solution

Created 5 agents in `seedpack/agents/` that pair domain skills (from Task 2) with curated MCP servers (from the companion MCP marketplace project):

| Agent | Skill | MCP Servers |
|-------|-------|-------------|
| `code-review-agent` | code-reviewer | GitHub |
| `data-analyst-agent` | data-analyst | Postgres |
| `docs-agent` | technical-writer | GitHub, Filesystem |
| `support-agent` | customer-support | Slack, Linear |
| `research-agent` | research-analyst | Brave Search, Exa, Fetch |

## Implementation Details

Investigated the Agent Runner codebase before designing the agents. Key finding: the runtime already handles skill activation (`SkillWriter` generates "Available Skills" prompt section with activation paths) and tool injection (MCP tools registered as LangGraph tool wrappers). This meant agent instructions could be lean (~15 lines each) — carrying only identity, behavioral guardrails, and output expectations.

Design decisions:
- **No `enabled_tools`**: Use MCP server defaults. Tool discovery hasn't been run, so listing unverified tool names risks silent runtime failures.
- **No `env_spec` on agents**: MCP servers declare their own env vars. No duplication.
- **System label**: All agents ship with `stigmer.ai/system: "true"` as part of the seedpack.
- **5 agents (not 4)**: Expanded the original plan to include `data-analyst-agent` because the Postgres pairing is a strong, immediately useful use case.

Each agent's instructions focus on a few key behavioral guardrails the skill doesn't cover:
- **code-review-agent**: never approve/merge without explicit request
- **data-analyst-agent**: inspect schema first, read-only by default
- **docs-agent**: verify against source code, don't mix document types
- **support-agent**: every conversation gets closure, create tickets for follow-ups
- **research-agent**: cross-reference sources, flag training data, surface contradictions

## Benefits

- **Skills marketplace completeness**: The seedpack now demonstrates the full composition model (skill + MCP server + agent) with 5 concrete examples
- **Immediate utility**: These agents are usable out of the box for common workflows — code review, documentation, research, data analysis, customer support
- **Low maintenance**: Lean instructions (~15 lines) with no duplication of skill methodology or tool descriptions reduces update burden
- **Pattern establishment**: Future agents (by the team or by users) can follow this pattern: compose a skill + MCP servers, add a thin layer of behavioral guardrails

## Impact

- Seedpack grows from 4 agents to 9 (1 general-purpose + 3 meta-authoring + 5 domain)
- Completes the curated skills marketplace project (all 3 tasks done)
- Establishes the agent composition pattern for the platform

## Related Work

- Companion project `20260410.01.curated-mcp-marketplace` provided the 36 curated MCP server definitions
- Task 1 of this project vendored 7 skills from `anthropics/skills`
- Task 2 self-composed 5 domain skills (customer-support, code-reviewer, technical-writer, data-analyst, research-analyst)

---

**Status**: Production Ready (pending `stigmer seedpack apply` validation)
**Timeline**: ~1 hour (Task 3 of a 3-task project)
