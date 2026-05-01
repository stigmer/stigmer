# Task T01: Cursor Harness -- Full Project Plan

**Created**: 2026-04-30
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution**

## Origin

This project was born from the observation that Cursor released a TypeScript SDK (`@cursor/sdk`) enabling programmatic access to Cursor's coding agent. Stigmer already provides a similar agent platform with its own LangGraph-based execution engine. The idea: why not let Stigmer users choose between LangGraph (standard) and Cursor (premium) as the execution engine for their sessions? Stigmer becomes an aggregator -- any execution engine that provides an SDK can be integrated as a harness.

**Reference**: The Cursor TypeScript SDK documentation is at https://cursor.com/docs/sdk/typescript. The SDK is in public beta. The cookbook examples are at https://github.com/cursor/cookbook.

---

## The "Harness" Concept

We chose the word **harness** over "execution_backend" because:
- "Backend" is internal plumbing language; users shouldn't see it.
- A **harness** controls and directs power -- it wraps the execution engine.
- It parallels "test harness" (framework that runs tests) -- an "agentic harness" is the framework that runs agents.
- LangGraph is one harness. Cursor is another. Future SDKs (e.g., from other AI IDE vendors) become additional harnesses.

**Proto field**: `SessionSpec.harness` with enum `Harness` (`HARNESS_LANGGRAPH`, `HARNESS_CURSOR`).

---

## Architecture -- How It Works

### Current State

```
stigmer up
  +-> Register Runner (Apply RPC)
  +-> Start Python process (agent-runner/main.py)
       +-> Temporal Worker polls runner:{id} queue
       +-> Registered activity: ExecuteGraphton
  +-> Start bidi connect stream (heartbeat + commands)
```

### Target State

```
stigmer up
  +-> Register Runner (Apply RPC) [unchanged]
  +-> Start Python process [unchanged]
       +-> Temporal Worker polls runner:{id} queue
       +-> Registered activity: ExecuteGraphton
  +-> Start Node.js process (cursor-runner/main.ts) [NEW]
       +-> Temporal Worker polls SAME runner:{id} queue
       +-> Registered activity: ExecuteCursor [NEW]
  +-> Start bidi connect stream [unchanged]
  +-> Supervise both child processes
```

**Key architectural decisions:**

1. **ONE daemon, ONE Runner resource, ONE task queue.** `stigmer up` starts both workers on the same Temporal queue. Temporal routes by activity type.
2. **Session chooses the harness.** `SessionSpec.harness` determines which activity the Go workflow dispatches (`ExecuteGraphton` vs `ExecuteCursor`).
3. **Runner proto is untouched.** The Runner is infrastructure -- it doesn't know which harnesses run on it. The daemon manages that internally.
4. **No SDK version fields on RunnerConnectionInfo.** We don't capture LangGraph SDK version today; same treatment for Cursor.

---

## Concept Mapping -- Stigmer vs Cursor SDK

| Stigmer Concept | Cursor SDK Equivalent | Alignment |
|---|---|---|
| `Session` (conversation context) | `Agent` (durable, multi-turn state) | Strong |
| `AgentExecution` (single run) | `Run` (one prompt submission) | Strong |
| `AgentMessage` (AI/TOOL/HUMAN/SYSTEM) | `SDKMessage` (assistant/tool_call/thinking/status) | Adaptable |
| `ExecutionPhase` | `RunStatus` (running/finished/error/cancelled) | Strong |
| `ToolCall` (status + approval) | `SDKToolUseMessage` (name + args + result) | Partial |
| `SubAgentExecution` | Task tool / agents config | Moderate |
| `ExecutionConfig.model_name` | `ModelSelection.id` (e.g., "composer-2") | Strong |
| `McpServerUsage` | `mcpServers` on `Agent.create()` | Strong |
| `Skill` (injected context) | System prompt / .cursor/rules | Weak |
| `ExecutionArtifact` | `SDKArtifact` + `agent.listArtifacts()` | Strong |

### Cursor SDK Core Types (for reference)

