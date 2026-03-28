# Fix Excessive Sub-Agent Spawning and Orphaned Execution

**Date**: March 29, 2026

## Summary

Sub-agents were spawning unboundedly (10-20+ in a single turn) and appearing stuck in "Running" state in the UI. Three root causes were identified and fixed: the March 12 concurrency cap was silently lost during a refactor, deepagents' internal general-purpose sub-agent bypassed all controls, and the streaming error handler left sub-agents orphaned on non-standard exceptions.

## Problem Statement

Production users observed the main agent firing off 10-20+ sub-agents for tasks that didn't warrant delegation (e.g., reading files, simple lookups). Sub-agents appeared stuck in "Running" state in the UI while the parent execution continued without incorporating their output.

### Pain Points

- Users see 15+ sub-agent entries with identical or near-identical names
- Sub-agents stuck in "Running" state with no visible output or completion
- Excessive token consumption from parallel sub-agent context windows
- No runtime enforcement — the model could ignore soft prompt constraints at will
- The concurrency cap added on March 12 was lost during a modularization refactor on March 26

## Solution

Three-layer fix covering runtime enforcement, prompt-level guidance, and status tracking:

1. **Runtime concurrency gate** — a shared `asyncio.Semaphore` that non-blocking rejects excess sub-agent invocations (max 3 concurrent)
2. **Comprehensive prompt rules** — restored and enhanced the lost sub-agent delegation rules with explicit "when NOT to delegate" and "when TO delegate" guidance
3. **Disabled ungated general-purpose agent** — deepagents' internal clone bypassed all controls; now explicitly disabled
4. **Error path finalization** — generic streaming exceptions now finalize active sub-agents before re-raising

## Implementation Details

### Runtime concurrency gate (`subagent_limiter.py`)

New `SubAgentGate` class with a shared `asyncio.Semaphore(3)`. Each sub-agent runnable is wrapped via `gate.wrap()` in a `_GatedRunnable` that:
- Tries non-blocking acquire on `ainvoke`
- If acquired: delegates to inner runnable, releases in `finally`
- If full: returns immediately with an error dict that deepagents translates to a ToolMessage telling the LLM "Maximum 3 concurrent sub-agents reached. Wait for active sub-agents to finish."

Integrated into the HITL compilation path in `agent.py` — every compiled sub-agent runnable is wrapped with the gate before being passed to deepagents.

### Prompt rules rewrite (`prompt_builder.py`)

The `_SUB_AGENT_RULES` constant was rewritten from 3 generic bullets to comprehensive guidance with:
- **Concurrency limit** section: max 3, batch sequential rounds
- **When NOT to delegate**: reading files, single-step lookups, data needed in own context, tasks under 3 steps
- **When TO delegate**: multi-step deliverables, parallel exploration, context isolation
- **Delegation best practices**: specify deliverables, synthesize results, cost awareness
- **Runtime enforcement notice**: tells the LLM the limit is enforced

### Disabled general-purpose agent (`agent.py`)

`general_purpose_agent=False` now passed to `deepagents_create_deep_agent()`. Previously this parameter was accepted by graphton but never forwarded — deepagents always created an ungated clone of the main agent. Agents needing delegation must define explicit sub-agents via `AgentSpec.sub_agents` (which go through the gated path).

### Streaming error finalization (`streaming.py`)

The generic `except Exception` handler in the streaming loop now calls `finalize_active_sub_agents(SUB_AGENT_FAILED)` before re-raising. Previously, only `_handle_stall` and `_handle_recursion_limit` finalized sub-agents — non-standard exceptions left sub-agents orphaned in "Running" state.

### Root cause of lost cap

The March 12 commit `e48cacc7` added the "max 4 concurrent" cap directly inline in `execute_graphton.py`. The March 26 modularization refactor `479016e2` extracted prompt logic into `prompt_builder.py` but only copied the original 3 bullets — silently dropping the concurrency cap, "When NOT to delegate" rules, and "Delegation best practices" section.

## Benefits

- **Hard runtime limit**: LLM cannot bypass the 3-concurrent cap regardless of prompt adherence
- **Immediate feedback**: rejected sub-agents return clear error messages so the LLM self-corrects
- **No orphaned state**: sub-agents always reach a terminal status (COMPLETED, FAILED, or CANCELLED)
- **Regression guard**: 11 tests on `_SUB_AGENT_RULES` content ensure the rules can't be silently dropped again
- **7 unit tests** on the concurrency gate covering limit enforcement, exception safety, and sequential reuse

## Impact

- **End users**: dramatically fewer sub-agents spawned per execution, no more "Running" ghosts in the UI
- **Token cost**: bounded by max 3 concurrent sub-agent context windows instead of unbounded
- **Agent behavior**: only agents with explicitly defined `sub_agents` can delegate (no more general-purpose clone)
- **Backward compatible**: agents without `sub_agents` in their spec simply lose the `task` tool (desired — prevents unnecessary delegation)

## Related Work

- `2026-03-12-055358-improve-sub-agent-subject-differentiation-and-concurrency-cap.md` — original concurrency cap (lost in refactor)
- `2026-03-12-051220-propagate-summarization-middleware-to-sub-agents.md` — sub-agent context management
- `2026-03-12-105522-fix-recursion-limit-10x-inflation.md` — recursion limit and sub-agent cancellation
- `2026-03-11-171855-fix-sub-agent-approval-deadlock.md` — InterruptProxyRunnable for HITL approval

---

**Status**: ✅ Production Ready
