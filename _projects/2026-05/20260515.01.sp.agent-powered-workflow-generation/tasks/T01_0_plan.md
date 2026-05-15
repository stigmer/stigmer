# Task T01: Agent-Powered Workflow Generation — Full Rewrite

**Created**: 2026-05-15
**Status**: PENDING REVIEW
**Type**: Architectural Rewrite
**Spawned From**: T16 (Natural Language to Workflow) — AD-T16-001 reversal
**Parent Project**: 20260508.01.bring-workflows-to-foreground

## Objective

Delete the entire direct-LLM workflow generation infrastructure (T16 Batches 1–4) and replace it with a **Workflow Architect agent** that uses the existing Cursor harness, MCP server tool introspection, and streaming agent sessions. The agent approach produces higher-quality workflows by dynamically querying org resources, introspecting MCP server tool schemas, and validating output through tool use — instead of guessing from a flat prompt.

## Why This Rewrite

The direct LLM approach (AD-T16-001) was chosen for simplicity, but it sacrifices capability:

| Capability | Direct LLM (current) | Workflow Architect Agent (target) |
|---|---|---|
| Org resource context | Slug + description only | Full agent specs, MCP tool schemas, skill details via tool calls |
| Validation | Crude retry (max 2) with error text | Interactive tool-use loop — validate, inspect errors, fix |
| Progress visibility | Loading spinner, 1-3s | Streaming messages — user sees agent thinking and working |
| MCP integration | None — LLM cannot call MCP tools | Agent connects to MCP servers, introspects capabilities |
| Extensibility | Prompt template changes only | New tools, skills, harness features — all automatically available |
| Multi-turn refinement | Stateless (yaml + instruction per call) | Conversational context within a session |
| Diagnosis depth | Flat error context in prompt | Agent can query execution events, inspect task configs, cross-reference |

## Architectural Decision: AD-SP01-001

**Decision**: Workflow generation, refinement, and diagnosis are agent sessions, not direct LLM RPC calls.

**What changes**:
- `generateWorkflowFromPrompt`, `refineWorkflow`, `diagnoseWorkflowExecution` RPCs are **deleted** from `command.proto`
- `GenerateWorkflowFromPromptInput/Output`, `RefineWorkflowInput/Output`, `DiagnoseWorkflowExecutionInput/Output` messages are **deleted** from `io.proto`
- A built-in **"Workflow Architect"** agent is created with MCP connections and workflow-specific skills
- The frontend launches agent sessions instead of calling direct RPCs
- Users see streaming agent messages with full observability

**What stays the same**:
- The YAML editor (T10), visual canvas (T15), and all other workflow CRUD RPCs remain untouched
- The agent execution infrastructure (Temporal, harness dispatch, HITL, streaming) is reused as-is
- The task kind registry remains the source of truth for workflow schema knowledge

## System Architecture

### End-to-End Flow (Generate)

```
User clicks "Generate Workflow" with a description
  ↓
Frontend: create agent execution via existing AgentExecution.create()
  - agent_id: built-in "workflow-architect" agent
  - harness: HARNESS_CURSOR
  - initial message: user's natural language description
  ↓
stigmer-server / stigmer-service: existing create pipeline
  - Session creation (or reuse for refinement)
  - Temporal workflow start
  - Dispatch to cursor-runner (via {baseQueue}:cursor)
  ↓
cursor-runner: ExecuteCursor activity
  - Agent.create() with Workflow Architect system prompt
  - MCP connections: stigmer-workflow-tools MCP server
  - Agent uses tools to:
    1. list_agents() — discover available agents with full specs
    2. list_mcp_servers() — discover MCP servers with tool schemas
    3. list_skills() — discover available skills
    4. get_task_kind_registry() — load all 19 task kind descriptors
    5. validate_workflow_yaml(yaml) — validate generated YAML
  - Agent generates workflow YAML iteratively with validation
  - Progressive status updates via gRPC
  ↓
Frontend: subscribe to execution messages
  - Real-time streaming of agent thinking / tool calls / progress
  - Final message contains validated workflow YAML
  ↓
Frontend: extract YAML from agent response
  - Parse YAML from the agent's final message
  - Open in WorkflowEditorView (code or visual mode)
```