```typescript
// Agent: durable container with conversation state
interface SDKAgent {
  readonly agentId: string;
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run>;
  close(): void;
  listArtifacts(): Promise<SDKArtifact[]>;
  downloadArtifact(path: string): Promise<Buffer>;
}

// Run: one prompt submission
interface Run {
  readonly id: string;
  readonly status: "running" | "finished" | "error" | "cancelled";
  stream(): AsyncGenerator<SDKMessage, void>;
  wait(): Promise<RunResult>;
  cancel(): Promise<void>;
  conversation(): Promise<ConversationTurn[]>;
}

// SDKMessage: stream events
type SDKMessage =
  | SDKAssistantMessage     // type: "assistant" -- model text output
  | SDKThinkingMessage      // type: "thinking" -- reasoning content
  | SDKToolUseMessage       // type: "tool_call" -- tool invocation
  | SDKStatusMessage        // type: "status" -- cloud lifecycle
  | SDKTaskMessage          // type: "task" -- milestones
  | SDKRequestMessage       // type: "request" -- awaiting user input
  | SDKSystemMessage        // type: "system" -- init metadata
  | SDKUserMessageEvent;    // type: "user" -- echo of prompt

// Agent creation
const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY,
  model: { id: "composer-2" },
  local: { cwd: "/path/to/repo" },       // OR cloud: { repos: [...] }
  mcpServers: { ... },                     // MCP server configs
  agents: { ... },                         // subagent definitions
});

// Cloud options
cloud: {
  repos: [{ url: "https://github.com/org/repo", startingRef: "main" }],
  autoCreatePR: true,
}

// MCP server config
mcpServers: {
  myServer: {
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer ..." },
  },
  localServer: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  },
}

// InteractionUpdate (raw deltas via onDelta callback)
// Includes: text-delta, thinking-delta, tool-call-started,
// tool-call-completed, turn-ended (with usage), shell-output-delta

// TurnEndedUpdate has usage:
usage?: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// Errors
class CursorAgentError extends Error {
  readonly isRetryable: boolean;
  readonly code?: string;
}
// Subtypes: AuthenticationError, RateLimitError, ConfigurationError,
// IntegrationNotConnectedError, NetworkError, UnknownAgentError

// Agent resume (for multi-turn sessions)
const agent = await Agent.resume("agent-abc123", {
  apiKey: process.env.CURSOR_API_KEY,
});
```

---

## Resolved Decisions

| Question | Decision | Rationale |
|---|---|---|
| Where does harness selection live? | **SessionSpec** | User picks harness when creating a session. Immutable after first execution. |
| Runner proto changes? | **None** | Runner is infrastructure, harness-agnostic. |
| Task queue model? | **Same queue, different activity types** | Both workers poll `runner:{id}`. Temporal routes by activity type. |
| Cursor API key ownership? | **Stigmer platform service account** | Customer never sees Cursor. Stigmer absorbs cost, adds platform fee. |
| Cost UX? | **Unified billing** | Same experience as LangGraph. Cursor usage mapped to Stigmer UsageMetrics. |
| Scope? | **Both Cursor Local and Cloud** | User wants both runtimes. |
| HITL? | **Required** | Cannot disable. Research needed on Cursor SDK mechanism. MCP bridge as fallback. |
| Thinking messages? | **Add MESSAGE_THINKING = 5** | New MessageType enum value for both harnesses. |
| CLI bundling? | **Embedded** | Same pattern as Python agentrunner. Compile via `bun build --compile` or similar. |
| Tool inventory? | **Cursor owns its tools** | Cursor built-in tools + MCP from session. No mixing with LangGraph tools. |
| Conversation state? | **Cursor owns state** | Premium value. No pause/resume/recover on Cursor harness. |

---

## Task Breakdown

### T01: Proto Changes (this task)

Add the Harness concept to the proto layer. Minimal, non-breaking changes.

**Files to modify:**

1. **`apis/ai/stigmer/agentic/session/v1/spec.proto`** -- Add `harness` field to `SessionSpec`
2. **`apis/ai/stigmer/agentic/session/v1/enum.proto`** -- Add `Harness` enum (or create new file)
3. **`apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`** -- Add `MESSAGE_THINKING = 5` to `MessageType`

**Proto definitions:**

