# Task T01: StatusBuilder Simplification — Reducer Pattern Refactor

**Created**: 2026-03-29 14:40
**Revised**: 2026-03-29 19:30
**Status**: PENDING REVIEW
**Type**: Simplification
**Revision**: v2 — rewritten from "gap-driven hardening" to "reducer pattern simplification"

⚠️ **This plan requires your review before execution**

## Why This Revision

The v1 plan framed the project as "hardening" — protecting 30 dictionaries with assertions, adding idempotency guards, then decomposing. Through design review, we established that:

1. The 30 dictionaries are not architecture to protect — roughly half are compensating complexity from wrong modeling choices
2. The core job is simple: LangGraph events in → protobuf status out. This is a solved problem (reducer/event-sourcing pattern)
3. The right approach is: eliminate the unnecessary complexity first, then restructure what remains using a proper state model

The v1 tasks (T02–T09) mapped to "gaps." The v2 tasks map to "what to delete, what to keep, how to restructure."

## The State of Things

### What StatusBuilder does
LangGraph streams thousands of events per execution (every token is an event). StatusBuilder processes each event and builds an `AgentExecutionStatus` protobuf. The proto is flushed to the database via gRPC every ~500ms for real-time UI updates.

### Why in-memory state exists
Event volume is too high for per-event DB writes. The proto is the in-memory "database." Dictionaries are indexes on the proto for O(1) lookup (protobuf repeated fields are arrays without key-based access).

### What's wrong
~30 dictionaries grew organically. About half are genuine indexes (~5) and streaming buffers (~5). The other ~20 are compensating complexity:
- Fingerprint dedup system (~5 dicts) — exists because we matched tool calls by SHA256 of args instead of by tool_call_id
- Namespace routing heuristics (~4 dicts) — exists because we didn't inject identity into sub-graph construction
- Resume reconciliation state (~4 dicts) — exists because fingerprint dedup is fragile on the resume path
- Miscellaneous workarounds (~3 dicts) — each patch for an edge case

### The target state
An explicit `ExecutionState` with ~10-12 named fields:

```python
@dataclass
class ExecutionState:
    proto: AgentExecutionStatus

    # Indexes into proto (O(1) lookup for event routing)
    tool_calls: dict[str, ToolCall]              # tool_call_id → proto ref
    messages_by_run: dict[str, AgentMessage]      # llm_run_id → message being streamed
    current_ai_message: dict[str, AgentMessage]   # namespace → current AI msg

    # Sub-agent routing
    active_sub_agents: dict[str, SubAgentExecution]  # run_id → sub-agent execution
    completed_sub_agents: dict[str, SubAgentExecution]
    namespace_to_sub_agent: dict[str, str]           # namespace_root → run_id

    # Streaming buffers (accumulate partial data before flushing to proto)
    thinking_buffers: dict[str, str]             # namespace → accumulated thinking text
    tool_input_buffers: dict[str, str]           # tool_call_id → accumulated JSON

    # Timing (for duration_ms calculation)
    tool_start_times: dict[str, datetime]        # tool_call_id → start time
    message_start_times: dict[str, datetime]     # run_id → start time

    # Approval state (inherent to HITL)
    pending_approvals: list[str]                 # run_ids awaiting approval
```

Every field is either "an index on the proto" or "a buffer for streaming accumulation" or "timing for observability." No reconciliation state. No heuristic state. No dedup state beyond the identity-based index itself.

---

## Phased Task Breakdown

### Phase 1: Research (before any code changes)

#### T02: Verify tool_call_id Availability on Events
**What:** Trace the LangGraph/LangChain event pipeline to confirm that `on_tool_start` and `on_tool_end` events carry the Anthropic `tool_call_id` (the `toolu_*` ID). This is the foundation for eliminating fingerprint dedup.

