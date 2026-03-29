# Cursor-Level Agent Prompt Quality

**Date**: March 29, 2026

## Summary

Elevated Stigmer's agent system prompt from ~8 sections to ~14 sections, closing the gap between Stigmer's agent configuration and Cursor-class coding agents. Added operational protocols (code quality, git safety, verification, context gathering, communication style), tool-specific anti-patterns, and expanded existing capability sections with concrete behavioral instructions.

## Problem Statement

Stigmer's agent, despite using the same Claude Opus 4.6 model as Cursor, exhibited shallower reasoning and less disciplined tool usage. The root cause was twofold: (1) thinking effort was set to `"medium"` instead of `"high"`, and (2) the system prompt lacked the procedural specificity that Cursor's prompt provides — tool-specific anti-patterns, verification loops, code quality rules, and output formatting guidance.

### Pain Points

- Agent reasoning was noticeably shorter and less thorough than Cursor's
- No code quality enforcement in the prompt (no "read before edit", no "fix errors you introduce")
- No git safety rules (agent could force-push or amend pushed commits without guardrails)
- No verification protocol (agent reported completion without checking its work)
- Tool anti-patterns were philosophical ("never give up") rather than actionable ("do not use `cat` — use the `read` tool")
- No communication style guidance (inconsistent response formatting)

## Solution

Five categories of changes across three files, plus updated tests:

1. **Thinking configuration** (committed separately): `DEFAULT_THINKING_EFFORT` changed from `"medium"` to `"high"`, `DEFAULT_THINKING_BUDGET` raised from `10,000` to `16,000`
2. **New prompt sections** added to `prompt_enhancement.py`: Code Quality Protocol, Git Safety Protocol, Verification Protocol, Context Gathering Protocol, Communication Style
3. **Anti-pattern specificity**: Added "Do NOT" lists to `FILESYSTEM_CAPABILITY` and `EXECUTE_CAPABILITY` with tool-specific prohibitions
4. **Expanded existing sections**: Planning protocol with step-by-step workflow, editing protocol with read-before-edit and failure recovery, execute tool with command best practices
5. **Response rules expansion** in `prompt_builder.py`: backtick formatting, code citation, structured output guidance

## Implementation Details

### New Prompt Sections in `prompt_enhancement.py`

| Section | Condition | Purpose |
|---|---|---|
| Code Quality Protocol | `has_sandbox` | Read-before-edit, match existing style, fix errors you introduce, no narrating comments |
| Git Safety Protocol | `has_sandbox` | Never force push, never amend pushed commits, check status first, clear commit messages |
| Verification Protocol | `has_sandbox` | Re-read modified files, run tests, run linters, build verification |
| Context Gathering Protocol | `has_sandbox` | Run `git status` before multi-step work, gather evidence before debugging, map project structure before diving in |
| Communication Style | Always | Backticks for code references, no filler phrases, no emojis, structured responses |

### Enhanced Existing Sections

- **Planning Capability**: Added protocol — create plan before work, one in_progress at a time, mark complete immediately, revise plan when approach changes
- **Filesystem Capability**: Renamed "Editing Efficiency" to "Editing Protocol" with read-before-edit, edit-fail recovery, anti-creation rules. Added "Do NOT" list (no `cat`/`head`/`tail`, no `sed`/`awk`, no `find`)
- **Execute Capability**: Added command best practices (check exit codes, quote paths, chain with `&&`). Added "Do NOT" list (no execute for file ops, no destructive git, no interactive commands)
- **Response Rules**: Added backtick formatting, code citation, structured output, scope-change communication

### Conditional Injection

All operational protocols (code quality, git safety, verification, context gathering) are injected only when `has_sandbox=True` — agents without a sandbox (read-only agents, research agents) get a leaner prompt. Communication Style is always included.

### Prompt Structure (full enhancement, all features enabled)

```
1. Error Recovery Philosophy (resilience preamble)
2. Your Capabilities (planning, filesystem, think, MCP, execute)
3. Code Quality Protocol
4. Git Safety Protocol
5. Verification Protocol
6. Context Gathering Protocol
7. Communication Style
8. File Operation Recovery Strategies
9. MCP Tool Recovery Strategies
10. Command Execution Recovery Strategies
11. Response Rules
12. Sub-agent Delegation Rules
13. Your Task (user instructions)
```

## Benefits

- Agent reasoning depth matches Cursor-class agents (thinking effort `"high"`, budget `16,000`)
- Reduced tool misuse through specific anti-patterns (no more `execute` for file reads)
- Self-correcting agents through verification protocol (run tests, check lints, re-read files)
- Safer git operations with explicit prohibitions on destructive commands
- Consistent response formatting across all agent executions
- Proactive context gathering reduces wasted tool calls

## Impact

- **Agent Runner**: All agent executions using `prompt_enhancement.py` will receive the enhanced prompt
- **Cost**: Higher thinking budget increases per-execution cost but produces substantially higher-quality outputs
- **Backward compatibility**: Fully additive — no existing prompt sections removed or weakened

## Related Work

- Thinking configuration change (Gap 1) was committed separately in `a8f81107`
- Per-turn contextual injection (Gap 4 in the plan) was addressed via prompt-level Context Gathering Protocol rather than architectural graph-level changes — a pragmatic approach that can be deepened later

---

**Status**: ✅ Production Ready
**Timeline**: Single session
