# Fix Sub-Agent File-Read Delegation and Echo

**Date**: February 26, 2026

## Summary

Added sub-agent delegation rules to the main agent's system prompt and response rules to user-defined sub-agent prompts. Together these prevent the main agent from delegating simple file reads to sub-agents (where contents are lost behind a context boundary) and ensure sub-agents return concise findings instead of echoing raw file contents.

## Problem Statement

When the main agent delegates file reading to a sub-agent via the `task` tool, two things go wrong:

1. **Context boundary loss**: The sub-agent reads files into its own isolated context. The main agent never sees the raw tool results — it only receives the sub-agent's final text response. If the main agent needs raw file contents for decision-making (e.g., creating an agent YAML from documentation), it gets a lossy intermediary instead.

2. **Token waste on both sides**: The sub-agent echoes all file contents into its response (wasting output tokens), and the parent then consumes that wall of text as a tool result (wasting input tokens). Previous prompt-engineering fixes (2026-02-25, 2026-02-23) targeted the main agent's echoing but never reached sub-agents.

### Pain Points

- The deepagents library's task tool description tells the agent: "use [the general-purpose sub-agent] for all tasks" — actively encouraging delegation of file reads
- Sub-agents had zero response-format guidance — no anti-echo rules, no instruction to return findings instead of raw content
- The `general_purpose_agent=True` flag is hardcoded in deepagents, giving every agent a sub-agent with the same tools (including `read`), making over-delegation easy

## Solution

Two-layer defense-in-depth approach:

**Layer 1 — Main agent routing guidance**: A "Sub-agent delegation rules" section in the main agent's system prompt tells it to read files directly and reserve sub-agents for multi-step deliverables.

**Layer 2 — Sub-agent response rules**: Response rules appended to every user-defined sub-agent's system prompt instruct them to return concise findings, not raw file contents.

## Implementation Details

### Layer 1: Main agent system prompt (`execute_graphton.py`)

Added a new `## Sub-agent delegation rules` section after the existing `## Response rules`, with three directives:

- **Read files directly** — use the `read` tool yourself; you need raw contents in your own context
- **Sub-agents are for deliverables** — analysis, synthesis, generated content; not data fetching
- **Specify the deliverable** — tell the sub-agent what analysis you need, not "read these files and give me the contents"

### Layer 2: Sub-agent response rules (`subagent_transformer.py`)

Appended a `## Response rules` section to every user-defined sub-agent's system prompt (after instructions + skills, before the subagent dict is built):

- Never echo file contents after reading
- Return concise findings — the parent has direct file access
- No "Here are the contents" preambles

The general-purpose sub-agent (created by deepagents, not by the transformer) does not receive Layer 2 rules, but Layer 1 prevents the main agent from delegating file reads to it.

## Benefits

- Main agent keeps raw file contents in its own context for accurate reasoning
- Sub-agents return actionable analysis instead of raw dumps
- Reduced token waste on both sides of the context boundary
- Aligns with how Cursor handles sub-agent delegation (explicit "when NOT to use" guidance)

## Impact

- **All agent executions**: Layer 1 rules apply unconditionally to every main agent
- **User-defined sub-agents**: Layer 2 rules apply to all sub-agents defined in agent YAML
- **General-purpose sub-agent**: Addressed indirectly via Layer 1 (main agent won't delegate reads to it)
- **Risk**: Low — additive prompt text only, no logic or API changes

## Related Work

- [Fix Agent File-Content Echo Token Waste](2026-02-25-233958-fix-agent-file-echo-token-waste.md) — prior prompt fix targeting main agent only (superseded for the delegation aspect)
- [Suppress LLM Echo of Attached File Contents](2026-02-23-235004-suppress-llm-echo-of-attached-file-contents.md) — first-generation fix (partial, superseded)
- Future: Expose `task_description` customization in graphton to inject routing guidance directly into the task tool description (deferred post-MVP)

---

**Status**: Production Ready
