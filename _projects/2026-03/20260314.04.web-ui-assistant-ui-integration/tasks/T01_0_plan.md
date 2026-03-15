# Task T01: Research Spike — AG-UI Protocol + UI Library Evaluation

**Created**: 2026-03-14
**Updated**: 2026-03-15
**Status**: PENDING REVIEW
**Duration**: ~2 days

## Background

Stigmer needs a web UI for agent execution monitoring. After evaluating the landscape (PI mono's Lit-based web-ui, assistant-ui, CopilotKit, Vercel AI SDK, and 10+ other libraries), and informed by a ChatGPT Deep Research report, the strategy has evolved:

### Key Architectural Insight: Two-Layer Model

Instead of converting Stigmer's protobuf execution data into a UI library's format (adapter pattern), we adopt **AG-UI as the rendering event protocol** alongside Stigmer's existing AgentExecution protobuf aggregate:

| Layer | Purpose | Produced By | Consumed By |
|-------|---------|-------------|-------------|
| **AgentExecution** (protobuf) | Queryable aggregate — phase, usage, pending approvals, artifacts, sub-agent metadata | Agent Runner (Python) | Stigmer Server (storage + query RPCs), backend operations |
| **AG-UI Events** (event stream) | Rendering stream — messages, tool calls, thinking, streaming tokens | Agent Runner (Python) | Frontend (CopilotKit/assistant-ui renders these) |

**Critical architectural principle**: The Agent Runner derives BOTH outputs. The Stigmer Server is a control plane — it stores and forwards. It does NOT interpret AG-UI events or project them into AgentExecution aggregates. The Agent Runner understands execution semantics (phases, usage, approvals) and sends AgentExecution status updates directly, just as it does today.

### Flow

```
Agent Runner (Python/LangGraph)
  ├── LangGraphAGUIAgent → AG-UI events (rendering stream)
  ├── AgentExecution status updates (phase, usage, pending_approvals, etc.)
  │   (same as today — Runner derives these, not the Server)
  │
  └── Both sent to Stigmer Server via gRPC

Stigmer Server (Go) — Control Plane
  ├── Stores AG-UI events (append-only event log)
  ├── Stores AgentExecution aggregate (as received from Runner)
  ├── Streams AG-UI events to subscribed frontends (gRPC-Web)
  └── Serves AgentExecution via query/command RPCs (list, get, approve, cancel)

Frontend (Browser)
  ├── Receives AG-UI events → CopilotKit or assistant-ui renders
  ├── Receives AgentExecution aggregate → phase banners, sub-agent tree, cost
  └── Stigmer custom components for execution-specific UI
```

### Why AG-UI (Not Custom Adapter)

- LangGraph already has `LangGraphAGUIAgent` that converts LangGraph events → AG-UI events
- AG-UI defines 17 standard event types (messages, tool calls, steps, state, lifecycle, reasoning)
- CopilotKit React UI natively consumes AG-UI events — less custom rendering code
- Industry-aligned protocol (12.5k GitHub stars, open spec, multi-framework support)
- Eliminates the current bandwidth problem: `subscribe` RPC sends full AgentExecution on every update (O(n) per update); AG-UI events are incremental (O(1) per event)

### What AgentExecution Becomes (Reduced)

The AgentExecution aggregate may no longer need to carry full message/tool-call arrays. It becomes the **summary/queryable layer**:

**Stays in AgentExecution**: phase, usage, error, started_at, completed_at, artifacts, pending_approvals, todos, resolved_context, context_info, sub_agent_executions (metadata: id, name, status, usage — not full messages/tool_calls)

**Moves to AG-UI event stream**: message content, tool call arguments/results, streaming tokens, thinking blocks — everything the frontend needs to render the execution timeline

## Objective

Produce a **go/no-go decision** on AG-UI as Stigmer's rendering event protocol, supported by:
1. Event mapping analysis (Stigmer concepts → AG-UI events)
2. Working proof-of-concept (AG-UI events → CopilotKit or assistant-ui rendering)
3. Gap analysis (what AG-UI covers vs. what requires custom components)

## Research Questions

### R1: AG-UI Event Mapping
- Map every Stigmer execution concept to an AG-UI event type or CUSTOM extension:
  - Streaming AI messages → TEXT_MESSAGE_START / CONTENT / END
  - Tool call lifecycle (pending, running, completed, failed, waiting_approval, skipped) → TOOL_CALL_START / ARGS / END / RESULT + custom status metadata
  - Sub-agent delegation → STEP_STARTED / STEP_FINISHED (can they nest? carry child messages?)
  - HITL approval requests → CUSTOM event? Or TOOL_CALL with specific metadata?
  - Thinking blocks → REASONING_* events
  - Artifacts → CUSTOM event?
  - Execution phase transitions → RUN_STARTED / RUN_FINISHED / RUN_ERROR
- Identify gaps where AG-UI's 17 events + CUSTOM are insufficient

### R2: LangGraphAGUIAgent Validation
- Does `LangGraphAGUIAgent` emit all events Stigmer needs?
- How does it handle sub-agent delegation (nested LangGraph invocations)?
- How does it handle HITL interrupt points (LangGraph `interrupt_before` / `interrupt_after`)?
- Does it emit REASONING events for extended thinking?
- What events does it NOT emit that Stigmer would need to add?
- Can Stigmer extend the conversion (add custom events) without forking?

### R3: Frontend Rendering
- **CopilotKit React UI**: Feed AG-UI events into CopilotKit's components. Does it render messages, tool calls, streaming, and approvals correctly?
- **assistant-ui alternative**: If CopilotKit doesn't fit, can AG-UI events be converted to assistant-ui's ThreadMessageLike format as a fallback?
- What custom Stigmer components are needed alongside the library (phase banners, sub-agent tree, artifact viewer, cost attribution)?

### R4: Transport — AG-UI over gRPC-Web
- AG-UI typically uses HTTP/SSE. Stigmer uses gRPC-Web.
- Can AG-UI events be serialized as protobuf messages and streamed over gRPC server-streaming?
- Options: (a) Define a protobuf `AgUiEvent` message type that wraps AG-UI JSON, (b) Stream AG-UI events as JSON strings within a protobuf wrapper, (c) Define protobuf equivalents of all 17 AG-UI event types
- Which option preserves AG-UI compatibility while fitting Stigmer's gRPC infrastructure?

### R5: Storage Model
- How to store AG-UI events alongside AgentExecution?
- Append-only event log (separate collection/table) per execution?
- Replay performance: can the frontend reconstruct a full execution view from stored events?
- Retention and cleanup: events for completed executions — keep forever? TTL?

### R6: CopilotKit React UI Evaluation
- Is `@copilotkit/react-ui` truly MIT and free for Stigmer's use case (no cloud dependency)?
- Bundle size and dependency footprint
- shadcn-ui / Tailwind compatibility with Stigmer's existing theme
- HITL via `useHumanInTheLoop` — does it map to Stigmer's approval flow?
- Tool rendering via `useRenderToolCall` — per-tool custom renderers?
- How does it compare to assistant-ui for Stigmer's specific needs?

### R7: Ecosystem & Risk
- AG-UI protocol governance: who controls it? Release cadence? Breaking changes?
- CopilotKit open-source vs. cloud: is the React UI package truly independent?
- What happens if AG-UI evolves in a direction that doesn't serve Stigmer?
- Fallback: if AG-UI doesn't work, the assistant-ui adapter path is still available

## Approach

### Step 1: AG-UI Deep Dive (Day 1 morning)
- Read AG-UI protocol spec (all 17 event types, their fields, semantics)
- Read LangGraphAGUIAgent source code (what events it emits, how it converts)
- Map Stigmer's execution model onto AG-UI events (document every concept)
- Identify gaps and CUSTOM event needs

### Step 2: Frontend POC (Day 1 afternoon + Day 2 morning)
- Install CopilotKit React UI in Stigmer's `client-apps/web`
- Create mock AG-UI event stream (hardcoded events matching Stigmer's execution shapes)
- Render: user message → AI streaming → tool call → tool result → approval gate
- Test: Does CopilotKit handle it? What's missing?
- If CopilotKit doesn't fit: quick assistant-ui comparison with same mock data

### Step 3: Transport Spike (Day 2 morning)
- Prototype: AG-UI events serialized over gRPC server-streaming
- Determine the protobuf wrapper approach
- Verify: can the frontend deserialize and pass to CopilotKit?

### Step 4: Gap Analysis & Decision (Day 2 afternoon)
- Document all gaps from POC
- Classify: (a) solvable with library extension points, (b) custom component alongside library, (c) fundamental incompatibility
- Write go/no-go recommendation
- If go: outline the implementation plan (T02+)
- If no-go: document pivot strategy

## Deliverables

1. **AG-UI Event Mapping Document** — Every Stigmer concept mapped to AG-UI events, with gap annotations
2. **Working POC** — AG-UI events rendered through CopilotKit (or assistant-ui) in Stigmer's web app
3. **Transport Spike** — AG-UI events over gRPC-Web prototype
4. **Gap Analysis** — Classified list with mitigations
5. **Go/No-Go Decision** — With documented rationale

## Success Criteria

- All 7 research questions (R1–R7) have documented answers
- POC demonstrates: message rendering, streaming, tool call display, HITL approval
- Transport prototype proves AG-UI events can flow over gRPC-Web
- Decision is clear and justified

## Non-Goals for T01

- Production-quality code (this is a spike)
- Agent Runner changes (Python/LangGraph modifications are a separate task)
- Replacing existing execution components (that's T02+)
- AG-UI event storage implementation (that's T03+)

## References

- AG-UI protocol spec: https://docs.ag-ui.com/concepts/events
- AG-UI GitHub: https://github.com/ag-ui-protocol/ag-ui
- CopilotKit React UI: https://github.com/CopilotKit/CopilotKit
- CopilotKit + LangGraph guide: https://copilotkit.ai/blog/how-to-add-a-frontend-to-any-langgraph-agent-using-ag-ui-protocol
- assistant-ui (fallback): https://www.assistant-ui.com/docs/runtimes/custom/external-store
- Stigmer execution protos: `apis/ai/stigmer/agentic/agentexecution/v1/`
- Stigmer execution components: `client-apps/web/src/components/execution/`
- ChatGPT Deep Research report: `research.ai-chat-ui-landscape/04.report.gpt.md`
