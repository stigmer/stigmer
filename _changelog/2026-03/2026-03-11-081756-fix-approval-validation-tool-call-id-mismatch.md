# Fix Approval Validation: tool_call_id Not Found in pending_approvals

**Date**: March 11, 2026

## Summary

Fixed a critical bug where HITL (human-in-the-loop) tool approval submissions failed with "tool_call_id not found in pending_approvals". The root cause was fragile name-based matching in the post-stream interrupt capture that could match an interrupt to the wrong tool call when multiple tools share the same canonical name (e.g., top-level and sub-agent both calling "execute"). Additionally, the Temporal `UpdateExecutionStatusActivityImpl` in both Go and Java silently dropped `pending_approvals` during persistence.

## Problem Statement

When a user tried to approve a tool call via the CLI, the backend rejected the approval with:

```
tool_call_id early-toolu_012bc52Phwv844a8kwfeArW0 not found in pending_approvals
```

### Pain Points

- Approval flow was broken for certain tool call patterns, particularly when sub-agents and the main agent both used tools with the same canonical name (e.g., "execute")
- The interrupt capture in `execute_graphton.py` rebuilt `pending_approvals` by matching interrupts to tool calls using only `tool_name` + `WAITING_APPROVAL` status — a fragile heuristic that could match to the wrong tool call
- The Temporal `UpdateExecutionStatusActivityImpl` in both Go and Java ignored `pending_approvals` entirely when persisting status updates, creating an architectural gap where the workflow's persist-before-signal step silently dropped approval state

## Solution

Three complementary fixes addressing both the primary cause and the architectural gap:

1. **Direct `run_id`-based matching** — Include the LangGraph `run_id` in the interrupt payload so the interrupt capture can resolve the exact `tool_call_id` via `_run_id_aliases` without any name-based guessing
2. **Scoped name-based fallback** — When `run_id` is unavailable (backward compat), scope the name-based search by `from_sub_agent` flag to prevent cross-level mismatches
3. **Persist `pending_approvals` in Temporal activities** — Add the same merge logic used by the controller handlers to both Go and Java `UpdateExecutionStatusActivityImpl`

## Implementation Details

### Fix 1: run_id in interrupt payload (`tool_wrappers.py`)

- Added `run_id: str = ""` parameter to `_check_and_handle_approval()` and included it in the `approval_request` dict passed to `interrupt()`
- Injected `config: RunnableConfig` into all tool wrappers (MCP `approval_wrapper`, `read`, `write`, `edit`, `execute`) to extract the LangGraph `run_id`
- The `RunnableConfig` parameter is automatically injected by LangChain's `@tool` decorator and excluded from the tool schema visible to the LLM

### Fix 2: Interrupt capture matching (`execute_graphton.py`)

- Primary path: when `run_id` is present in the interrupt value, resolve `tool_call_id` directly via `status_builder._run_id_aliases.get(run_id, run_id)` — no name-based search needed
- Fallback path (no `run_id`): scope the search by `from_sub_agent`:
  - `from_sub_agent=True` → search sub-agent tool calls first, fall back to top-level
  - `from_sub_agent=False` → search top-level tool calls only (no cross-level matching)
- Enhanced the `[INTERRUPT_CAPTURE]` log line to include `tc_id` for debugging

### Fix 3: Temporal activity persistence (`update_status_impl.go` + `UpdateExecutionStatusActivityImpl.java`)

- Added `pending_approvals` merge logic to both Go and Java `UpdateExecutionStatusActivityImpl`, using the same convention as the existing controller handlers:
  - Non-empty list with real `tool_call_id` → replace
  - Empty `tool_call_id` → clear
  - Absent (count 0) → preserve existing

## Benefits

- Eliminates the primary cause of approval validation failures by using deterministic `run_id`-based matching instead of fragile name heuristics
- Prevents cross-level tool call mismatches even without `run_id` (backward compatibility)
- Closes the architectural gap where Temporal activities silently dropped approval state during persistence
- Improved logging for faster diagnosis of future approval flow issues

## Impact

- **Agent Runner** (`graphton` library + `execute_graphton.py`): All HITL approval flows now carry `run_id` for reliable matching
- **Go Backend** (`stigmer-server`): Temporal activity correctly persists `pending_approvals`
- **Java Backend** (`stigmer-service`): Temporal activity correctly persists `pending_approvals`
- **CLI**: No changes needed — the CLI already sends the correct `tool_call_id` from the `PendingApproval`

## Files Changed

- `backend/libs/python/graphton/src/graphton/core/tool_wrappers.py` — RunnableConfig injection + run_id in approval payload
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — run_id-based + scoped interrupt matching
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/update_status_impl.go` — pending_approvals merge
- `stigmer-cloud: backend/services/stigmer-service/.../activities/UpdateExecutionStatusActivityImpl.java` — pending_approvals merge

---

**Status**: ✅ Production Ready
