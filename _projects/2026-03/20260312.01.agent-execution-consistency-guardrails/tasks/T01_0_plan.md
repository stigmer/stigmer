# Task T01: Agent Execution Consistency Guardrails — Detailed Plan

**Created**: 2026-03-12 10:25
**Status**: PENDING REVIEW

## Background: The Observed Problem

On 2026-03-12, execution `aex-01kkg22yeeez6579b8mcaz5bwt` (cloud-resource-assistant skill generation, model `claude-opus-4.6`) exhibited three categories of inconsistent behavior observed by the end user:

1. **Agent self-improvement loop**: The agent completed the skill (wrote SKILL.md + 3 references, passed validation, produced a summary), then **self-initiated a second iteration** — re-reading its own output, identifying gaps, launching 6+ sub-agents for deeper research. This was not requested by the user and produced confusing UX (the agent appeared to "restart").

2. **Context overflow crash**: During the second iteration, accumulated context reached 249,324 tokens, exceeding Anthropic's 200,000-token limit. The agent crashed with `AnthropicContextOverflowError`.

3. **Sub-agent UX confusion**: Sub-agents showed as "Working..." in the CLI, then vanished without showing completion. The execution was marked `EXECUTION_COMPLETED` while 5+ sub-agents were still `IN_PROGRESS` and 3 of 5 todos were `PENDING`.

## Root Cause Analysis: Five Architectural Gaps

### Gap 1: LoopDetectionMiddleware Is Dead Code (CRITICAL)

**What we found**: The `LoopDetectionMiddleware` class in `backend/libs/python/graphton/src/graphton/core/loop_detection.py` implements its entire detection logic in `aafter_step()` (line 235). However, `aafter_step` **is not a valid hook** in LangChain's `AgentMiddleware` base class.

**Verified valid hooks** (confirmed via runtime introspection of `langchain.agents.middleware.types.AgentMiddleware`):
- `abefore_agent` / `abefore_model` / `aafter_model` / `aafter_agent`
- `awrap_model_call` / `awrap_tool_call`

There is **no** `aafter_step`. The method exists in the source code but is never registered as a graph node by `langchain.agents.factory.create_agent()` and is never called during execution.

**What this means**:
- `abefore_agent()` fires once at graph start — clears state (works)
- `aafter_step()` — **NEVER FIRES** (dead code, all detection logic lives here)
- `aafter_agent()` fires once at graph end — logs stats (always zeros since nothing was tracked)

The configured thresholds (`consecutive_threshold=3`, `total_threshold=5`) are never evaluated. The agent can call the same tool with the same params indefinitely until it hits the recursion limit.

**Evidence**: The agent in the observed execution completed its task at ~step 30-40, then autonomously started a second improvement pass. With loop detection broken, nothing detected or stopped this self-reinforcing cycle.

**File**: `backend/libs/python/graphton/src/graphton/core/loop_detection.py`

---

### Gap 2: Summarization Only Runs at Graph-Start (CRITICAL)

**What we found**: `ContextSummarizationMiddleware.abefore_agent()` checks token count and triggers summarization when above `trigger_threshold` (180,000 tokens for `claude-opus-4.6`). But `abefore_agent` only fires **once at the start of each graph invocation**, not between model-tool cycles.

The execution flow within a single invocation is:
```
abefore_agent -> (model -> tools -> model -> tools -> ... -> model) -> aafter_agent
```

Within the inner loop, tokens accumulate with every tool response. A single sub-agent task result can add 10K-50K tokens. The context can jump from 170K to 250K tokens between two model calls, but `abefore_agent` won't fire again until the entire graph finishes and is re-invoked.

**The middleware also has `aafter_step()`** (line 303 of `summarization_middleware.py`) explicitly reserved for "mid-execution summarization" — but like loop detection, `aafter_step` doesn't exist in AgentMiddleware and never runs.

**What happened in production**: At the start of Wave 2, the context was near the 180K trigger. The 6+ parallel sub-agent calls returned large payloads (exploring the Planton monorepo — protobuf definitions, changelogs, manifests), pushing context to 249,324 tokens. The next model call failed with `AnthropicContextOverflowError: prompt is too long: 249324 tokens > 200000 maximum`.

**File**: `backend/libs/python/graphton/src/graphton/core/summarization_middleware.py`
**Config**: `backend/libs/python/graphton/src/graphton/core/summarization_config.py`
**Model Registry entry**: `claude-opus-4.6` → `context_window_tokens=200000`, `trigger_threshold=180000`, `target_tokens=160000`

---

### Gap 3: Recursion Limit Is 10x Higher Than Intended

