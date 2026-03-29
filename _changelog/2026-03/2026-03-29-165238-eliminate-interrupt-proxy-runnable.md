# Eliminate InterruptProxyRunnable — Use LangGraph Native Sub-Agent Support

**Date**: March 29, 2026

## Summary

Removed the custom `InterruptProxyRunnable` class and `compile_subagent_with_proxy()` function, replacing them with LangGraph's native per-invocation subgraph interrupt propagation. This eliminates 518 net lines of proxy machinery, resolves the concurrent sub-agent deadlock, and unifies the interrupt value shape across root-agent and sub-agent tools.

## Problem Statement

The `InterruptProxyRunnable` was a custom wrapper that intercepted sub-agent `interrupt()` calls, checkpointed them in a per-instance `MemorySaver`, and re-surfaced them to the parent graph via proxy payloads. This approach was built before understanding that LangGraph natively supports this exact pattern.

### Pain Points

- **Deadlock under concurrency**: Shared `MemorySaver` and `_thread_counter` across concurrent sub-agent invocations caused checkpoint contention and permanent approval deadlocks
- **Dual interrupt shapes**: The proxy introduced a nested `{sub_id: {tool_call_id, _proxy_interrupt_id}}` shape that every downstream consumer (resume logic, HITL helpers, StatusBuilder) had to handle alongside the direct `{tool_call_id, message}` shape
- **Complex resume logic**: `execute_graphton.py` needed ~100 lines of branching to handle direct vs. proxied interrupt matching, plus a bidirectional fallback for both shapes
- **Unnecessary abstraction**: LangGraph's `checkpointer=None` per-invocation mode already provides checkpoint inheritance, interrupt propagation, and `checkpoint_ns` isolation — exactly what the proxy was manually reimplementing

## Solution

Compile sub-agents with `checkpointer=None` (the default from `create_agent`), letting LangGraph handle checkpoint inheritance natively. Sub-agent `interrupt()` calls propagate directly to the parent checkpoint with the same shape as root-agent tools. `SubAgentGate` concurrency limiting is preserved.

## Implementation Details

**Phase 0 — Verification**: Wrote 5 tests confirming LangGraph native behavior:
1. Interrupt propagation from sub-agent to parent with resume
2. Concurrent invocations complete without deadlock
3. Interrupts propagate through `try/finally` (SubAgentGate pattern)
4. Streaming events carry sub-agent namespace metadata
5. Interrupt value shape is direct (no proxy wrapping)

**Phase 1 — Replacement**:
- Created `compile_subagent()` — same guardrail middleware injection (loop detection, truncation, budget), but no `MemorySaver` or proxy wrapping
- Updated `agent.py` HITL path (2 call sites) to use `compile_subagent()`
- Simplified `hitl.py::extract_interrupt_tool_call_ids` — removed nested proxy iteration
- Simplified `execute_graphton.py` resume matching — single direct-shape loop, removed ~85 lines of proxy branching

**Phase 2 — Test Updates**:
- Replaced `TestProxyInterruptResume` with `TestDirectInterruptResume`
- Deleted `TestInterruptProxyThreadManagement` and its `_FakeGraph`/`_FakeState` helpers
- Updated mock patches in 4 test files (`test_recursion_limit`, `test_summarization_middleware`, `test_subagent_model_routing`, `test_interrupt_proxy_guardrails`)

## Benefits

- **-518 net lines** (762 deleted, 244 added) across 10 files
- **Zero proxy code paths** — no `_proxy_interrupt_id`, no `_build_proxy_payload`, no `_thread_counter`
- **Single interrupt shape** — all consumers handle one format
- **Deadlock eliminated** — LangGraph assigns distinct `checkpoint_ns` per sub-agent invocation
- **2,709 tests pass** (1,342 graphton + 1,367 agent-runner)

## Impact

- **agent.py**: HITL sub-agent compilation path simplified
- **execute_graphton.py**: Resume logic reduced from ~150 lines to ~60 lines
- **hitl.py**: Interrupt extraction reduced from 22 lines to 10 lines
- **StatusBuilder hardening**: Unblocks T03 (namespace-based sub-agent event routing) by guaranteeing consistent `checkpoint_ns` metadata

## Related Work

- StatusBuilder Hardening project (T02 research → T03 implementation)
- Prior fixes: `fix-interrupt-proxy-callback-context`, `fix-subagent-duplication-on-hitl-resume`, `fix-sub-agent-approval-deadlock`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