### Refinement Flow

```
User has workflow open in editor, types "add a human approval before the email"
  ↓
Frontend: create execution in SAME session (conversational context preserved)
  - message: current YAML + instruction
  ↓
Workflow Architect agent:
  - Has prior conversation context (what was generated before)
  - Uses tools to validate the refinement
  - Returns updated YAML + explanation
  ↓
Frontend: diff preview, accept/discard
```

### Diagnosis Flow

```
User views failed execution, clicks "Diagnose"
  ↓
Frontend: create execution with the Workflow Architect agent
  - message: "Diagnose execution {id} for workflow {slug}"
  ↓
Workflow Architect agent:
  - Uses tools to fetch execution status and events
  - Uses tools to load the workflow YAML
  - Analyzes failure with task kind knowledge
  - Suggests fix (with validated YAML if definition error)
  ↓
Frontend: shows diagnosis, optional "Apply Fix"
```

## Component Design

### 1. Workflow Architect Agent (Built-In)

A **system agent** that ships with every Stigmer installation (not user-created). Configured as a seed/default agent during platform setup.

**Agent spec**:
- `name`: "Workflow Architect"
- `slug`: `workflow-architect`
- `system_prompt`: Workflow generation expertise — YAML structure, task kinds, best practices, expression syntax
- `harness`: `HARNESS_CURSOR`
- `mcp_servers`: `["stigmer-workflow-tools"]`
- `model`: configurable (default: high-capability model)
- `is_system`: true (not editable by users, not shown in agent list)

The system prompt is shorter than the current `prompt.go` template because the agent can **dynamically query** context via tools instead of having everything pre-stuffed into the prompt.

### 2. Stigmer Workflow Tools MCP Server

A new MCP server (or set of tools exposed to the agent) that provides introspection and validation capabilities. This runs as part of the platform, not as a user-registered MCP server.

**Tools**:

| Tool | Description | Returns |
|---|---|---|
| `list_agents` | List all agents in the org with full specs | Agent name, slug, description, skills, MCP connections |
| `get_agent` | Get detailed agent spec by slug | Full agent config including system prompt summary |
| `list_mcp_servers` | List MCP servers in the org | Server name, slug, description, tool list |
| `get_mcp_server_tools` | Get tool schemas for a specific MCP server | Tool names, descriptions, parameter schemas |
| `list_skills` | List skills in the org | Skill name, slug, description |
| `get_task_kind_registry` | Get all task kind descriptors | Full registry with fields, examples, categories |
| `get_task_kind` | Get a specific task kind descriptor | Single kind with full detail |
| `list_workflows` | List existing workflows in the org | Workflow name, slug, description, task summary |
| `get_workflow_yaml` | Get a workflow's YAML | Full YAML content |
| `validate_workflow_yaml` | Validate a workflow YAML | Errors and warnings with line references |
| `get_execution_status` | Get execution status and failure details | Phase, error, per-task statuses |
| `get_execution_events` | Get execution event log | Filtered events for diagnosis |

**Implementation**: These tools call the existing Stigmer gRPC APIs internally. The MCP server is a thin adapter over the platform's own APIs — making the agent a consumer of the same APIs that users and the CLI use.

### 3. Frontend Changes

The frontend transitions from form-based dialogs to agent session experiences:

| Current (Delete) | New (Create) |
|---|---|
| `WorkflowGenerateDialog` — form with textarea + generate button | `WorkflowArchitectDialog` — agent session panel with streaming messages |
| `useGenerateWorkflowFlow` — calls `workflow.generateFromPrompt()` RPC | `useWorkflowArchitect` — creates agent execution, subscribes to messages |
| `WorkflowRefinePanel` — instruction input + diff preview | `WorkflowRefinePanel` — agent conversation panel in editor sidebar |
| `useRefineWorkflowFlow` — calls `workflow.refine()` RPC | `useWorkflowArchitect` — same hook, different mode (refine context) |
| `WorkflowRepairCard` — shows diagnosis text | `WorkflowRepairCard` — shows agent diagnosis conversation |
| `useDiagnoseExecution` — calls `workflow.diagnoseExecution()` RPC | `useWorkflowArchitect` — same hook, different mode (diagnose context) |