**What we found**: Three conflicting `recursion_limit` values in the codebase:

| Location | Value | Effect |
|----------|-------|--------|
| `graphton/core/agent.py` line 43 (default parameter) | 100 | Graphton's intended limit |
| `execute_graphton.py` line 2288 (passed to `create_deep_agent()`) | 1000 | Overrides graphton's default |
| `execute_graphton.py` line 2324 (runtime config) | 1000 | Defense-in-depth override |

LangGraph's `merge_configs` applies the runtime config last. The effective limit is **1,000 model+tool cycles**, not graphton's intended 100. The code comments even acknowledge this: "This overrides deepagents' default of 1000 with graphton's configured value."

**What this means**: The agent has an enormous runway. After completing its task at ~step 30-40, it had ~960 remaining cycles to spend on self-improvement. Combined with broken loop detection, this creates unbounded autonomous execution.

**Comparison with Cursor/Claude Code**: These products use tight limits (~25-50 tool calls per user message) and treat hitting the limit as a natural pause point where the user is asked "Should I continue?". This creates bounded, predictable execution.

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py` (lines 2288, 2324)

---

### Gap 4: Sub-Agent Completion Is Invisible in CLI

**What we found**: In `run_stream_inline_bubbletea.go`, the `renderTransientContent()` method has a priority cascade:

```
approvalActive > streamingActive > aiStreamActive > activeSubAgentEntries > spinnerActive
```

When the main agent starts streaming AI output (the synthesis after sub-agents complete), `aiStreamActive` takes visual priority immediately. The sub-agent completion handler removes the entry from `activeSubAgentEntries` and commits a collapsed summary to scrollback via `tea.Println`. But:

1. The scrollback commit happens simultaneously with AI stream start
2. `aiStreamActive` takes priority over `activeSubAgentEntries` in the next render
3. The user sees: spinner line vanishes → AI text appears — no completion indicator

**The practical sequence**:
1. Sub-agent spinner shows "Working... N tools (Xs)"
2. Backend: sub-agent completes → `on_tool_end` for "task" → status `COMPLETED` → `force_next_update`
3. Same or next gRPC push: main agent starts AI streaming
4. CLI processes both: removes sub-agent entry + starts AI stream
5. User sees spinner vanish, replaced by AI text. The completion summary is committed to scrollback above the viewport — invisible.

**Files**:
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go` (renderTransientContent priority)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go` (renderSubAgentCompleted)
- `client-apps/cli/cmd/stigmer/root/run_stream_subagent.go` (emitSubAgentEvents)

---

### Gap 5: Execution Marked Complete While Sub-Agents In-Flight

**What we found**: In the observed execution data, `EXECUTION_COMPLETED` was set at 03:56:32 while multiple sub-agents were still `IN_PROGRESS` (some launched at 03:56:33-34, just after completion). Two sub-agent approvals were approved at exactly 03:56:32.

The finalization logic in `execute_graphton.py` (lines 3383-3394):

```python
if current_phase == ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
    # Don't set COMPLETED
elif current_phase == ExecutionPhase.EXECUTION_PAUSED:
    # Don't set COMPLETED
else:
    status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
```

This does NOT check whether sub-agents are still active. If the `astream_events` loop ends for any reason (context overflow crash, recursion limit, model error) while the phase isn't WAITING_FOR_APPROVAL or PAUSED, it marks completion regardless of sub-agent state.

**Files**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (lines 3383-3394)
- `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (`_active_sub_agents` tracking)

---

## Implementation Plan

### PR1: Fix LoopDetectionMiddleware (Move to `aafter_model`)

**Objective**: Make loop detection actually work by moving the detection logic from the non-existent `aafter_step` hook to `aafter_model`, which fires after every LLM response.

**Approach**:
1. Add `aafter_model()` method to `LoopDetectionMiddleware`
2. Move the tool-call tracking and loop detection logic from `aafter_step()` into `aafter_model()`
3. In `aafter_model`, inspect the AIMessage's `tool_calls` to track history and detect patterns
4. Keep `aafter_step()` as a deprecated no-op with a comment explaining why it was moved
5. Add comprehensive tests: consecutive loop detection, total repetition detection, intervention message injection, stop behavior
6. Verify the middleware actually fires during a test agent run

**Key design decision**: `aafter_model` fires BEFORE tools execute. This means we detect the model's intent to loop before the tool runs, which is actually better — we can inject an intervention message that changes the model's next behavior without wasting a tool execution.

**Risk mitigation**: The intervention message injection (appending SystemMessage to state) must be compatible with how `aafter_model` return values are processed by the graph. Need to verify that returning `{"messages": [...]}` from `aafter_model` properly updates state.