**Research steps:**
1. Check if `InjectedToolCallId` (from HITL cleanup) means the tool_call_id is available in the event metadata
2. Trace `astream_events(version="v2")` output for `on_tool_start` — where does tool_call_id appear?
3. Check early tool call creation — does the stream's `tool_use` block carry the same `toolu_*` ID?

**Output:** Documented confirmation or gap. If tool_call_id is NOT available on the event, we need an alternative dedup key before proceeding.

#### T03: Verify Namespace Injection Feasibility
**What:** Determine whether Graphton can inject a known sub-agent ID into the LangGraph sub-graph namespace at construction time.

**Research steps:**
1. Read how LangGraph constructs `langgraph_checkpoint_ns` for sub-graphs
2. Check if Graphton controls the namespace string during sub-graph construction (`graphton.core`)
3. Determine if we can embed the `tool_call_id` from the "task" tool into the namespace root

**Output:** Documented approach for deterministic namespace → sub-agent mapping. If injection is not feasible, document the fallback (first-event registration as the single strategy).

---

### Phase 2: Eliminate Compensating Complexity (incremental, on current codebase)

Each task deletes code. No new dictionaries. Each is a separate PR.

#### T04: Replace Fingerprint Dedup with tool_call_id Lookup
**Depends on:** T02 research confirms tool_call_id availability

**What:** Replace the entire fingerprint dedup system with a single identity check in `_handle_tool_start_event`:

```python
existing = self._tool_call_index.get(tool_call_id)
if existing is not None:
    # Already created from stream — record timing, skip creation
    self._tool_start_times[tool_call_id] = utc_now()
    return
```

**Delete:**
- `tool_call_fingerprints` set
- `_fingerprint_to_tool_call_id` dict
- `_reconciled_resume_tool_calls` dict (FIFO deque per tool name)
- `_get_tool_fingerprint()` method
- `_run_id_aliases` dict (replaced by tool_call_id direct lookup)
- Fingerprint computation in `populate_fingerprints_from_existing_tool_calls` (rename to `populate_index_from_existing_tool_calls`, only builds `_tool_call_index`)

**Keep:** Early tool call creation from stream (preserves streaming UX). Reconciliation becomes: "does this tool_call_id already exist in the index? Yes → skip. No → create."

**Acceptance:** All existing tests pass. Resume-after-approval works. No fingerprint code remains. ~300-500 lines deleted.

#### T05: Replace Namespace Heuristics with Deterministic Routing
**Depends on:** T03 research confirms approach

**What:** Replace the 4-strategy `_register_sub_agent_namespace` cascade with a single deterministic lookup.

**Delete:**
- Strategies 2, 3, 4 in `_register_sub_agent_namespace`
- `_pending_sub_agent_ids` list (FIFO queue for causal registration)
- `_warned_namespaces` set
- `_subject_counts` dict (if subjects can be derived differently)

**Replace with:**
```python
def _get_sub_agent_for_namespace(self, namespace: str) -> str | None:
    root = namespace.split("|")[0]
    return self._namespace_to_sub_agent.get(root)
```

Populated at sub-agent creation time with the known namespace root.

**Acceptance:** All existing tests pass. Zero `[NS_DIAG]` or `[NAMESPACE]` warnings. Concurrent sub-agents route correctly. ~200-300 lines deleted.

#### T06: Fix Pause Status Persistence
**Independent** — standalone bug fix in streaming.py

**What:** The `_handle_pause` CancelledError handler uses an unreliable `create_task` for gRPC persist. Replace with workflow-driven approach: workflow reads heartbeat `paused=True` flag and sets PAUSED status server-side.

**Acceptance:** Pause → DB shows PAUSED within 5 seconds. No stale IN_PROGRESS after pause.

---

### Phase 3: Restructure Using Reducer Pattern

After Phase 2, the dictionary count is reduced from ~30 to ~15. Phase 3 restructures the remaining state into the explicit `ExecutionState` model.

#### T07: Introduce ExecutionState and Refactor Handlers
**Depends on:** T04, T05 completed (compensating complexity removed)