The `useWorkflowArchitect` hook is the single orchestrator that handles all three modes (generate, refine, diagnose) by creating agent executions with different initial messages and context.

## Deletion Inventory

### Proto (Delete)

| File | What to delete |
|---|---|
| `apis/ai/stigmer/agentic/workflow/v1/io.proto` | `GenerateWorkflowFromPromptInput`, `GenerateWorkflowFromPromptOutput`, `RefineWorkflowInput`, `RefineWorkflowOutput`, `DiagnoseWorkflowExecutionInput`, `DiagnoseWorkflowExecutionOutput` |
| `apis/ai/stigmer/agentic/workflow/v1/command.proto` | `generateWorkflowFromPrompt`, `refineWorkflow`, `diagnoseWorkflowExecution` RPCs |

### Go Backend — stigmer-server (Delete)

| File | Action |
|---|---|
| `pkg/llmclient/client.go` | **Delete entire file** |
| `pkg/llmclient/prompt.go` | **Delete entire file** |
| `pkg/domain/workflow/controller/generate_workflow.go` | **Delete entire file** |
| `pkg/domain/workflow/controller/refine_workflow.go` | **Delete entire file** |
| `pkg/domain/workflow/controller/diagnose_execution.go` | **Delete entire file** |
| `pkg/domain/workflow/controller/workflow_controller.go` | Remove `llmClient`, `taskKindRegistry` fields + setters |
| `server.go` | Remove LLM client + registry wiring into workflow controller |

### Java Backend — stigmer-service (Delete)

| File | Action |
|---|---|
| `generation/WorkflowPromptBuilder.java` | **Delete entire file** |
| `generation/WorkflowYamlValidator.java` | **Delete entire file** |
| `request/handler/WorkflowGenerateFromPromptHandler.java` | **Delete entire file** |
| `request/handler/WorkflowRefineHandler.java` | **Delete entire file** |
| `request/handler/WorkflowDiagnoseExecutionHandler.java` | **Delete entire file** |

### SDK TypeScript (Delete)

| File | What to delete |
|---|---|
| `sdk/typescript/src/gen/workflow.ts` | `generateFromPrompt()`, `refine()`, `diagnoseExecution()` methods + associated types |

### SDK React (Delete)

| File | Action |
|---|---|
| `sdk/react/src/workflow/useGenerateWorkflowFlow.ts` | **Delete entire file** |
| `sdk/react/src/workflow/useRefineWorkflowFlow.ts` | **Delete entire file** |
| `sdk/react/src/workflow/useDiagnoseExecution.ts` | **Delete entire file** |
| `sdk/react/src/workflow/WorkflowGenerateDialog.tsx` | **Delete entire file** |
| `sdk/react/src/workflow/WorkflowRefinePanel.tsx` | **Delete entire file** |
| `sdk/react/src/workflow/WorkflowRepairCard.tsx` | **Delete entire file** |
| `sdk/react/src/workflow/workflow-yaml-diff.ts` | **Keep** — diff utility is reusable for the new refine panel |
| `sdk/react/src/workflow/index.ts` | Remove deleted exports |
| `sdk/react/src/index.ts` | Remove deleted top-level re-exports |

### Console (Modify)

| File | Change |
|---|---|
| `client-apps/web/src/domain/workflow/WorkflowListPage.tsx` | Replace "Generate" button wiring |
| `client-apps/desktop/src/pages/workflow/WorkflowListPage.tsx` | Replace "Generate" button wiring |
| `sdk/react/src/workflow/WorkflowEditorView.tsx` | Replace "Refine with AI" panel wiring |
| `sdk/react/src/workflow/WorkflowExecutionViewer.tsx` | Replace "Diagnose" button wiring |

