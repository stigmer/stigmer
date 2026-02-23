---
name: Fix Content Drop and Namespace
overview: "Fix two interrelated bugs in the StatusBuilder: (1) content being dropped during LLM streaming (confirmed by CONTENT_DROP diagnostic), and (2) namespace-to-sub-agent registration failure causing 4,665 warning messages per execution and sub-agent event misrouting."
todos:
  - id: phase-0-diagnostics
    content: Add temporary INFO-level diagnostic logging in _handle_chat_model_stream_event (chunk format), _register_sub_agent_namespace (ID comparison), and _handle_sub_agent_start (task tool detection confirmation)
    status: completed
  - id: fix-content-drop
    content: Fix thinking detection early-return in lines 624-635 to extract and process text content from mixed thinking+text chunks before returning
    status: completed
  - id: fix-namespace-registration
    content: "Replace substring matching in _register_sub_agent_namespace with causal/temporal correlation: track pending sub-agent from task tool start, associate with first new namespace"
    status: completed
  - id: deduplicate-namespace-warning
    content: Change namespace fallback warning to log once per unique namespace instead of every event (add a set of warned namespaces)
    status: completed
  - id: validate-with-logs
    content: Run stigmer server logs --component agent-runner after fixes to verify CONTENT_DROP is gone and NAMESPACE warnings are eliminated or reduced to one-per-namespace
    status: pending
isProject: false
---

# Fix LLM Content Drop and Namespace Registration Failure

## Log Analysis Findings

From `stigmer server logs --component agent-runner`, execution `aex-01kj65mewawf5kx5vgtmtedas6`:

- **1 confirmed `[CONTENT_DROP]`**: Only `"I"` (1 char) was captured during streaming, but the LLM produced `"I'll read all 20 files simultaneously."` (38 chars). This happened inside a sub-agent namespace.
- **4,665 `[NAMESPACE]` warnings**: All for namespace `tools:3ede062b-...|model:75a8e500-...`. The namespace cannot be matched to any registered sub-agent, causing every sub-agent event to fall back to the main agent context.
- **0 `[CONTENT_OK]` messages**: (Expected -- this is DEBUG level, likely below the log threshold.)

---

## Bug 1: Content Drop During Streaming

**File**: `[status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)`, lines 624-635

**The code**:

```624:635:backend/services/agent-runner/worker/activities/graphton/status_builder.py
        if hasattr(chunk_data, "content") and isinstance(chunk_data.content, list):
            ns_key = namespace or ""
            thinking_text = self._extract_thinking_content(chunk_data.content)
            if thinking_text:
                self._thinking_buffers[ns_key] = (
                    self._thinking_buffers.get(ns_key, "") + thinking_text
                )
                if ns_key not in self._thinking_tool_call_ids:
                    self._start_thinking_stream(ns_key, namespace, self._thinking_buffers[ns_key])
                else:
                    self._update_thinking_stream(ns_key)
                return
```

**Root cause**: When a streaming chunk's `content` is a list containing BOTH `type: "thinking"` and `type: "text"` blocks, the thinking path fires (`if thinking_text:`) and returns early at line 635, **silently dropping any text content in the same chunk**. With Claude Opus 4.6's adaptive thinking (recently enabled via the model configuration pipeline change), thinking blocks are now active. At the boundary between thinking and text output, LangChain may batch both types into a single `AIMessageChunk`, causing text loss.

**Secondary hypothesis**: It is also possible that with adaptive thinking (`type: "adaptive"`), the streaming format from LangChain differs enough that `_extract_string_content` fails to extract text from some chunk formats (e.g., non-dict items in the list, or blocks with unexpected type values). We need diagnostic logging to confirm which mechanism is causing the drop.

**Fix**: After extracting thinking text from a chunk, also extract text content from the same chunk. Only skip text processing if the chunk is purely thinking content. Specifically:

```python
if hasattr(chunk_data, "content") and isinstance(chunk_data.content, list):
    ns_key = namespace or ""
    thinking_text = self._extract_thinking_content(chunk_data.content)
    text_in_same_chunk = self._extract_string_content(chunk_data.content)

    if thinking_text:
        self._thinking_buffers[ns_key] = (
            self._thinking_buffers.get(ns_key, "") + thinking_text
        )
        if ns_key not in self._thinking_tool_call_ids:
            self._start_thinking_stream(ns_key, namespace, self._thinking_buffers[ns_key])
        else:
            self._update_thinking_stream(ns_key)

        if not text_in_same_chunk:
            return
        # Fall through to process the text content below
```