**What:** This is the structural refactor:

1. Define `ExecutionState` dataclass (the explicit state model shown above)
2. Move remaining dictionaries from `self._*` on StatusBuilder into `ExecutionState` fields
3. Rewrite event handlers as small focused functions operating on `ExecutionState`
4. StatusBuilder becomes a thin orchestrator: receives events, resolves execution context (main vs sub-agent), dispatches to handler
5. Add `rebuild_indexes(proto)` classmethod that reconstructs `ExecutionState` from a persisted proto (for pod restart recovery)

**Approach:** Incremental extraction. Move one group of dictionaries at a time (tool call indexes first, then sub-agent routing, then streaming buffers). Each move is a commit. All tests pass at every step.

**Acceptance:** StatusBuilder is <500 lines. ExecutionState holds all state. Event handlers are 5-20 lines each. All existing tests pass. `rebuild_indexes` can reconstruct state from any persisted proto.

#### T08: Proto Safety Helpers
**Absorbed into T07** — as handlers are rewritten, the proto append-and-get-managed-reference pattern is encapsulated in helper methods. Not a separate task, just part of writing the new handlers correctly.

---

### Phase 4: Validation

#### T09: Post-Refactor Consistency Assertions
**Depends on:** T07 completed

**What:** Now that the state model is explicit and small (~10-12 fields), add a `verify_consistency(state: ExecutionState, phase: ExecutionPhase) -> list[Violation]` function that runs after each stream cycle. With only ~10 fields to check, the assertions are simple and comprehensive.

**Acceptance:** Zero violations in production for 2 weeks.

---

## Task Dependency Graph

```
T02 (research: tool_call_id) ──→ T04 (delete fingerprint dedup) ──┐
T03 (research: namespace)    ──→ T05 (delete namespace heuristics) ├→ T07 (reducer refactor) → T09 (assertions)
T06 (pause fix) ───────────────────────────────────────────────────┘
```

## Execution Order

1. **T02 + T03** (parallel research) — no code changes, just investigation and documentation
2. **T04** — delete fingerprint dedup (~300-500 lines deleted)
3. **T05** — delete namespace heuristics (~200-300 lines deleted)
4. **T06** — fix pause persistence (standalone, can be done anytime)
5. **T07** — introduce ExecutionState, refactor handlers (the big structural change, much easier with T04+T05 done)
6. **T09** — post-refactor assertions (lightweight, on the clean state model)

## What This Plan Does NOT Cover

- **G3 (full-replace race condition):** Covered by `hitl-tool-call-separation` project (`20260329.01`)
- **Server-side merge logic:** Separate fixes in `stigmer-cloud`
- **CLI/frontend consistency:** Separate effort. This project ensures the data is correct.
- **Temporal as state persistence:** Evaluated and deferred. gRPC streaming is necessary for real-time UI updates regardless. Temporal heartbeat could assist with pod-restart recovery but adds a second persistence channel. Not on the critical path.

## What Changed from v1

| v1 (Gap-Driven Hardening) | v2 (Reducer Pattern Simplification) |
|---|---|
| T02: Add assertions for 30 dicts | Moved to T09: Assert on ~10 clean fields after refactor |
| T03: Add `_processed_events` set (dict #31) | Eliminated: identity-based dedup provides natural idempotency |
| T04: Proto helpers | Absorbed into T07 handler rewrite |
| T05: Fingerprint → tool_call_id | T04 (priority raised to first code change) |
| T06: Namespace heuristics → deterministic | T05 (priority raised to second code change) |
| T07: Duration tracking fix | Absorbed into T07 handler rewrite |
| T08: Pause persistence fix | T06 (standalone, unchanged) |
| T09: Decompose god object | T07 (rewritten as "introduce ExecutionState + reducer pattern") |

**Net effect:** Fewer tasks. Deletion-first ordering. No new tracking state added. The structural refactor (T07) is easier because T04+T05 delete ~500-800 lines of compensating complexity first.
