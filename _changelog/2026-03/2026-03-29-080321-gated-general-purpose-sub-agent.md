# Gated General-Purpose Sub-Agent

**Date**: March 29, 2026

## Summary

Fixed a production crash where `deepagents_create_deep_agent()` received an unsupported `general_purpose_agent=False` keyword argument, and replaced the broken approach with the correct mechanism: injecting an explicit gated "general-purpose" `CompiledSubAgent` that goes through the same `InterruptProxyRunnable` + `SubAgentGate` pipeline as all other sub-agents. This prevents deepagents from auto-creating its ungated clone while preserving the general-purpose delegation capability under controlled concurrency.

## Problem Statement

The `2026-03-29-042152-fix-excessive-sub-agent-spawning` change attempted to disable deepagents' internal general-purpose sub-agent by passing `general_purpose_agent=False` to `deepagents_create_deep_agent()`. This parameter does not exist in the deepagents API (tested against 0.4.0 through 0.4.12). Every agent execution crashed with `TypeError: create_deep_agent() got an unexpected keyword argument 'general_purpose_agent'`.

### Pain Points

- All agent executions failed immediately at agent creation — zero successful runs after deployment
- The `general_purpose_agent` parameter was never part of the deepagents library; the changelog assumed it existed
- The original intent (preventing ungated sub-agent spawning) was correct, but the mechanism was wrong
- deepagents' internal general-purpose sub-agent bypassed Graphton's `SubAgentGate` concurrency limiter because it was compiled inside deepagents, not through Graphton's HITL pipeline

## Solution

Leveraged deepagents' documented naming convention: "If no subagent named `general-purpose` is provided, a default general-purpose synchronous subagent is added automatically." By providing an explicit `CompiledSubAgent` with `name="general-purpose"` compiled through Graphton's gated pipeline, deepagents skips its automatic ungated clone creation.

## Implementation Details

### Restructured sub-agent processing in `agent.py`

The previous structure nested the HITL check inside `if subagents is not None:`, meaning agents without explicit sub-agents (the common production case) never entered the HITL compilation path. Restructured to check HITL conditions (`checkpointer` + `approval_checker`) at the outer level:

1. **HITL path** (checkpointer + approval_checker present): Creates a `SubAgentGate`, compiles any explicit sub-agents through `compile_subagent_with_proxy()` + `gate.wrap()`, then injects a gated general-purpose sub-agent with the same model, tools, and system prompt as the main agent.

2. **Non-HITL path**: Unchanged. deepagents auto-creates its general-purpose agent (ungated), which is acceptable for non-HITL usage.

The general-purpose sub-agent is compiled via `compile_subagent_with_proxy()`, which uses `create_agent()` (not `create_deep_agent()`). This means it gets all platform tools but no `task` tool — it cannot recursively spawn sub-sub-agents, matching Cursor's pattern for sub-agent delegation control.

### Removed invalid kwarg

Removed `general_purpose_agent=False` from the `deepagents_create_deep_agent()` call. The explicit "general-purpose" `CompiledSubAgent` in `transformed_subagents` now serves as the override mechanism.

### Controlled by existing `general_purpose_agent` parameter

Graphton's `create_deep_agent()` already accepted `general_purpose_agent: bool = True`. This parameter now controls whether the gated general-purpose sub-agent is injected in the HITL path. Setting it to `False` skips injection (deepagents may auto-create an ungated one in that case).

### Tests

- Updated `test_subagents_passed_directly` → `test_subagents_passed_directly_non_hitl` to verify non-HITL passthrough
- Added `test_general_purpose_agent_not_forwarded_to_deepagents` — verifies the invalid kwarg is never sent
- Added 6 tests in `TestGatedGeneralPurposeSubAgent`:
  - HITL with `subagents=None`: single "general-purpose" CompiledSubAgent injected
  - HITL with explicit sub-agents: "general-purpose" appended alongside them
  - Non-HITL path: no injection (deepagents handles it)
  - `general_purpose_agent=False`: no injection
  - Model and prompt forwarding: uses main agent's model and system_prompt
  - Shared gate: explicit and general-purpose sub-agents share the same `SubAgentGate` instance
- Updated 3 tests in `test_subagent_model_routing.py` for additional compile call
- Updated 3 tests in `test_summarization_middleware.py` for additional compile call and middleware instance

## Benefits

- **Production unblocked**: Removes the `TypeError` crash that broke all agent executions
- **Gated delegation**: The general-purpose sub-agent now shares the `SubAgentGate` semaphore (max 3 concurrent) with all other sub-agents
- **HITL compliance**: General-purpose sub-agent tool calls go through `InterruptProxyRunnable` for approval proxying
- **No recursive delegation**: Sub-agent compiled via `create_agent()` has no `task` tool — cannot spawn sub-sub-agents
- **Backward compatible**: Non-HITL path unchanged; agents with explicit sub-agents work exactly as before

## Impact

- **Agent Runner**: All agent executions in HITL mode now have a gated general-purpose sub-agent
- **Sub-agent spawning**: The concurrency gate applies uniformly — no more ungated bypass path
- **Test coverage**: 1251 tests pass, 0 failures, ruff lint clean

## Related Work

- `2026-03-29-042152-fix-excessive-sub-agent-spawning.md` — introduced the broken `general_purpose_agent=False` kwarg; the concurrency gate and prompt rules from that change remain intact
- `2026-03-12-055358-improve-sub-agent-subject-differentiation-and-concurrency-cap.md` — original concurrency cap concept

---

**Status**: Production Ready
**Timeline**: Single session