### Codegen (Regenerate)

After proto deletions, run `make codegen` (OSS) + `make protos` (Cloud) to regenerate all stubs.

## Batched Execution Plan

### Batch 1: Teardown + Proto Cleanup

> Delete all T16 direct-LLM infrastructure and regenerate stubs.

1. Delete proto messages and RPCs from `io.proto` and `command.proto`
2. Delete Go files: `pkg/llmclient/` (entire directory), `generate_workflow.go`, `refine_workflow.go`, `diagnose_execution.go`
3. Clean up `workflow_controller.go` (remove LLM client fields) and `server.go` (remove wiring)
4. Delete Java files: `WorkflowPromptBuilder.java`, `WorkflowYamlValidator.java`, `WorkflowGenerateFromPromptHandler.java`, `WorkflowRefineHandler.java`, `WorkflowDiagnoseExecutionHandler.java`
5. Delete SDK methods from `workflow.ts`
6. Delete React hooks and components (keep `workflow-yaml-diff.ts`)
7. Remove barrel exports
8. Remove console wiring (generate button, refine panel, diagnose button)
9. Run codegen (`make codegen` + `make protos`)
10. Verify: `go build`, `go vet`, `bazelw build`, `tsc --noEmit` — all clean

**Deliverable**: Clean codebase with no direct-LLM workflow generation code. All three capabilities (generate, refine, diagnose) are temporarily unavailable.

### Batch 2: Workflow Architect Agent + MCP Server

> Create the built-in Workflow Architect agent and the stigmer-workflow-tools MCP server.

1. **Seed agent**: Create the `workflow-architect` system agent — define spec, system prompt, model, harness config
2. **MCP server implementation**: Build the `stigmer-workflow-tools` MCP server with the 12 tools listed above
3. **Agent seeding**: Wire agent creation into platform setup (Go OSS + Java Cloud) so the agent exists on first boot
4. **MCP registration**: Register the MCP server as a platform-level resource

**Key design question**: Where does the MCP server run?
- Option A: Embedded in cursor-runner (TypeScript, co-located with the agent runtime)
- Option B: Standalone MCP server process calling Stigmer gRPC APIs
- Option C: Tools defined as Cursor rules/skills that the agent uses natively

This decision will be resolved during Batch 2 implementation based on the cursor-runner architecture.

**Deliverable**: `workflow-architect` agent and `stigmer-workflow-tools` MCP server exist and are functional. Agent can be invoked via the standard `AgentExecution.create()` flow.

### Batch 3: SDK + Frontend — Generate

> Build the user-facing generation experience using agent sessions.

1. **`useWorkflowArchitect`** — Behavior hook: creates agent execution with `workflow-architect` agent, subscribes to messages, extracts YAML from response, manages FSM (`idle → creating → streaming → extracting → ready | error`)
2. **`WorkflowArchitectDialog`** — Dialog component: prompt textarea, streaming message view, YAML preview on completion, "Open in Editor" action
3. **Console integration**: "Generate" button on WorkflowListPage opens `WorkflowArchitectDialog`
4. **DD-016 parity**: web + desktop

**Deliverable**: Users can generate workflows from natural language via the Workflow Architect agent, seeing the agent work in real-time.

### Batch 4: SDK + Frontend — Refine

> Rebuild the refinement experience as an agent conversation.

1. **`useWorkflowArchitect` extension** — refine mode: sends current YAML + instruction as message in existing session (conversational context)
2. **`WorkflowRefinePanel` (new)** — Agent conversation panel in the editor sidebar, showing streaming messages, diff preview on result, accept/discard
3. **Editor integration**: "Refine with AI" button in `WorkflowEditorView` toolbar

**Deliverable**: Users can iteratively refine workflows through conversation with the agent.

### Batch 5: SDK + Frontend — Diagnose

> Rebuild the diagnosis experience as an agent conversation.