If `text_in_same_chunk` is non-empty, the code falls through to the text token processing path (line 637+), which will flush the thinking buffer and create/append to the AI message.

---

## Bug 2: Namespace Registration Failure

**File**: `[status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)`, lines 1760-1784

**The code**:

```1776:1783:backend/services/agent-runner/worker/activities/graphton/status_builder.py
        for sub_agent_id in self._active_sub_agents:
            if sub_agent_id in namespace:
                self._namespace_to_sub_agent_id[namespace] = sub_agent_id
                self.logger.debug(
                    f"[SUBAGENT] Registered namespace={namespace} -> sub_agent={sub_agent_id}"
                )
                return
```

**Root cause**: The substring matching `if sub_agent_id in namespace` compares the task tool's event `run_id` against the LangGraph checkpoint namespace string. But LangGraph namespaces use checkpoint/thread UUIDs (e.g., `tools:3ede062b-...|model:75a8e500-...`), which are different from the event `run_id` assigned to the task tool invocation. The matching **always fails** because these are different ID spaces.

**Impact**:

- All sub-agent events fall through to main agent context (`self.current_status.messages`)
- Sub-agent messages leak into the main agent's message list
- The 4,665 warnings per execution pollute logs and obscure real issues

**Fix approach**: Replace the brittle substring matching with a causal/temporal correlation strategy:

1. When `on_tool_start(name="task")` fires, record the sub-agent ID AND set a flag (`_pending_sub_agent_id`) indicating we expect the next new namespace to belong to this sub-agent.
2. When the first event with an unregistered multi-segment namespace arrives (indicating a nested sub-graph), associate it with the pending sub-agent.
3. All subsequent events sharing the same namespace prefix automatically route to that sub-agent.

This approach is more robust because it does not depend on ID format matching -- it relies on the causal ordering of LangGraph events (task tool start always precedes the sub-agent's first event).

Additionally, the warning should be deduplicated: log once per unique unregistered namespace, not on every event (to prevent the 4,665-message spam).

---

## Phase 0: Enhanced Diagnostic Logging (Before Fixes)

Before applying the fixes, add **temporary INFO-level diagnostic logging** to confirm the exact mechanism. This avoids making assumptions about the streaming format:

1. In `_handle_chat_model_stream_event`: Log the chunk content type, format, and whether thinking/text was found -- specifically at the thinking detection boundary.
2. In `_register_sub_agent_namespace`: Log the sub_agent_ids being compared and the namespace being matched against.
3. In `_handle_sub_agent_start`: Elevate from DEBUG to INFO so we can confirm the task tool IS being detected.

These diagnostics will run for one execution cycle to confirm the root causes, then be removed or downgraded after the fixes are validated.

---

## Summary of Changes

All changes are in a single file: `[status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)`

- **Lines 624-635**: Fix thinking detection to not drop co-located text content
- **Lines 1753-1757**: Deduplicate namespace warning (log once per namespace, not per event)
- **Lines 1760-1784**: Replace substring matching with causal namespace registration
- **Lines 1786-1818**: Add pending sub-agent tracking in `_handle_sub_agent_start`
- **Temporary diagnostics**: INFO-level logs in the three locations above

---

## Open Questions for You

1. **Adaptive thinking visibility**: With `type: "adaptive"` thinking on Opus 4.6, do we expect thinking blocks to be visible in the streaming API at all? If adaptive thinking is opaque (thinking not exposed), the thinking detection path may never fire, and the content drop root cause might be elsewhere.
2. **deepagents "task" tool**: Can we confirm that deepagents v0.4.x actually emits `on_tool_start(name="task")` events for sub-agent invocations? If not, the entire sub-agent tracking pipeline is disconnected.
3. **Priority**: Should we deploy the diagnostic logging first (Phase 0) to confirm root causes before applying fixes, or proceed directly with the fixes based on the analysis?

