# T01 Deliverable: AG-UI Event Mapping & Gap Analysis

**Author**: AI (Architect + UX/UI + AI Engineer roles)
**Date**: 2026-03-15
**Status**: DRAFT — Awaiting developer review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [AG-UI Protocol Overview](#2-ag-ui-protocol-overview)
3. [R1: Event Mapping — Stigmer Concepts to AG-UI Events](#3-r1-event-mapping)
4. [R2: LangGraph AG-UI Integration Validation](#4-r2-langgraph-validation)
5. [R3: Frontend Rendering — CopilotKit vs assistant-ui](#5-r3-frontend-rendering)
6. [R4: Transport — AG-UI over gRPC-Web](#6-r4-transport)
7. [R5: Storage Model](#7-r5-storage-model)
8. [R6: CopilotKit React UI Evaluation](#8-r6-copilotkit-evaluation)
9. [R7: Ecosystem & Risk](#9-r7-ecosystem-risk)
10. [Gap Classification](#10-gap-classification)
11. [Recommendation](#11-recommendation)

---

## 1. Executive Summary

AG-UI is a viable rendering event protocol for Stigmer's web console, with meaningful caveats. The protocol covers the core rendering path (streaming messages, tool calls, reasoning) well. However, five Stigmer-specific concepts fall outside AG-UI's standard events and require CUSTOM extensions or the separate AgentExecution aggregate.

The fundamental architectural insight from the prior session holds: **AG-UI handles the rendering stream; AgentExecution handles the queryable aggregate**. The gaps identified below exist at the rendering level and are addressable through AG-UI's CUSTOM event mechanism without protocol forking.

**Verdict**: Conditional GO — proceed to POC (Step 2) to validate the mapping in code.

---

## 2. AG-UI Protocol Overview

### Event Categories (27 event types, 7 categories)

| Category | Events | Purpose |
|----------|--------|---------|
| **Lifecycle** (5) | RUN_STARTED, RUN_FINISHED, RUN_ERROR, STEP_STARTED, STEP_FINISHED | Run boundaries, step progress |
| **Text Messages** (4) | TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END, TEXT_MESSAGE_CHUNK | Streaming assistant/user/system messages |
| **Tool Calls** (5) | TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, TOOL_CALL_RESULT, TOOL_CALL_CHUNK | Tool invocation lifecycle |
| **State Management** (5) | STATE_SNAPSHOT, STATE_DELTA, MESSAGES_SNAPSHOT, ACTIVITY_SNAPSHOT, ACTIVITY_DELTA | State synchronization |
| **Reasoning** (7) | REASONING_START, REASONING_MESSAGE_START/CONTENT/END/CHUNK, REASONING_END, REASONING_ENCRYPTED_VALUE | Chain-of-thought visibility |
| **Special** (2) | RAW, CUSTOM | Passthrough and extension |

### Message Types

| Role | Type | Description |
|------|------|-------------|
| `"user"` | UserMessage | End-user input (text or multimodal) |
| `"assistant"` | AssistantMessage | AI response, may include toolCalls[] |
| `"system"` | SystemMessage | Instructions/context |
| `"tool"` | ToolMessage | Tool execution result, linked via toolCallId |
| `"reasoning"` | ReasoningMessage | Chain-of-thought, optionally encrypted |
| `"activity"` | ActivityMessage | Frontend-only structured UI (plans, progress) |
| `"developer"` | DeveloperMessage | Debug/development messages |

### Key Design Patterns

- **Start-Content-End**: Streaming pattern for messages and tool calls
- **Snapshot-Delta**: State synchronization (JSON Patch RFC 6902)
- **Lifecycle bookends**: Every run has RUN_STARTED and RUN_FINISHED/RUN_ERROR

---

## 3. R1: Event Mapping — Stigmer Concepts to AG-UI Events

### Direct Mappings (works out of the box)

| Stigmer Concept | AG-UI Event(s) | Mapping Notes |
|----------------|----------------|---------------|
| AI message (MESSAGE_AI, streaming) | TEXT_MESSAGE_START (role="assistant") → TEXT_MESSAGE_CONTENT (deltas) → TEXT_MESSAGE_END | `messageId` maps to a Stigmer message index. `AgentMessage.isStreaming` = true while content events flow; false after END. |
| Human message (MESSAGE_HUMAN) | Part of `messages[]` in RunAgentInput (role="user") | Sent by client, not emitted as an event. Already present in conversation history. |
| System message (MESSAGE_SYSTEM) | TEXT_MESSAGE_START (role="system") → CONTENT → END | Or included in MESSAGES_SNAPSHOT as SystemMessage. |
| Tool call initiation | TOOL_CALL_START | `toolCallId` = `ToolCall.id`, `toolCallName` = `ToolCall.name`, `parentMessageId` = containing AI message ID |
| Tool call args streaming | TOOL_CALL_ARGS | `delta` = JSON fragment of `ToolCall.args`. Concatenated on client to build complete args object. |
| Tool call completion | TOOL_CALL_END | Marks args complete. `ToolCall.status` = TOOL_CALL_RUNNING → TOOL_CALL_COMPLETED transition. |
| Tool call result | TOOL_CALL_RESULT | `content` = `ToolCall.result`, `toolCallId` links back. |
| Thinking/reasoning blocks | REASONING_START → REASONING_MESSAGE_START/CONTENT/END → REASONING_END | Full support for collapsible reasoning display. Map to Stigmer's thinking blocks with shimmer during streaming. |
| Execution start | RUN_STARTED | `threadId` = session_id, `runId` = execution_id |
| Execution success | RUN_FINISHED | `result` can carry summary data |
| Execution error | RUN_ERROR | `message` = `AgentExecutionStatus.error` |
| LangGraph node transitions | STEP_STARTED / STEP_FINISHED | `stepName` = LangGraph node name (e.g., "agent", "tools", "supervisor") |

### Partial Mappings (require augmentation)

| Stigmer Concept | AG-UI Event(s) | Gap | Mitigation |
|----------------|----------------|-----|------------|
| **ExecutionPhase transitions** (8 phases: PENDING, IN_PROGRESS, WAITING_FOR_APPROVAL, COMPLETED, FAILED, CANCELLED, PAUSED, TERMINATED) | RUN_STARTED (≈ PENDING→IN_PROGRESS), RUN_FINISHED (≈ COMPLETED), RUN_ERROR (≈ FAILED) | Missing: WAITING_FOR_APPROVAL, PAUSED, CANCELLED, TERMINATED. AG-UI lifecycle only has 3 terminal states. | Use **STATE_DELTA** to push phase transitions as aggregate state. Frontend reads phase from AgentExecution aggregate via existing subscribe RPC, not from AG-UI events. Phase display stays in the AgentExecution layer, not the rendering stream. |
| **Tool call failure** (TOOL_CALL_FAILED) | TOOL_CALL_END + TOOL_CALL_RESULT with error content | AG-UI ToolMessage has an `error` field, but ToolCallResult event doesn't have one. | Encode error in TOOL_CALL_RESULT content (e.g., JSON `{"error": "..."}`) or emit a **CUSTOM** event `stigmer:tool_call_error`. |
| **Sub-agent delegation** (SubAgentExecution with nested messages, tool calls, status) | STEP_STARTED / STEP_FINISHED | Steps are flat — no nesting, no child messages/tool calls. A step has only a `stepName`, no structured payload. | **CUSTOM events** for sub-agent lifecycle: `stigmer:sub_agent_started`, `stigmer:sub_agent_finished`. Sub-agent rendering data flows through nested AG-UI event sequences (child messages and tool calls occur between step boundaries). See [Sub-Agent Strategy](#sub-agent-rendering-strategy) below. |
| **Token/cost per message** (`AgentMessage.input_tokens`, `output_tokens`, `estimated_cost_usd`, `model`) | No standard event | AG-UI has no concept of per-message token usage or cost attribution. | **CUSTOM event** `stigmer:message_usage` emitted after TEXT_MESSAGE_END with `{messageId, inputTokens, outputTokens, model, estimatedCostUsd}`. Or encode in STATE_DELTA as part of aggregate state. |
| **MCP server slug per tool** (`ToolCall.mcp_server_slug`) | No field in TOOL_CALL_START | AG-UI tool calls have `toolCallId`, `toolCallName`, `parentMessageId` only. | Encode `mcpServerSlug` in the tool name convention (e.g., `github__create_issue`) — this is already common practice. Or emit a CUSTOM event. |

### No Standard Mapping (CUSTOM events required)

| Stigmer Concept | Proposed CUSTOM Event | Payload |
|----------------|----------------------|---------|
| **Tool call awaiting approval** (TOOL_CALL_WAITING_APPROVAL) | `stigmer:tool_approval_requested` | `{toolCallId, toolCallName, approvalMessage, mcpServerSlug}` |
| **Tool call skipped** (TOOL_CALL_SKIPPED) | `stigmer:tool_call_skipped` | `{toolCallId, reason}` |
| **Tool call approval resolved** | `stigmer:tool_approval_resolved` | `{toolCallId, action: "approve"|"skip"|"reject", decidedBy, comment}` |
| **Artifacts produced** (ExecutionArtifact) | `stigmer:artifact_produced` | `{id, name, kind, mimeType, sizeBytes, downloadUrl}` |
| **Todo item update** (TodoItem) | `stigmer:todo_updated` | `{id, content, status, createdAt, updatedAt}` |
| **Sub-agent started** | `stigmer:sub_agent_started` | `{id, name, input, subject}` |
| **Sub-agent finished** | `stigmer:sub_agent_finished` | `{id, name, status, output, error, usage}` |
| **Execution usage summary** | `stigmer:usage_update` | `{totalInputTokens, totalOutputTokens, totalCostUsd, modelBreakdown[]}` |
| **Context resolution** | `stigmer:context_resolved` | `{mcpServers[], skillsLoaded, summarizationEvents[]}` |

### Sub-Agent Rendering Strategy

AG-UI's flat STEP model cannot represent Stigmer's nested SubAgentExecution tree. The proposed approach:

```
STEP_STARTED {stepName: "sub_agent:code_reviewer"}
  CUSTOM {name: "stigmer:sub_agent_started", value: {id, name, input, subject}}
  
  // Child AG-UI events flow here:
  TEXT_MESSAGE_START → CONTENT → END  (sub-agent's AI messages)
  TOOL_CALL_START → ARGS → END → RESULT  (sub-agent's tool calls)
  
  CUSTOM {name: "stigmer:sub_agent_finished", value: {id, status, usage}}
STEP_FINISHED {stepName: "sub_agent:code_reviewer"}
```

The frontend identifies sub-agent boundaries by matching `stigmer:sub_agent_started` / `stigmer:sub_agent_finished` CUSTOM events within a STEP pair. Events between these boundaries belong to the sub-agent's rendering context.

For deeply nested sub-agents (sub-agent delegates to another sub-agent), the pattern nests:

```
STEP_STARTED {stepName: "sub_agent:orchestrator"}
  CUSTOM {stigmer:sub_agent_started}
  
  STEP_STARTED {stepName: "sub_agent:code_reviewer"}
    CUSTOM {stigmer:sub_agent_started}
    // child events
    CUSTOM {stigmer:sub_agent_finished}
  STEP_FINISHED {stepName: "sub_agent:code_reviewer"}
  
  CUSTOM {stigmer:sub_agent_finished}
STEP_FINISHED {stepName: "sub_agent:orchestrator"}
```

**Architect note**: This nesting relies on the AG-UI spec allowing nested STEP pairs (start/finish with matching stepName). The spec says steps are "optional and may occur multiple times within a run" but does not explicitly forbid nesting. POC must validate this assumption.

---

## 4. R2: LangGraph AG-UI Integration Validation

### Current State

There is **no out-of-the-box `LangGraphAGUIAgent` class** that automatically converts all LangGraph events to AG-UI events. The CopilotKit blog and examples show a **manual integration pattern**:

1. Create a FastAPI endpoint accepting `RunAgentInput`
2. Use `EventEncoder` to format SSE events
3. Run the LangGraph graph with streaming
4. Manually map LangGraph streaming events → AG-UI events
5. Yield events through the encoder

### What LangGraph Streaming Provides

LangGraph's `.astream_events()` emits events for:
- Node entry/exit (maps to STEP_STARTED/STEP_FINISHED)
- LLM token streaming (maps to TEXT_MESSAGE_CONTENT)
- Tool call starts and completions (maps to TOOL_CALL_* events)
- Checkpoint creation/restoration

### What Stigmer Needs to Build in the Agent Runner

| Capability | LangGraph Provides | Stigmer Must Add |
|-----------|-------------------|-----------------|
| LLM token streaming → TEXT_MESSAGE events | LLM stream events | Conversion to AG-UI TEXT_MESSAGE_START/CONTENT/END |
| Tool call lifecycle → TOOL_CALL events | Tool node execution events | Conversion to AG-UI TOOL_CALL_START/ARGS/END/RESULT |
| Node transitions → STEP events | Node entry/exit callbacks | Conversion to STEP_STARTED/STEP_FINISHED |
| Reasoning/thinking → REASONING events | Extended thinking (Anthropic) | Extract thinking blocks and emit REASONING_* events |
| HITL interrupt → approval flow | `interrupt_before`/`interrupt_after` | Emit `stigmer:tool_approval_requested`, pause graph, wait for signal, emit `stigmer:tool_approval_resolved` |
| Sub-agent delegation → nested events | Nested graph invocation | Emit `stigmer:sub_agent_started/finished` CUSTOM events wrapping child event sequences |
| Artifacts → CUSTOM events | Not provided | Emit `stigmer:artifact_produced` when agent produces files |
| Usage tracking → CUSTOM events | Per-call token counts | Aggregate and emit `stigmer:usage_update` and `stigmer:message_usage` |

### HITL Interrupt Handling

LangGraph supports `interrupt_before` and `interrupt_after` on nodes, which pauses graph execution and requires a signal to resume. Stigmer's current flow:

1. Agent Runner encounters a tool requiring approval
2. Runner sends `AgentExecution.status.pending_approvals` update to Server
3. Server stores and notifies frontend
4. User approves/skips/rejects via `submitApproval` RPC
5. Server signals Runner via Temporal
6. Runner resumes graph

**AG-UI integration point**: Between steps 2-3, the Runner also emits `stigmer:tool_approval_requested` as a CUSTOM AG-UI event. After step 5, the Runner emits `stigmer:tool_approval_resolved`. The actual approval command still flows through the existing AgentExecution command RPC (submitApproval), not through AG-UI — AG-UI is the rendering notification, not the control channel.

### Extensibility Without Forking

AG-UI's CUSTOM event type is the designated extension mechanism. Stigmer can emit any number of `CustomEvent(name="stigmer:*", value={...})` events without modifying the AG-UI protocol or forking any library. The CopilotKit React UI (or any AG-UI consumer) passes CUSTOM events to registered handlers.

**AI Engineer assessment**: The conversion layer in the Agent Runner is estimated at ~500-800 lines of Python. It's a mapping layer between LangGraph's streaming events and AG-UI events, plus emission of Stigmer CUSTOM events. This is not trivial but is well-bounded and testable.

---

## 5. R3: Frontend Rendering — CopilotKit vs assistant-ui

### CopilotKit React UI

| Criteria | Assessment |
|----------|-----------|
| AG-UI native consumption | Direct — it is AG-UI's reference frontend |
| Message rendering | Streaming text with markdown, code blocks |
| Tool call rendering | Via `useCopilotAction` — but this is for **frontend-defined** tools |
| HITL approvals | Via `useCopilotAction` handler — frontend controls the approval flow |
| Reasoning/thinking | Supported via REASONING events |
| Custom event handling | CUSTOM events can be handled by registered handlers |
| shadcn/Tailwind compatibility | Not documented as shadcn-native; uses its own styling |
| Accessibility | Not explicitly documented |

**Critical architectural mismatch**: CopilotKit's HITL model assumes **frontend-defined tools** where the frontend defines approval tools, the agent calls them, and the frontend handles the interaction locally. Stigmer's model is **backend-controlled approvals** where the Agent Runner pauses at an interrupt point, the Server notifies the frontend, and the frontend sends an approval command back through the gRPC command RPC.

This mismatch means CopilotKit's built-in HITL components (`useCopilotAction`, `useHumanInTheLoop`) would need to be bypassed or significantly adapted. The approval UI would remain a Stigmer custom component (`ApprovalControls.tsx`) that calls `submitApproval()` through the existing execution-service.

### assistant-ui (Fallback)

| Criteria | Assessment |
|----------|-----------|
| AG-UI native consumption | Not native — requires mapping AG-UI events → `ThreadMessageLike` format |
| Message rendering | Streaming text with markdown, excellent scroll behavior |
| Tool call rendering | Tool UI registry with per-tool renderers, loading/progress/error states |
| HITL approvals | "Collect human approvals inline" — mentioned but backend-agnostic |
| Custom event handling | Via ExternalStoreRuntime — you own the state, wire callbacks |
| shadcn/Tailwind compatibility | shadcn-native, designed for Tailwind |
| Accessibility | Explicitly emphasized in docs |

assistant-ui's `ExternalStoreRuntime` is more compatible with Stigmer's backend-controlled model: you own the state, drive updates from your gRPC stream, and wire approval callbacks to your command RPCs. The trade-off is that you lose AG-UI native consumption and must maintain a mapping layer from AG-UI events to `ThreadMessageLike`.

### Comparison Matrix

| Dimension | CopilotKit | assistant-ui |
|-----------|-----------|-------------|
| AG-UI alignment | Native | Requires adapter |
| HITL compatibility with Stigmer | Poor (frontend-defined tools) | Better (ExternalStoreRuntime) |
| Styling compatibility | Own system | shadcn-native |
| Maturity for custom backends | Moderate | Strong (ExternalStoreRuntime) |
| Custom component escape hatches | CUSTOM event handlers | Composition around Thread |
| Risk of API churn | Moderate (large ecosystem) | Higher (fast-moving, unstable_* APIs) |
| Sub-agent tree rendering | Not provided | Not provided |

### Rendering Verdict

Neither library provides the execution monitor components Stigmer needs (sub-agent tree, phase banners, replay, artifact viewers, cost attribution). Both provide the chat transcript rendering that AG-UI events feed.

**Recommendation**: Use **CopilotKit React UI** for the AG-UI native rendering path in the POC. Accept that Stigmer's approval flow and execution-phase UI remain custom components. If CopilotKit's styling integration proves problematic in the POC, fall back to assistant-ui with an AG-UI → ThreadMessageLike adapter.

---

## 6. R4: Transport — AG-UI over gRPC-Web

### AG-UI's Native Transports

AG-UI supports HTTP SSE and HTTP Binary (custom format). There is also an `@ag-ui/proto` package listed in docs, but its content is currently empty/undocumented.

### Stigmer's Transport Requirement

Stigmer uses gRPC-Web (Connect-RPC) for all frontend-server communication. The current `subscribe` RPC streams full `AgentExecution` messages. AG-UI events need to flow over the same infrastructure.

### Proposed Approach: Protobuf Wrapper Message

Define a new protobuf message that wraps AG-UI events:

```protobuf
// In apis/ai/stigmer/agentic/agentexecution/v1/agui.proto

message AgUiEvent {
  string event_type = 1;  // AG-UI EventType string (e.g., "TEXT_MESSAGE_CONTENT")
  string payload = 2;     // JSON-serialized AG-UI event data
  int64 timestamp = 3;
  int64 sequence = 4;     // Monotonic sequence number for ordering
}
```

New server-streaming RPC:

```protobuf
// In query.proto
rpc subscribeEvents(AgentExecutionId) returns (stream AgUiEvent) {}
```

### Why JSON-in-Protobuf (Not Pure Protobuf Event Types)

| Option | Pros | Cons |
|--------|------|------|
| **A: JSON payload in protobuf wrapper** | Simple. Forward-compatible with AG-UI spec changes. One message type. | Double-serialization overhead. No proto-level type safety on event payload. |
| **B: Full protobuf equivalents of all 27 AG-UI events** | Proto-level type safety. Efficient serialization. | High maintenance — must mirror every AG-UI spec change. ~27 message types + oneof discriminator. |
| **C: Use AG-UI's @ag-ui/proto package** | Standards-aligned. | Package is empty/undocumented as of Mar 2026. Risky dependency. |

**Recommendation: Option A** for the POC and initial implementation. The AG-UI protocol is pre-1.0 and actively evolving (event types were recently renamed from THINKING to REASONING). A JSON wrapper provides forward compatibility. Migrate to Option B (or C if `@ag-ui/proto` matures) after AG-UI stabilizes at 1.0.

### Transport Performance

Current `subscribe` RPC sends the **full AgentExecution** on every update — O(n) per update where n is the accumulated message/tool-call count.

`subscribeEvents` RPC sends individual AG-UI events — O(1) per event. For an execution with 100 tool calls and 50 messages, this eliminates ~80% of redundant data transfer.

The `subscribe` RPC continues to exist for AgentExecution aggregate data (phase, usage, pending_approvals). The frontend uses both:
- `subscribeEvents` → AG-UI rendering stream
- `subscribe` or polling `get` → AgentExecution aggregate (phase banner, cost summary)

---

## 7. R5: Storage Model

### Event Storage

AG-UI events should be stored as an **append-only event log** per execution:

```
Collection: ag_ui_events
Document: {
  execution_id: string,
  sequence: int64,       // monotonic, gapless
  event_type: string,
  payload: JSON,
  timestamp: int64,
  stored_at: datetime
}
Index: (execution_id, sequence) — primary access pattern
```

### Replay

To reconstruct a full execution view from stored events:
1. Query all events for an execution_id, ordered by sequence
2. Replay through an AG-UI event reducer (same logic as live rendering)
3. This produces the complete message history, tool call states, reasoning blocks

**Replay performance**: For a typical execution (50-200 events), replay is sub-second. For large executions (1000+ events), the MESSAGES_SNAPSHOT event can be emitted periodically by the Runner as a sync point, allowing replay to start from the latest snapshot.

### Retention

| Strategy | When |
|----------|------|
| **Keep indefinitely** | For executions in active sessions (user may replay) |
| **TTL-based cleanup** | Archive/delete events for executions older than N days (configurable per org) |
| **Compact on completion** | After execution completes, optionally compact the event log into a final MESSAGES_SNAPSHOT + summary |

### Relationship to AgentExecution

The event log is a **sibling** to the AgentExecution document, not embedded in it. They share `execution_id` as a join key. This allows:
- AgentExecution to shrink (remove messages/tool_calls arrays from status)
- Event log to be stored/queried/archived independently
- Different retention policies per data type

---

## 8. R6: CopilotKit React UI Evaluation

| Criterion | Finding |
|-----------|---------|
| **License** | MIT. Free for commercial use. No cloud dependency required. |
| **Bundle size** | `@copilotkit/react-ui` ~126k weekly npm downloads. Reasonable bundle for a UI package. |
| **Dependencies** | React 18/19, @copilotkit/react-core. No heavy transitive deps. |
| **shadcn/Tailwind** | Uses its own CSS. Customizable via CSS variables and theme config. Not shadcn-native — styling integration requires wrapping/overriding. |
| **HITL via useCopilotAction** | Frontend-defined tool model. Agent calls a tool, frontend shows UI, user responds. This is inverted from Stigmer's backend-pause model. |
| **Tool rendering** | `useCopilotAction` with `render` option for per-tool custom UI. Works well for frontend-controlled tools. |
| **Streaming** | Native AG-UI event consumption. Streaming text rendering with proper scroll behavior. |
| **Accessibility** | Not explicitly documented. Needs POC validation. |
| **AG-UI CUSTOM event handling** | CUSTOM events can be handled via middleware or event handlers. Not as seamless as standard events. |

### CopilotKit vs assistant-ui for Stigmer

| Factor | CopilotKit Advantage | assistant-ui Advantage |
|--------|---------------------|----------------------|
| AG-UI native | Direct consumption | Needs adapter layer |
| Backend-controlled HITL | Poor fit | ExternalStoreRuntime fits |
| Stigmer design system | Needs styling override | shadcn-native |
| Custom execution UI | CUSTOM event handlers | Composition around Thread |
| Community/stability | Larger (29k stars) | Smaller but UI-focused (8.8k stars) |
| Long-term coupling | AG-UI protocol commitment | Library-level commitment |

---

## 9. R7: Ecosystem & Risk

### AG-UI Protocol Governance

| Factor | Assessment |
|--------|-----------|
| **Owner** | CopilotKit Inc. (open-sourced under their org) |
| **License** | MIT |
| **Stars** | 12.5k (as of Mar 2026) |
| **Spec maturity** | Pre-1.0. Active evolution (THINKING→REASONING rename, interrupts draft, activity events added) |
| **Breaking changes** | Expected before 1.0 (deprecated events will be removed) |
| **Multi-framework** | TypeScript SDK, Python SDK. Framework-agnostic design. |

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **AG-UI spec changes before 1.0** | Medium | Use JSON-in-protobuf wrapper (Option A) for forward compatibility. Pin AG-UI SDK versions. |
| **CopilotKit conflates protocol with product** | Medium | AG-UI is MIT and standalone. Even if CopilotKit pivots commercially, the protocol spec and core SDKs remain usable. |
| **Interrupts draft may not stabilize** | Medium | Stigmer's approval flow uses CUSTOM events + existing command RPCs. Not dependent on the interrupts draft. |
| **No competitor adoption** | Low | AG-UI's value to Stigmer is as a rendering event vocabulary, not as an interoperability standard. Even if adoption stalls, the event types remain useful. |
| **CopilotKit React UI styling mismatch** | Medium | Fall back to assistant-ui if POC reveals deep styling conflicts with Stigmer's design system. |

### Fallback Path

If AG-UI doesn't work out after the POC:
1. **assistant-ui with ExternalStoreRuntime** — map AgentExecution data directly to ThreadMessageLike. Skip the AG-UI event layer entirely.
2. **Vercel AI SDK + custom components** — headless hooks, maximum control, maximum UI maintenance.
3. **Fully custom** — keep the existing ExecutionStream.tsx architecture and improve it incrementally.

---

## 10. Gap Classification

### (a) Solvable with AG-UI extension points (CUSTOM events)

| Gap | CUSTOM Event Solution | Frontend Handling |
|-----|----------------------|-------------------|
| Tool call approval requested | `stigmer:tool_approval_requested` | Render ApprovalControls inline on tool card |
| Tool call skipped | `stigmer:tool_call_skipped` | Update tool card status badge |
| Tool call approval resolved | `stigmer:tool_approval_resolved` | Dismiss approval controls, update status |
| Artifacts produced | `stigmer:artifact_produced` | Render artifact viewer (diff, file download) |
| Todo updates | `stigmer:todo_updated` | Update todo list panel |
| Per-message usage | `stigmer:message_usage` | Show token count + cost on message |
| Execution usage summary | `stigmer:usage_update` | Update cost panel |
| Sub-agent lifecycle | `stigmer:sub_agent_started/finished` | Manage sub-agent tree rendering |
| Context resolution | `stigmer:context_resolved` | Show MCP server status, loaded skills |

### (b) Custom components outside the AG-UI rendering library

| Component | Driven By | Notes |
|-----------|----------|-------|
| **Execution phase banner** | AgentExecution aggregate (subscribe RPC) | Not derivable from AG-UI events |
| **Sub-agent tree navigator** | CUSTOM events + AgentExecution sub_agent_executions | Tree structure from aggregate, expanded detail from events |
| **Approval gate UX** | CUSTOM events + submitApproval command RPC | Rendering trigger from events, action via command |
| **Artifact viewers** | CUSTOM events + getArtifactDownloadUrl query RPC | Notification from events, content from query |
| **Replay controls** | Stored AG-UI event log + custom reducer | Time-based playback from stored events |
| **Cost attribution panel** | CUSTOM events + AgentExecution usage | Aggregate from both layers |
| **Thinking/reasoning blocks** | Standard REASONING events | Collapsible with shimmer during streaming |

### (c) Fundamental incompatibilities

| Issue | Severity | Assessment |
|-------|----------|-----------|
| **CopilotKit HITL model vs Stigmer approvals** | High but addressable | CopilotKit's frontend-tool model is architecturally different from Stigmer's backend-pause model. Stigmer's approval UX must remain a custom component. The rendering stream can still use AG-UI; the approval command flow stays in the existing RPC path. This is not a fundamental incompatibility with AG-UI itself, only with CopilotKit's HITL components. |
| **No nested run tree in AG-UI** | Medium | AG-UI steps are flat. Sub-agent nesting requires CUSTOM events + frontend tree logic. This is additional work but not blocked by the protocol. |
| **AG-UI pre-1.0 instability** | Medium | Mitigated by JSON-in-protobuf wrapper and pinned versions. |

---

## 11. Recommendation

### Verdict: Conditional GO

Proceed to **Step 2 (Frontend POC)** with the following scope:

1. **Mock AG-UI event stream** that covers:
   - Standard events: RUN_STARTED → TEXT_MESSAGE (streaming) → TOOL_CALL (with args streaming) → TOOL_CALL_RESULT → REASONING (thinking block) → RUN_FINISHED
   - CUSTOM events: `stigmer:tool_approval_requested`, `stigmer:sub_agent_started/finished`, `stigmer:artifact_produced`, `stigmer:message_usage`

2. **CopilotKit React UI integration** in `client-apps/web`:
   - Feed mock events into CopilotKit
   - Validate: message rendering, tool call display, reasoning blocks
   - Identify: styling integration issues, CUSTOM event handling patterns

3. **Approval flow validation**:
   - Confirm that Stigmer's custom ApprovalControls can coexist alongside CopilotKit's message rendering
   - Confirm that the `submitApproval` command RPC path works independently of CopilotKit's tool model

4. **Sub-agent rendering validation**:
   - Confirm that nested STEP events work as expected
   - Confirm that CUSTOM events within STEP boundaries can drive a sub-agent tree

### Go/No-Go Criteria for POC

| Criterion | Go | No-Go |
|-----------|-----|-------|
| Standard AG-UI events render correctly in CopilotKit | Messages stream, tool calls display | Events are dropped or misrendered |
| CUSTOM events are accessible to Stigmer handlers | Handlers fire, data is available | CUSTOM events are swallowed silently |
| CopilotKit styling is overridable for Stigmer theme | CSS variables or wrapper approach works | Deep style conflicts require forking |
| Approval controls can coexist | Custom component renders alongside CopilotKit | CopilotKit blocks or conflicts with approval UX |
| Performance under load | 100+ tool calls render without degradation | Visible lag or memory issues |

### What Changes in the Two-Layer Model

The two-layer model from the prior session is validated and refined:

| Layer | Role | Change from Current |
|-------|------|-------------------|
| **AG-UI events** (rendering stream) | Messages, tool calls, reasoning, streaming tokens, CUSTOM events for approval notifications, artifacts, sub-agents | **New** — replaces the rendering data currently embedded in AgentExecution |
| **AgentExecution** (queryable aggregate) | Phase, usage, pending_approvals, artifacts, todos, sub_agent_executions (metadata), error, timestamps | **Reduced** — messages[] and tool_calls[] arrays move to AG-UI event stream. Aggregate becomes a summary/control document. |
| **Frontend consumes both** | AG-UI events → chat rendering; AgentExecution → phase banner, cost panel, sub-agent tree metadata | **New pattern** — dual subscription (events stream + aggregate subscribe/poll) |

---

## Appendix A: AG-UI Event Type Reference

| # | Event Type | Category |
|---|-----------|----------|
| 1 | RUN_STARTED | Lifecycle |
| 2 | RUN_FINISHED | Lifecycle |
| 3 | RUN_ERROR | Lifecycle |
| 4 | STEP_STARTED | Lifecycle |
| 5 | STEP_FINISHED | Lifecycle |
| 6 | TEXT_MESSAGE_START | Text Messages |
| 7 | TEXT_MESSAGE_CONTENT | Text Messages |
| 8 | TEXT_MESSAGE_END | Text Messages |
| 9 | TEXT_MESSAGE_CHUNK | Text Messages (convenience) |
| 10 | TOOL_CALL_START | Tool Calls |
| 11 | TOOL_CALL_ARGS | Tool Calls |
| 12 | TOOL_CALL_END | Tool Calls |
| 13 | TOOL_CALL_RESULT | Tool Calls |
| 14 | TOOL_CALL_CHUNK | Tool Calls (convenience) |
| 15 | STATE_SNAPSHOT | State Management |
| 16 | STATE_DELTA | State Management |
| 17 | MESSAGES_SNAPSHOT | State Management |
| 18 | ACTIVITY_SNAPSHOT | Activity |
| 19 | ACTIVITY_DELTA | Activity |
| 20 | RAW | Special |
| 21 | CUSTOM | Special |
| 22 | REASONING_START | Reasoning |
| 23 | REASONING_MESSAGE_START | Reasoning |
| 24 | REASONING_MESSAGE_CONTENT | Reasoning |
| 25 | REASONING_MESSAGE_END | Reasoning |
| 26 | REASONING_MESSAGE_CHUNK | Reasoning (convenience) |
| 27 | REASONING_END | Reasoning |
| 28 | REASONING_ENCRYPTED_VALUE | Reasoning |

## Appendix B: Stigmer CUSTOM Event Schema (Proposed)

```typescript
// All Stigmer CUSTOM events follow this pattern:
// { type: "CUSTOM", name: "stigmer:<event_name>", value: <typed_payload> }

// Tool approval
interface StigmerToolApprovalRequested {
  toolCallId: string;
  toolCallName: string;
  approvalMessage: string;
  mcpServerSlug?: string;
}

interface StigmerToolApprovalResolved {
  toolCallId: string;
  action: "approve" | "skip" | "reject";
  decidedBy?: string;
  comment?: string;
}

interface StigmerToolCallSkipped {
  toolCallId: string;
  reason?: string;
}

// Sub-agent lifecycle
interface StigmerSubAgentStarted {
  id: string;
  name: string;
  input?: string;
  subject?: string;
}

interface StigmerSubAgentFinished {
  id: string;
  name: string;
  status: "completed" | "failed" | "cancelled";
  output?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
}

// Artifacts
interface StigmerArtifactProduced {
  id: string;
  name: string;
  kind: "file" | "directory";
  mimeType?: string;
  sizeBytes?: number;
}

// Usage
interface StigmerMessageUsage {
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  model: string;
  estimatedCostUsd: number;
  generationDurationMs?: number;
}

interface StigmerUsageUpdate {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  modelBreakdown: Array<{
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

// Context
interface StigmerContextResolved {
  mcpServers: Array<{ slug: string; status: "connected" | "failed" | "pending" }>;
  skillsLoaded: string[];
  summarizationEvents: Array<{ source: string; timestamp: string }>;
}

// Todos
interface StigmerTodoUpdated {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}
```