**File**: `backend/libs/python/graphton/src/graphton/core/loop_detection.py`
**Tests**: `backend/libs/python/graphton/tests/test_loop_detection.py`

---

### PR2: Fix ContextSummarizationMiddleware (Add `aafter_model` Mid-Execution Check)

**Objective**: Prevent context overflow by checking token count after every model response, not just at graph start.

**Approach**:
1. Add `aafter_model()` method to `ContextSummarizationMiddleware`
2. In `aafter_model`, count current tokens and trigger summarization if above threshold
3. Keep `abefore_agent()` as the primary summarization point (for initial invocation and resume paths)
4. Use `aafter_model` as a safety net for mid-execution overflow prevention
5. Add a debounce mechanism: don't summarize more than once per N model calls (to avoid excessive summarization overhead)
6. Add tests verifying mid-execution summarization triggers correctly

**Key design consideration**: `aafter_model` fires after the model responds but before tools execute. If the model's response itself pushed us over the threshold (unlikely — responses are small), we summarize before tool execution. More importantly, the PREVIOUS tool results (which are the large payloads from sub-agents) are already in the message history, so the token count reflects the accumulated state.

**Risk mitigation**: Summarization latency. The `_perform_summarization` method calls LangMem's `summarize_messages()` which makes an LLM call. Adding this to every model-tool cycle is expensive. Solution: only trigger when `current_tokens > trigger_threshold * 0.95` or similar — a "danger zone" check that is fast (just counting) in the common case and only does the expensive summarization when actually needed.

**File**: `backend/libs/python/graphton/src/graphton/core/summarization_middleware.py`
**Tests**: `backend/libs/python/graphton/tests/test_summarization_middleware.py`

---

### PR3: Fix Recursion Limit Override

**Objective**: Ensure the effective recursion_limit matches graphton's intended value of 100.

**Approach**:
1. Remove the explicit `recursion_limit=1000` from `execute_graphton.py` line 2288 (the `create_deep_agent()` call)
2. Remove the explicit `"recursion_limit": 1000` from `execute_graphton.py` line 2324 (the runtime config)
3. Let graphton's default of 100 take effect via `agent.py` line 43
4. Alternatively: make the recursion limit configurable via the execution config proto, with a sensible default (100) and a maximum cap (500)
5. Update the code comments to explain the intentional limit

**Key design decision**: Should we use 100 or allow per-execution configuration? For now, 100 is a safe default. If specific use cases need more, we can add a configurable override later. The important thing is that the default is intentional, not an accidental 10x inflation.

**Risk mitigation**: Some legitimate long-running tasks (like the cloud-resource-assistant skill generation with 13 sub-agents) may need more than 100 model-tool cycles. We should add clear logging when the limit is approached (e.g., "80% of recursion limit reached") so it's observable, and the error message when the limit is hit should be user-friendly ("Agent reached the tool-call limit. You can continue by sending another message.").

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

---

### PR4: Fix Sub-Agent Completion UX

**Objective**: Make sub-agent completion visually apparent before the entry is removed from the active display.

**Approach**:
1. When `handleSubAgentComplete` fires in Bubbletea, instead of immediately removing the entry, transition it to a "completed" visual state (e.g., replace spinner with checkmark, show duration and tool count)
2. Keep the completed entry visible for a brief duration (1-2 seconds) or until the next render cycle commits it to scrollback
3. Optionally: render sub-agent status entries alongside (not instead of) the AI stream — the `renderTransientContent` priority cascade shouldn't make sub-agent status mutually exclusive with AI streaming
4. Ensure the scrollback commit includes a clear completion indicator visible even when scrolled up

**Key design consideration**: This is a UX change that affects the visual flow. The current approach (vanish and commit to scrollback) is technically correct but perceptually wrong. The fix should prioritize user perception: "I can see that sub-agents finished before the main agent continues."

**Files**:
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go`
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_render.go`
**Tests**: Update existing sub-agent render tests in `client-apps/cli/cmd/stigmer/root/`

---

### PR5: Fix Premature Execution Completion

**Objective**: Do not mark execution as `COMPLETED` while sub-agents are still `IN_PROGRESS`.

**Approach**:
1. In the finalization logic at `execute_graphton.py` lines 3383-3394, add a check for active sub-agents before setting `EXECUTION_COMPLETED`
2. If sub-agents are still `IN_PROGRESS`, either:
   - a) Wait for them to complete with a timeout (e.g., 30 seconds)
   - b) Transition them to `CANCELLED` and mark execution as `COMPLETED_WITH_WARNINGS`
   - c) Mark execution as `EXECUTION_COMPLETED` but include a warning in the status about abandoned sub-agents