1. **`useWorkflowArchitect` extension** — diagnose mode: sends execution context as message, agent uses tools to inspect failure
2. **`WorkflowRepairCard` (new)** — Agent diagnosis view in execution viewer sidebar, showing streaming diagnosis, suggested fix with diff, "Apply Fix" button
3. **Viewer integration**: "Diagnose" button on failed executions

**Deliverable**: Users can diagnose failed executions with AI-powered analysis via the agent.

## Edition Strategy

### Cloud (Java — stigmer-service)

The Workflow Architect agent runs via the existing `InvokeAgentExecutionWorkflowImpl` (Java Temporal workflow) dispatching to the cursor-runner. No new Java backend code is needed for the agent execution — the existing infrastructure handles it. The MCP server calls back into the Java service via gRPC.

### OSS (Go — stigmer-server)

The Go OSS server already has the full agent execution Temporal infrastructure:
- `agentexecution/controller/create.go` — 14-step pipeline
- `agentexecution/temporal/dispatch.go` — harness-aware runner resolution
- `agentexecution/temporal/workflows/invoke_workflow_impl.go` — CURSOR/NATIVE dispatch
- `agentexecution/temporal/activities/execute_cursor.go` — Cursor activity interface

OSS users need a cursor-runner registered and active (`stigmer up`). The Workflow Architect agent dispatches through the same infrastructure as any other agent.

### Both Editions

The `workflow-architect` agent is seeded as a system resource. The MCP server connects to whichever backend (Go gRPC or Java gRPC) is serving the APIs.

## Naming Conventions

| Convention | Pattern | Examples |
|---|---|---|
| Hook | `useWorkflowArchitect` | Single hook for generate/refine/diagnose modes |
| Dialog | `WorkflowArchitectDialog` | Generation entry point |
| Panel | `WorkflowRefinePanel` | Editor sidebar for refinement |
| Card | `WorkflowRepairCard` | Execution viewer for diagnosis |
| Agent | `workflow-architect` | Built-in system agent |
| MCP Server | `stigmer-workflow-tools` | Platform MCP server |

## Risks

| Risk | Mitigation |
|---|---|
| Agent produces worse YAML than direct prompt | The agent has richer context (tool introspection) and validation loops; quality should be higher. Iterate on system prompt + tools. |
| Cursor-runner cold start delays generation | Solvable infra problem — runner warm pool, pre-boot. Streaming masks perceived latency. |
| OSS users without a running cursor-runner can't generate | Clear error message: "Start a runner with `stigmer up`". The YAML editor (T10/T15) always works as the manual path. |
| MCP server adds complexity | It's a thin adapter over existing gRPC APIs — no new business logic, just protocol translation. |
| Session/execution overhead for a "quick generate" | The agent infrastructure is already optimized for this. Users get more value (streaming, tool use) for minimal extra latency. |
| Breaking change — existing SDK consumers using `generateFromPrompt()` | This is an intentional breaking change. The old API is deleted. SDK consumers switch to the agent-based flow. |

## Open Questions (Resolve During Implementation)

1. **MCP server hosting**: Where does `stigmer-workflow-tools` run? Embedded in cursor-runner vs standalone vs Cursor rules?
2. **Agent seeding mechanism**: How is the `workflow-architect` agent created on first boot? Migration script vs seed data vs on-demand creation?
3. **Session reuse for refinement**: Does refinement create a new session or reuse the generation session? Conversational context suggests reuse.
4. **YAML extraction from agent response**: How does the frontend reliably extract the YAML from the agent's streaming messages? Convention-based (look for ```yaml blocks) vs structured output?
5. **System agent visibility**: Should the `workflow-architect` agent appear in the agent list or be hidden? Likely hidden (`is_system: true`).

## Suggested Starting Point

Begin with **Batch 1 (Teardown)** — clean deletion of all T16 direct-LLM code across both repos, codegen regeneration, and verification that everything compiles cleanly without the deleted code.

---

**Please review this plan and provide your feedback. I will not proceed to execution until you explicitly approve.**
