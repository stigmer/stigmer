# T01 Execution Log: tool_call_id Availability at Interrupt Time

**Started**: 2026-03-27
**Completed**: 2026-03-27
**Status**: COMPLETE
**Result**: tool_call_id IS available via `InjectedToolCallId`. Interrupt payload can be reduced to two fields.

---

## Investigation Summary

### Question

Is `tool_call_id` (the ID the LLM assigns to a tool call, e.g., `call_abc123`) accessible inside `_check_and_handle_approval` in `graphton/core/tool_wrappers.py` at the moment the LangGraph interrupt is raised?

### Answer

**Yes.** LangChain provides `InjectedToolCallId` (from `langchain_core.tools`), a parameter annotation that causes the framework to inject the model's `tool_call_id` into the tool function at invocation time — without exposing it to the LLM.

**No code changes are needed to LangGraph or LangChain.** The mechanism already exists; Graphton simply does not use it today.

---

## Finding 1: Injection Mechanism

LangGraph's `ToolNode` receives `AIMessage.tool_calls` — each entry is a dict with `name`, `args`, and `id` (the tool_call_id). For each tool call, `ToolNode` invokes `BaseTool.invoke({"args": ..., "name": ..., "type": "tool_call", "id": tool_call_id}, config)`.

Inside `BaseTool.run()`, the `id` field is extracted and passed through as a `tool_call_id` argument. The injection into the tool function happens via two paths:

**Path A — Pydantic BaseModel schema (primary):**
In `_parse_input`, LangChain iterates `args_schema` annotations. When it finds a field annotated with `InjectedToolCallId`, it sets `tool_input[field_name] = tool_call_id`. The field is excluded from the LLM-visible schema by `_get_filtered_args` (which checks `_is_injected_arg_type`).

**Path B — `_injected_args_keys` fallback:**
For tools with dict-based schemas, `_parse_input` checks `_injected_args_keys`. If a key is named `"tool_call_id"`, it directly assigns the value from the `tool_call_id` argument.

Both paths converge: `_to_args_and_kwargs` converts the validated input dict into function kwargs, so the tool function receives `tool_call_id` as a named parameter.

**Source references:**
- `langchain_core/tools/base.py` — `class InjectedToolCallId(InjectedToolArg)` (line ~1397)
- `langchain_core/tools/base.py` — `_parse_input` injection logic (lines ~698-710, ~758-770)
- `langchain_core/tools/base.py` — `_get_filtered_args` schema exclusion (lines ~126-152)
- `langchain_core/tools/base.py` — `run()` passes config via `_get_runnable_config_param` (line ~965)

**Version compatibility:**
- `langchain-core` locked at 1.2.19 (poetry.lock). `InjectedToolCallId` has been available since ~0.2.x.
- `langgraph-prebuilt` locked at 1.0.8. `ToolNode` passes `tool_call_id` to tools in all 1.x versions.

---

## Finding 2: Current State — tool_call_id Is Not Used

**`tool_wrappers.py`** — `create_approval_aware_tool_wrapper` (line 328):
```python
@tool
async def approval_wrapper(config: RunnableConfig, **kwargs: Any) -> Any:
    tool_run_id = str(config.get("run_id", "")) if config else ""
```
Extracts `run_id` from `RunnableConfig` — this is LangGraph's internal run ID, **not** the model's tool_call_id. The `InjectedToolCallId` annotation is not used.

**`_check_and_handle_approval`** (line 650):
```python
def _check_and_handle_approval(
    tool_name, tool_args, approval_checker,
    mcp_server="__platform__", from_sub_agent=False,
    sub_agent_name="", run_id="",
) -> str | None:
```
Receives `run_id` and puts it in the interrupt payload. `tool_call_id` is not a parameter.

**Platform tools** (read line 958, write line 1062, execute line 1171, edit line 1261):
Same pattern — `config.get("run_id", "")` passed as `run_id` to `_check_and_handle_approval`.

**`interrupt_proxy.py`** — `InterruptProxyRunnable._build_proxy_payload`:
Copies interrupt `value` dicts as-is, adding `_proxy_interrupt_id` (LangGraph interrupt ID). No tool_call_id awareness, but no change needed — if the tool wrapper puts `tool_call_id` in the interrupt value dict, the proxy forwards it automatically.

---

## Finding 3: Downstream Complexity Caused by This Gap

The absence of `tool_call_id` in the interrupt payload created a 4-tier fuzzy matching chain:

**`status_builder.py`:**
- `_run_id_aliases` (line 471): Maps LangGraph `run_id` → `ToolCall.id`. Built during `on_tool_start` reconciliation.
- `_fingerprint_to_tool_call_id` (line 478): SHA256(tool_name + sorted args) → `ToolCall.id`. Fallback identity.
- `_resolve_run_id` (line 1576): Single-hop alias lookup on every tool event.
- `populate_fingerprints_from_existing_tool_calls` (line 1601): Rebuilds fingerprint map from persisted ToolCalls on resume.