```protobuf
// In session/v1/enum.proto (or new harness.proto)
enum Harness {
  HARNESS_UNSPECIFIED = 0;  // defaults to LANGGRAPH
  HARNESS_LANGGRAPH = 1;   // Python/LangGraph (standard)
  HARNESS_CURSOR = 2;      // TypeScript/Cursor SDK (premium)
}

// In session/v1/spec.proto
message SessionSpec {
  // ... existing fields 1-10 ...

  // Execution harness for this session.
  //
  // Determines which Temporal activity type is dispatched when an
  // AgentExecution is created in this session:
  // - LANGGRAPH (default): ExecuteGraphton activity -> Python/LangGraph worker
  // - CURSOR: ExecuteCursor activity -> TypeScript/Cursor SDK worker
  //
  // The harness affects which tools the agent has, how conversation state
  // is managed, available models, and billing tier. Once set and an execution
  // has run, the harness is immutable -- changing it would break conversation
  // continuity since each harness owns its own state.
  //
  // When unspecified, defaults to HARNESS_LANGGRAPH.
  Harness harness = 11;
}

// In agentexecution/v1/enum.proto
enum MessageType {
  MESSAGE_TYPE_UNSPECIFIED = 0;
  MESSAGE_HUMAN = 1;
  MESSAGE_AI = 2;
  MESSAGE_TOOL = 3;
  MESSAGE_SYSTEM = 4;

  // Reasoning/thinking content from the model.
  // Emitted by models with extended thinking (e.g., Claude with thinking
  // enabled, Cursor's thinking events). Rendered distinctly from assistant
  // text in the UI (e.g., collapsible thinking block).
  MESSAGE_THINKING = 5;
}
```

**Acceptance criteria:**
- [ ] `Harness` enum added to session proto package
- [ ] `SessionSpec.harness` field added (field number 11)
- [ ] `MESSAGE_THINKING = 5` added to `MessageType` enum
- [ ] `buf lint` passes
- [ ] Generated stubs compile (Go, TypeScript, Python, Java)

---

### T02: HITL Research Spike

Dedicated investigation into how Cursor handles tool approval in the SDK.

**Research questions:**
1. Does `SDKRequestMessage` correspond to tool approval requests? What triggers it?
2. Can we configure Cursor to require approval for ALL tool calls?
3. Is there a way to respond to `SDKRequestMessage` via the SDK?
4. Does `agent.send()` work as a response mechanism when the agent is in a "request" state?
5. Can we inject approval behavior via MCP? (The MCP bridge approach: register a custom MCP server that exposes a `request_approval` tool)

