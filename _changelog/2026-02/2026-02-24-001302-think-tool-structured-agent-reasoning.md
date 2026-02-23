# Think Tool: Structured Agent Reasoning

**Date**: February 24, 2026

## Summary

Added a `think` tool to the graphton library that gives every agent a dedicated, observable mechanism for structured reasoning. The tool follows Anthropic's "think tool" pattern — a no-op that accepts a thought string and returns an acknowledgment, letting the LLM externalise reasoning as a regular tool call. This makes agent reasoning visible through the existing status pipeline without any special handling.

## Problem Statement

When agents face complex tasks — analysing multiple files, choosing between implementation strategies, or debugging failures — they have no structured way to reason before acting. The LLM either reasons implicitly (invisible to the platform and user) or dumps its reasoning into assistant text (cluttering the output and wasting tokens).

### Pain Points

- Agent reasoning is invisible — users and the platform have no insight into why an agent chose a particular approach
- No structured pause-and-think mechanism — agents jump straight from reading files to writing code without observable deliberation
- Token waste — when agents do reason aloud, it appears as verbose assistant text rather than a compact tool call
- Model-agnostic gap — Anthropic offers native extended thinking, but agents using OpenAI or Ollama models have no equivalent

## Solution

Introduced a `think` tool at the graphton library level, auto-injected into every agent created via `create_deep_agent()`. The tool is:

- **No-op**: Accepts a `thought` string, returns `"ok"`. Zero side effects.
- **Observable**: The thought text appears as `ToolCall.args.thought` in the existing status pipeline (status builder, gRPC updates, CLI rendering).
- **Model-agnostic**: Works with Claude, GPT, Ollama, or any future model.
- **Inherited by sub-agents**: deepagents' `SubAgentMiddleware` passes top-level tools as defaults to sub-agents.

## Implementation Details

### New Module: `graphton/core/think_tool.py`

Factory function `create_think_tool()` returns a `@tool`-decorated async function. The tool description provides domain-specific guidance on when to use it — after reading files, before complex operations, when debugging, when choosing strategies. The description explicitly tells the LLM NOT to use it for every step, only when genuine reasoning improves outcome quality.

### Auto-Injection in `create_deep_agent()`

The think tool is appended to `tools_list` unconditionally in `agent.py`, following the same pattern as loop detection middleware injection. Because `tools_list` is passed as `default_tools` to deepagents' `SubAgentMiddleware`, the think tool is available to the top-level agent and all sub-agents that don't override their tools.

### System Prompt Guidance

A `THINK_CAPABILITY` section was added to `prompt_enhancement.py`, always included alongside planning and filesystem capabilities. It provides concise, domain-specific usage guidance.

### Approval Policy

The think tool is explicitly exempted from approval in `PLATFORM_TOOL_DEFAULTS` under a new "Agent-internal tools" category, documenting the intent even though the fallback chain would resolve to no-approval by default.

### Test Coverage

Two new tests added to `test_prompt_enhancement.py`: content validation for the `THINK_CAPABILITY` constant, and verification that think tool guidance is always included in the enhanced prompt. One existing test updated to assert think tool presence. All 29 tests pass.

## Benefits

- **Reasoning visibility**: Platform operators and users can see what the agent was thinking before it acted
- **Better agent decisions**: Structured reasoning before action improves quality of multi-step operations
- **Token efficiency**: Thoughts are compact tool calls, not verbose assistant messages
- **Model-agnostic**: Works across all LLM providers, not just Anthropic
- **Zero overhead for simple tasks**: The LLM only calls `think` when it judges reasoning will help — no mandatory cost per turn
- **Sub-agent coverage**: Every agent in the system gets the capability automatically

## Impact

- **All agents**: Every agent created via graphton's `create_deep_agent()` now has the think tool available
- **Status pipeline**: Think tool calls flow through the existing event/status pipeline with zero changes to status builder, gRPC updates, or event processing
- **CLI**: Renders via existing "unknown tool" fallback (`🔧 think: <thought snippet>`). Dedicated UX treatment planned for Phase 3.

## Related Work

- Phase 1 (same project): Suppressed LLM echo of attached file contents
- Phase 3 (upcoming): CLI UX rendering for think tool calls
- Future phase: Enable Anthropic's native extended thinking (`thinking` parameter on `ChatAnthropic`)

---

**Status**: ✅ Production Ready
**Timeline**: Phase 2 of agent-thinking-flow project