**`hitl.py` — `InterruptCapture._match_interrupt`:**
1. `run_id` alias resolution → `_run_id_aliases.get(intr_run_id, intr_run_id)`
2. Fingerprint matching → `_get_tool_fingerprint(tool_name, tool_args)` → `_fingerprint_to_tool_call_id`
3. Name-based fallback → `_match_by_name` with sub-agent scoping
4. Phase 1 enrichment → `_try_enrich_phase1_entry` by tool name + sub-agent flag

All four tiers exist because the interrupt payload does not carry the tool_call_id that directly identifies the ToolCall.

---

## Decision: Minimal Interrupt Payload

With `tool_call_id` in the interrupt value, every other field becomes redundant:

| Field | Why it is removed |
|-------|-------------------|
| `run_id` | Replaced by `tool_call_id` — the actual model-assigned identity |
| `tool_name` | Already on `ToolCall` in `messages[].tool_calls[]` (created before `interrupt()` fires) |
| `tool_args` | Already on `ToolCall` in messages; fingerprint matching eliminated |
| `mcp_server` | Already on `ToolCall` in messages |
| `source` | Already on `ToolCall` in messages |
| `from_sub_agent` | `tool_call_id` is globally unique — no scoping needed |
| `sub_agent_name` | Already on `SubAgentExecution` that contains the ToolCall |

**Kept:** `message` — the human-readable approval reason computed by `approval_checker()`. This is the one field not already stored on the `ToolCall`. It stays in the interrupt payload until the `ToolCall` proto gains an `approval_message` field (T02/T03).

**New interrupt payload:**
```python
approval_request = {
    "tool_call_id": tool_call_id,
    "message": requirement.message,
}
```

---

## Implementation Approach (for T04)

### `_check_and_handle_approval` — simplified signature

```python
def _check_and_handle_approval(
    tool_name: str,
    tool_args: dict[str, Any],
    approval_checker: Callable[[str, dict[str, Any]], ApprovalRequirement] | None,
    tool_call_id: str = "",
) -> str | None:
```

Parameters removed: `mcp_server`, `from_sub_agent`, `sub_agent_name`, `run_id`.

### MCP tool wrapper — add InjectedToolCallId

```python
from langchain_core.tools import InjectedToolCallId
from typing import Annotated

@tool
async def approval_wrapper(
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    **kwargs: Any,
) -> Any:
    ...
    skip_result = _check_and_handle_approval(
        tool_name=tool_name,
        tool_args=actual_args,
        approval_checker=approval_checker,
        tool_call_id=tool_call_id,
    )
```

### Platform tools — same pattern

Add `tool_call_id: Annotated[str, InjectedToolCallId]` parameter. Remove `config.get("run_id", "")` extraction.

```python
@tool
async def read(
    config: RunnableConfig,
    tool_call_id: Annotated[str, InjectedToolCallId],
    path: str,
    offset: int = 0,
    limit: int = 0,
) -> str:
```

### Sub-agent interrupt proxy — no change needed

`InterruptProxyRunnable._build_proxy_payload` copies `intr.value` (a dict) as-is. The `tool_call_id` key flows through to the parent interrupt automatically.

---

## Risk Assessment: InjectedToolCallId + **kwargs

The MCP tool wrapper uses `**kwargs` for arbitrary tool arguments. Validation findings:

1. LangChain's `@tool` decorator already handles `config: RunnableConfig` + `**kwargs` today (the current wrapper works).
2. Adding a named parameter (`tool_call_id`) between `config` and `**kwargs` follows the same pattern — named-param-before-var-keyword is standard Python.
3. `InjectedToolCallId` is stripped from the LLM schema via `_is_injected_arg_type` in `_get_filtered_args`, so the LLM never sees it.
4. At invocation, `_parse_input` injects the value via `args_schema` annotations (BaseModel path) or `_injected_args_keys` (dict path).
5. `_filter_injected_args` ensures injected args don't leak into tool execution kwargs.

**Confidence: High.** The `config: RunnableConfig` parameter uses an identical pattern (named param + special injection + filtered from schema). Adding `InjectedToolCallId` is the same mechanism.

**Recommendation:** Write a unit test in T04 that creates a `@tool` function with `(config: RunnableConfig, tool_call_id: Annotated[str, InjectedToolCallId], **kwargs)` and invokes it through `ToolNode` to confirm end-to-end injection before changing all call sites.

---

## Impact on Other Tasks

| Task | Impact |
|------|--------|
| T02 (Proto changes) | No direct impact. Proto simplification is independent. |
| T03 (Python single writer) | Simplified — no `pending_approvals` shadow state, no `_run_id_aliases` needed for HITL |
| T04 (Add tool_call_id to interrupt) | **Directly informed.** Implementation approach is fully specified above. |
| T05 (Java/Go compute pending_approvals) | Simplified — interrupt value has `tool_call_id` for direct ToolCall lookup |
| T06 (React SDK) | No direct impact. |
| T07 (Tests) | Simplified — no fuzzy matching to test, just direct tool_call_id lookup |
