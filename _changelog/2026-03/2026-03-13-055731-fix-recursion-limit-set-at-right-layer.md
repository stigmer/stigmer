# Fix Recursion Limit: Set at the Right Layer

**Date**: March 13, 2026

## Summary

After 4 failed iterations of controlling LangGraph's `recursion_limit` via
`.with_config()`, root-caused the issue to setting the limit at the wrong
abstraction layer. Fixed by setting the limit at two authoritative points:
the `LANGGRAPH_DEFAULT_RECURSION_LIMIT` environment variable (framework-wide)
and the invoke config passed directly to `astream_events()` (highest priority
in the merge chain).

## Problem Statement

Every attempt to control the recursion limit via `.with_config()` failed:

| Session | Approach | Result |
|---------|----------|--------|
| 7 | `with_config(recursion_limit=1000)` | 300 events |
| 8 | `with_config(recursion_limit=6000)` | 3990 events |
| 9 | Skip `with_config` (rely on framework default) | 700 events |
| 10 | `with_config(recursion_limit=10_000_000)` | 1197 events |

The results were inconsistent and unpredictable because `.with_config()` sets
the limit on a `RunnableBinding`, which then passes through multiple
`merge_configs` calls, `ensure_config()` defaults, and context variable
overrides before reaching Pregel's actual execution loop.

### Pain Points

- Zero visibility into what `recursion_limit` Pregel was actually using
- DeepAgents internally calls `.with_config({"recursion_limit": 1000})`,
  adding another layer to the merge chain
- No diagnostic logging of the original `GraphRecursionError` message
  (which includes the actual limit value)

## Solution

Set the limit at two authoritative points that bypass the `merge_configs` chain:

### Layer 1: Environment Variable (framework-wide)

Set `LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000` in the agent-runner environment
via `buildAgentRunnerEnv()` in `daemon_process.go`. LangGraph reads this at
import time, changing the default for ALL graphs in the process (including
deepagents' subagent graphs).

### Layer 2: Invoke Config (highest priority)

Pass `recursion_limit` directly in the config dict given to `astream_events()`
in `execute_graphton.py`. The invoke config is the LAST config processed by
LangGraph's `merge_configs` — it has absolute priority over any `.with_config()`
bindings.

### Layer 3: Diagnostic Logging

Enhanced the `GraphRecursionError` handler to log the invoke config's
`effective_recursion_limit` alongside the original error (which includes
Pregel's actual limit), enabling comparison of "what we set" vs "what hit".

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/daemon/daemon_process.go` | Add `LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000` to `buildAgentRunnerEnv()` |
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Pass `recursion_limit` in invoke config; enhanced error logging |
| `design-decisions/001-recursion-limit-value.md` | Session 11 revision documenting the layer-based approach |

### Key Insight

LangGraph is designed so that the **invoke config** (passed to `stream()` /
`astream_events()`) is the caller's authoritative override. `.with_config()`
is meant for setting defaults on a runnable, not for authoritative overrides.
When multiple `.with_config()` layers are chained (as happens with deepagents +
graphton), the merge behavior becomes non-deterministic from the caller's
perspective.

## Benefits

- Recursion limit is set at the right abstraction layer (invoke + env var)
- Immune to `merge_configs` stripping, context variable overrides, and
  nested `RunnableBinding` chains
- Diagnostic logging reveals the actual limit Pregel uses if the error
  ever fires again
- Framework-wide env var covers subagent graphs automatically

## Impact

- **All agent executions**: Effectively unlimited (10M super-steps via both
  env var and invoke config)
- **Diagnostic visibility**: `GraphRecursionError` now logs both the requested
  and actual limits
- **CLI rebuild required**: The env var is in Go code, so `make release-local`
  is needed to pick it up

## Related Work

- Sessions 7-10 of the recursion limit saga
- Part of "Agent Execution Consistency Guardrails" project (20260312.01)

---

**Status**: Production Ready