3. Call `status_builder.finalize_active_sub_agents()` (already exists from the prior project PR3) before setting the final phase
4. Log the abandoned sub-agents at WARNING level for observability

**Key design decision**: Option (b) is the cleanest — if the graph terminated (for any reason), sub-agents that haven't completed should be marked as `CANCELLED` with a reason like "Parent execution terminated". This gives the user a clear signal.

**Risk mitigation**: The "wait for sub-agents" approach (option a) could delay the Temporal activity return. Since we already have `finalize_active_sub_agents()` from the prior project, option (b) is safer — it terminates cleanly without waiting.

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`
**Dependency**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (existing `finalize_active_sub_agents()`)

---

## PR Sequencing and Dependencies

```
PR1 (Loop Detection) ──┐
                        ├── PR3 (Recursion Limit) ── independent
PR2 (Summarization) ────┘
PR4 (Sub-Agent UX) ── independent (Go CLI, no Python dependency)
PR5 (Premature Completion) ── depends on status_builder (already exists)
```

**Recommended order**:
1. **PR3** first (trivial, low risk, immediate impact on bounding execution)
2. **PR1** second (highest-leverage fix for the self-improvement loop)
3. **PR2** third (prevents context overflow, similar pattern to PR1)
4. **PR5** fourth (execution finalization, builds on existing infrastructure)
5. **PR4** last (UX polish, requires careful Bubbletea testing)

---

## Deferred Follow-Ups (from PR2, Session 3)

These items were identified during PR2 implementation and intentionally deferred to keep the middleware PR focused. They enable user-visible compaction notifications (similar to Cursor's "Auto-condensed conversation" indicator).

### Follow-Up A: SummarizationEventData `source` field + StatusBuilder immediate push

- Add `source: str` field to `SummarizationEventData` in `summarization_callback.py` (values: `"graph_start"`, `"mid_execution"`) so StatusBuilder can distinguish compaction triggers
- In `StatusBuilder.on_summarization_complete()`, call `self._force_next_update()` after recording the event so the CLI receives it immediately
- Proto `SummarizationEvent` may need a `source` field to carry this through gRPC
- **Files**: `backend/libs/python/graphton/src/graphton/core/summarization_callback.py`, `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

### Follow-Up B: CLI Compaction Notification Rendering (Bubbletea)

- Detect new `SummarizationEvent` entries in the streamed `ContextInfo`
- Render a brief, informative notification (e.g., "Context compacted: 180K -> 120K tokens (33% reduction)")
- Consider visual treatment: dimmed system line in scrollback, or transient status indicator
- **Files**: `client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go` and related render files
- Naturally aligns with PR4 (Sub-Agent Completion UX) or could be a standalone follow-up PR

---

## Comparison: Why Cursor/Claude Code Feel Smooth

| Aspect | Cursor/Claude Code | Stigmer Today | Stigmer After This Project |
|--------|-------------------|---------------|---------------------------|
| Loop prevention | First-class graph-level cycle counting, tight limits (~25-50 tool calls) | Dead code (`aafter_step` not a valid hook) | Working `aafter_model` detection with intervention messages |
| Context management | Token budget enforced before every model call | Only checked at graph start; can be 10x over limit by mid-execution | Checked after every model call via `aafter_model` |
| Iteration boundary | One user message = one bounded response; model can't self-initiate improvement loops | 1,000-cycle runway with no behavioral guardrails | 100-cycle limit with observable warnings at 80% |
| Sub-agent UX | Persistent completion indicators in scrollback | Priority cascade hides completion; sub-agents vanish | Completion indicator visible for 1-2s before scrollback commit |
| Graceful degradation | Errors surface as user-facing messages with retry options | Context overflow crashes silently | Sub-agents cancelled with clear status; overflow prevented by mid-exec summarization |

---

## Success Criteria (Measurable)

1. **Unit test**: `LoopDetectionMiddleware.aafter_model()` is called during a mock agent run and detects 3+ consecutive identical tool calls
2. **Unit test**: `ContextSummarizationMiddleware.aafter_model()` triggers summarization when mid-execution tokens exceed threshold
3. **Runtime verification**: `recursion_limit` logged at agent startup shows 100 (not 1000)
4. **Integration test**: Sub-agent completion renders a visible checkmark in CLI before removal
5. **Integration test**: Execution with crashed sub-agents shows `CANCELLED` status on sub-agents, not `IN_PROGRESS`
6. **Production validation**: Re-run the cloud-resource-assistant skill generation and verify no self-improvement loop, no context overflow, clear sub-agent lifecycle