**Cursor IDE behavior (known):**
- Cursor IDE shows approve/reject/skip for tool calls.
- Stigmer's HITL model was directly inspired by Cursor's.
- The SDK might not expose this yet (it's in beta).

**Fallback design (MCP bridge):**
- Cursor runner registers a custom MCP server with every Agent
- MCP server exposes a `stigmer_request_approval` tool
- Agent blueprint includes instructions to call this tool before destructive operations
- When Cursor calls the MCP tool, the runner:
  1. Sets `ExecutionPhase = WAITING_FOR_APPROVAL`
  2. Populates `pending_approvals` on execution status
  3. Blocks until user submits decision via Stigmer's `SubmitApproval` RPC
  4. Returns the decision as the MCP tool result
  5. Cursor continues

**Stigmer as approval middleware:**
- Configure Cursor to approve all tools by default (or via Cursor's own mechanism)
- Stigmer checks the user's approval policies
- If policy says auto-approve: pass through without user interaction
- If policy says requires_approval: pause and show approval UI

**Acceptance criteria:**
- [ ] Document how Cursor SDK handles tool approval requests
- [ ] Prototype the MCP bridge approach (if SDK doesn't expose structured approval)
- [ ] Design decision document with recommended approach

---

### T03: Cursor Runner TypeScript Service

Create the new TypeScript service that acts as a Temporal activity worker.

**Location:** `backend/services/cursor-runner/`

**Structure:**
```
backend/services/cursor-runner/
  package.json
  tsconfig.json
  src/
    main.ts                    # Entry point: connect to Temporal, register activities
    worker/
      worker.ts                # Temporal Worker setup + activity registration
      activities/
        execute_cursor.ts      # ExecuteCursor activity implementation
    adapter/
      message_translator.ts    # SDKMessage -> AgentMessage translation
      mcp_resolver.ts          # Stigmer McpServerUsage -> Cursor McpServerConfig
      usage_tracker.ts         # Cursor usage -> Stigmer UsageMetrics
      session_lifecycle.ts     # Cursor Agent create/resume/dispose lifecycle
    client/
      stigmer_client.ts        # gRPC client for UpdateStatus, GetExecution, etc.
```

**ExecuteCursor activity flow:**
1. Read AgentExecution from server (hydrate spec + session)
2. Check if Cursor Agent exists for this session (stored in `session.spec.metadata["cursor_agent_id"]`)
3. If exists: `Agent.resume(agentId)`. If not: `Agent.create(...)` with MCP servers, model, workspace
4. `agent.send(spec.message)` with `onDelta` callback for progressive updates
5. Stream events: translate SDKMessage -> AgentMessage, report via UpdateStatus RPC
6. Collect result: map RunResult to final ExecutionPhase
7. Store `agent.agentId` back to session metadata (for multi-turn)
8. Dispose if session is deleted

**Key adapters:**

```typescript
// MCP resolver: Stigmer McpServerUsage -> Cursor McpServerConfig
function resolveMcpServers(
  sessionUsages: McpServerUsage[],
  mcpServerResources: McpServer[],
): Record<string, McpServerConfig> {
  // For each usage, look up the McpServer resource
  // Map Stigmer's connection config to Cursor's McpServerConfig
  // Support both stdio and http types
}

// Message translator: SDKMessage -> AgentMessage[]
function translateEvent(event: SDKMessage): AgentMessage[] {
  switch (event.type) {
    case "assistant":
      // -> MESSAGE_AI with content text + embedded ToolCalls
    case "tool_call":
      // -> MESSAGE_TOOL with tool_call_id, name, status, result
    case "thinking":
      // -> MESSAGE_THINKING with text and thinking_duration_ms
    case "status":
      // -> SetupProgress updates during CREATING/RUNNING
    case "task":
      // -> MESSAGE_SYSTEM with task milestone text
    // ...
  }
}

// Usage tracker: Cursor TurnEndedUpdate -> Stigmer UsageMetrics
function mapUsage(cursorUsage: CursorUsage): UsageMetrics {
  // Map inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens
  // Calculate estimated_cost_usd based on Stigmer's pricing model
}
```

**Acceptance criteria:**
- [ ] TypeScript service compiles and starts
- [ ] Connects to Temporal and registers `ExecuteCursor` activity
- [ ] Polls the runner's task queue
- [ ] Creates Cursor Agent from AgentExecution spec
- [ ] Streams events and reports status
- [ ] Handles errors gracefully (maps CursorAgentError to ExecutionPhase)

---

### T04: Go Workflow Dispatch Update

Update the Go workflow to dispatch the correct activity based on session harness.

**Files to modify:**

1. **`backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`**
   - Read `session.spec.harness` after loading the session
   - Dispatch `ExecuteGraphton` (default) or `ExecuteCursor` based on harness value

2. **`backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go`**
   - `DispatchResult` may need to carry the harness value so the workflow knows which activity to call
   - OR: workflow reads session directly (already does for runner_id)

**Change scope:**

```go
// In invoke_workflow_impl.go
func (w *InvokeAgentExecutionWorkflowImpl) Execute(ctx workflow.Context, input WorkflowInput) error {
    // ... existing setup ...
    
    session := loadSession(ctx, input.SessionID)
    
    // Determine activity based on harness
    activityName := "ExecuteGraphton" // default
    if session.Spec.Harness == sessionv1.Harness_HARNESS_CURSOR {
        activityName = "ExecuteCursor"
    }
    
    // Dispatch activity on the runner's task queue
    activityOpts := workflow.ActivityOptions{
        TaskQueue:           dispatch.TaskQueue,
        StartToCloseTimeout: 24 * time.Hour,
        HeartbeatTimeout:    2 * time.Minute,
    }
    err := workflow.ExecuteActivity(
        workflow.WithActivityOptions(ctx, activityOpts),
        activityName,
        executionInput,
    ).Get(ctx, nil)
    // ...
}
```

**Acceptance criteria:**
- [ ] Workflow reads session harness
- [ ] Dispatches correct activity type
- [ ] Default behavior (UNSPECIFIED/LANGGRAPH) is unchanged
- [ ] Activity options (timeouts, heartbeat) are appropriate for Cursor

---

### T05: CLI Daemon Multi-Worker Management

Update the CLI daemon to start and supervise both Python and TypeScript workers.

**Files to modify:**

1. **`client-apps/cli/internal/cli/runner/start.go`**
   - `startNativeRunner()` spawns Python process (existing)
   - Add: start TypeScript process alongside Python
   - Supervise both child processes

2. **`client-apps/cli/internal/cli/daemon/daemon_process.go`**
   - `buildComponents()` includes the cursor-runner as a new component
   - Start after Python agent-runner

3. **`client-apps/cli/embedded/cursorrunner/`** (NEW)
   - Embedded TypeScript source (mirroring `embedded/agentrunner/`)
   - `cursorrunner.go` with `SourceFS()` function
   - Build tag: `embed_cursorrunner`

4. **`client-apps/cli/internal/cli/runner/runner_env.go`**
   - Add Cursor-specific env vars (STIGMER_CURSOR_API_KEY, etc.)

**Node.js runtime strategy:**
- Option A: Bundle standalone Node.js binary (like python-build-standalone)
- Option B: Use `bun build --compile` to produce a single executable (no runtime needed)
- Option C: Use Deno compile for single binary
- **Recommendation: Evaluate during T03.** Bun compile is the most promising for zero-dependency embedding.

**Acceptance criteria:**
- [ ] `stigmer up` starts both Python and TypeScript workers
- [ ] Both poll the same `runner:{id}` task queue
- [ ] Graceful shutdown sends SIGTERM to both
- [ ] If one crashes, the other continues running
- [ ] Log output from both processes is visible

---

### T06: Cost Model and Billing Integration

Design and implement unified cost tracking.

**Architecture:**
- Stigmer holds a **platform-level Cursor service account API key**
- All Cursor SDK calls use this key
- Cursor bills Stigmer based on usage
- Stigmer adds a platform fee and presents unified billing to customers

**Cost data flow:**
1. Cursor `TurnEndedUpdate` reports: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`
2. Cursor runner adapter maps to Stigmer `UsageMetrics` format
3. Stored on `AgentExecutionStatus` like LangGraph usage
4. Team usage dashboard shows the same structure regardless of harness

**Model name mapping:**
- LangGraph: `model_name = "claude-sonnet-4-20250514"` (LLM provider model ID)
- Cursor: `model_name = "composer-2"` (Cursor model ID)
- The adapter translates based on session harness. No new proto field needed.

**Acceptance criteria:**
- [ ] Cursor token usage captured and mapped to Stigmer UsageMetrics
- [ ] Usage dashboard shows Cursor executions same as LangGraph
- [ ] Cost calculation applies Stigmer's pricing model to Cursor usage
- [ ] Service account API key injected via platform config (not user-facing)

---

### T07: Session Lifecycle -- Cursor Agent Management

Map Stigmer Session lifecycle to Cursor Agent lifecycle.

**Mapping:**
| Stigmer Session Event | Cursor Agent Action |
|---|---|
| First execution | `Agent.create()` -> store `agent.agentId` in `session.spec.metadata["cursor_agent_id"]` |
| Subsequent execution | `Agent.resume(agentId)` -> `agent.send(message)` |
| Session delete | `Agent.delete(agentId)` or `Agent.archive(agentId)` |

**Storage:** The Cursor `agentId` is stored in `SessionSpec.metadata` (existing `map<string, string>` field) as key `cursor_agent_id`. No proto changes needed.

**Multi-turn flow:**
```
Session created (harness=CURSOR, no cursor_agent_id yet)
  |
  v
Execution 1: Agent.create() -> agentId = "agent-abc123"
             Store cursor_agent_id = "agent-abc123" in session metadata
             agent.send(message1) -> stream -> report status
  |
  v
Execution 2: Agent.resume("agent-abc123")
             agent.send(message2) -> stream -> report status
             (full conversation context retained by Cursor)
  |
  v
Session delete: Agent.delete("agent-abc123")
```

**Acceptance criteria:**
- [ ] First execution creates Cursor Agent and stores ID
- [ ] Subsequent executions resume the same Agent
- [ ] Session deletion cleans up the Cursor Agent
- [ ] Agent ID persists across runner restarts (stored in session metadata on server)

---

### T08: SDK/React -- Session Harness Picker

Update the TypeScript SDK and React components to support harness selection.

**SDK changes:**
- `SessionInput` type gets optional `harness` field
- `SessionClient.create()` passes harness to server

**React changes:**
- Session composer UI shows harness selector (if multiple harnesses available)
- `useCreateSession` hook accepts `harness` option
- Session detail view shows which harness is active
- Model picker filters models based on harness (LangGraph models vs Cursor models)

**Acceptance criteria:**
- [ ] SDK `SessionInput` includes `harness` field
- [ ] React session composer shows harness option
- [ ] Created sessions have correct harness value
- [ ] UI indicates which harness a session uses

---

### T09: Embedded Cursor Runner Packaging

Package the cursor-runner for embedding in the CLI binary.

**Strategy evaluation:**
- `bun build --compile` produces single executable (no runtime dependency)
- Alternative: bundle Node.js + compiled JS (like python-build-standalone pattern)
- Alternative: Deno compile

**Embedding pattern (mirroring Python agentrunner):**
```
client-apps/cli/embedded/
  agentrunner/              # existing Python
    agentrunner.go          # SourceFS()
    agentrunner_dev.go      # dev mode
    ...
  cursorrunner/             # NEW
    cursorrunner.go         # SourceFS()
    cursorrunner_dev.go     # dev mode
    ...
```

**Build:**
- `go build -tags embed_agentrunner,embed_cursorrunner` for release
- Dev mode: source from local filesystem

**Acceptance criteria:**
- [ ] Cursor runner binary embedded in CLI
- [ ] `stigmer up` extracts and runs it
- [ ] Cross-platform: darwin/arm64, darwin/amd64, linux/amd64
- [ ] Dev mode works without embedding

---

## Feature Parity Matrix

| Feature | LangGraph Harness | Cursor Harness | Notes |
|---|---|---|---|
| Multi-turn conversation | Yes | Yes | Both retain context |
| Tool execution | Stigmer custom tools | Cursor built-in tools | Value prop of premium |
| MCP server integration | Yes | Yes | Session MCP usages -> Cursor mcpServers |
| Skills (injected context) | Yes (system prompt) | Partial (prompt prefix) | Map skill content to prompt |
| Sandbox isolation | Docker | Cursor Cloud VM | Different mechanisms |
| Pause/Resume | Yes (LangGraph checkpoint) | No | Cursor owns state |
| HITL Approval | Full flow | Research needed (T02) | Required, not optional |
| Artifacts | Yes | Yes | Good alignment |
| Streaming | Yes | Yes | Adapter translates events |
| Subagents | Yes | Yes (Cursor built-in) | Cursor has sophisticated support |
| Context management | Stigmer summarization | Cursor handles internally | Premium benefit |
| Cost tracking | Stigmer UsageMetrics | Cursor usage -> UsageMetrics | Unified billing |
| Local execution | Python process | Cursor Local (cwd) | Both supported |
| Cloud execution | Docker / ephemeral | Cursor Cloud (VM) | Both supported |
| Git write-back | Workspace write-back | Cursor autoCreatePR | Map to same UX |

---

## Open Items

1. **Cursor SDK beta risk** -- APIs may change before GA. Design adapters with a clean boundary so changes are isolated.
2. **Cursor Agent lifecycle edge cases** -- What happens when a Cursor Agent expires? When the Cursor service is down? Need error handling design.
3. **Model catalog sync** -- Cursor models available via `Cursor.models.list()`. Should Stigmer sync these and show them in the model picker for Cursor harness sessions?
4. **Cursor Cloud workspace** -- How to map Stigmer's `WorkspaceEntry` (git repos, local paths) to Cursor's `cloud.repos` config.
5. **Cursor subagents** -- Cursor has a built-in `agents` config on `Agent.create()`. Could map Stigmer's sub-agent concept here.

---

## Phased Delivery Order

| Phase | Tasks | What it delivers |
|---|---|---|
| **Phase 1: Foundation** | T01 (protos), T02 (HITL research) | Proto layer ready, HITL approach decided |
| **Phase 2: Core Engine** | T03 (cursor-runner service), T04 (workflow dispatch) | End-to-end execution via Cursor SDK |
| **Phase 3: CLI Integration** | T05 (daemon multi-worker), T09 (embedded packaging) | `stigmer up` runs both harnesses |
| **Phase 4: Polish** | T06 (cost model), T07 (session lifecycle), T08 (SDK/React) | Production-ready UX |

---

## Review Process

**What happens next**:
1. **You review this plan** -- all the details from our brainstorming are here
2. **Provide feedback** -- challenge anything, add what's missing
3. **I'll revise** -- create T01_2_revised_plan.md with your feedback
4. **You approve** -- then we start with T01 (proto changes)

**Please consider**:
- Is "harness" the right name? Does `SessionSpec.harness` feel natural?
- Is the phased delivery order correct?
- Any tasks missing?
- Should T02 (HITL research) happen before or in parallel with T01 (protos)?
