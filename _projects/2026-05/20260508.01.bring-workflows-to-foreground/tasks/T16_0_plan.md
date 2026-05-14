# Task T16: Natural Language to Workflow

**Created**: 2026-05-14
**Status**: PENDING REVIEW
**Type**: Feature Development (Batched)
**Depends On**: T10 (YAML Editor) — COMPLETE, T04 (Task Schema Registry) — COMPLETE, T15 (Visual Canvas) — COMPLETE
**Phase**: Phase 3 — AI-Assisted Creation

## Objective

Enable users to create, refine, and repair workflows using natural language. A user describes what they want in plain English, and the system generates a valid Stigmer Workflow YAML that opens directly into the schema-aware editor (T10/T15). Follow-on capabilities let users iteratively refine generated workflows through conversation, diagnose failed executions with AI-suggested fixes, and extract repeatable workflow patterns from ad-hoc agent sessions.

## Context

The research report identifies a **three-lane builder** as the ideal workflow creation experience:

1. **Template lane** — start from prebuilt templates (separate task, not T16)
2. **Describe-it lane** — generate from natural language (T16.1 + T16.2)
3. **Power-user lane** — YAML and visual editor (T10 + T15, already complete)

The report specifically states: *"The right Stigmer approach is not to hide the DSL, but to let AI generate it and immediately open it into a schema-aware editor."* This defines the core UX pattern: **generate, then hand off to the editor** — not a chat-based authoring loop that replaces the editor.

The existing foundation provides:

- `parseWorkflowYaml` / `serializeWorkflowYaml` — round-trip YAML pipeline (T10)
- `useWorkflowValidation` — 5-layer validation with source-mapped diagnostics (T10)
- `useTaskKindRegistry` — 19 task kind descriptors with fields, JSON schemas, examples
- `WorkflowEditorView` — code/visual mode toggle, save, validation (T10 + T15)
- `LlmCallService` (Java) — non-streaming metered LLM completions with billing
- Go LLM providers (`pkg/llm/`) — OpenAI + Anthropic providers in workflow-runner (T13)
- Model registry — full model metadata with pricing (stigmer-cloud)

## Scope Definition

T16 covers four distinct sub-capabilities, each independently deliverable:

| Sub-capability | Batch | Summary |
|---|---|---|
| **T16.1: Prompt-to-Workflow** | 1–2 | "Describe what you want" single-shot generation |
| **T16.2: Iterative Refinement** | 3 | "Change the timeout to 5 minutes" multi-turn editing |
| **T16.3: Workflow Repair Assistant** | 4 | "Why did this fail? How do I fix it?" diagnostic aid |
| **T16.4: Session-to-Workflow** | 5 | "Turn this agent session into a repeatable workflow" |

Each sub-capability can be shipped independently. T16.1 is the foundation; T16.2–T16.4 build on it.

## Architectural Decisions

### AD-T16-001: Server-Side Generation via Direct LLM Call, Not a Stigmer Agent

**Decision**: Workflow generation uses a new backend RPC that calls an LLM directly (via `LlmCallService` in Java, via a minimal HTTP client in Go). It does NOT create a Stigmer Agent with MCP connections.

**Rationale**: This is the most consequential decision in T16 and deserves careful examination.

**The Agent approach (considered and rejected for T16.1):**

A Stigmer Agent with MCP connections to the Stigmer API and "workflow creation" skills is conceptually appealing — it eats our own dogfood. The agent could use tools to look up available agents, MCP servers, and skills in the organization, then iteratively generate and validate workflow YAML.

However, for the initial generation use case, this approach has significant drawbacks:

1. **Circular dependency.** The agent system depends on the workflow infrastructure. If the agent runtime is down, users cannot create workflows. If the workflow generation agent itself needs updating, you need the system to be working to update the system.

2. **Disproportionate machinery.** Prompt-to-workflow is fundamentally a single-shot structured-output task: natural language in, valid YAML out. Routing this through Agent → Session → AgentExecution → Temporal → Agent Runner → LLM → back adds five indirection layers, each with latency, failure modes, and state management overhead. The LLM does not need tools to generate a workflow — it needs context, which we can provide in the prompt.

3. **No tool use required.** The task kind registry provides complete schema metadata for all 19 task kinds. The server can query the database for available agents, MCP servers, and skills in the organization. This context fits easily in a single prompt — no MCP tool calls needed.

4. **Latency.** An agent-based approach adds 2–5 seconds of Temporal scheduling overhead before the LLM call even begins. For a generation feature that users expect to feel instant (like autocomplete), this is unacceptable.

**The direct LLM call approach (chosen):**

The server constructs a rich prompt containing: task kind registry metadata, 2–3 example workflows, available agents/MCP servers/skills in the org, and the user's natural language description. The LLM returns structured output (valid workflow YAML + explanation). The server validates the output through the existing validation pipeline before returning it.

This approach is:
- **Fast**: single HTTP call to the LLM provider (~1–3s)
- **Simple**: no orchestration, no state machines, no Temporal
- **Reliable**: no circular dependencies on the agent system
- **Metered**: uses existing billing infrastructure (`LlmCallService`, Go LLM providers)
- **Updatable**: prompt templates live server-side, improvable without SDK releases

**When the Agent approach becomes right:**

The Agent approach is appropriate for deeply interactive, multi-turn, tool-using scenarios — for example, a "Workflow Architect" agent that a user can chat with over many turns while it explores the organization's resources, tries different approaches, and runs validation. That is a Phase 4+ capability, not Phase 3. T16.2 (iterative refinement) gets close to this territory but still does not need tools — just accumulated conversation context.

### AD-T16-002: Prompt Template Lives Server-Side

**Decision**: The prompt template (system instructions, task registry context, example workflows) is constructed server-side in the RPC handler, not in the frontend SDK.

**Rationale**: Prompt engineering is an iterative process. Placing the template server-side means we can improve generation quality by updating the backend without requiring SDK or frontend releases. This follows the same pattern as `LlmCallService` already used for session subject generation — the prompt is an implementation detail of the server, not a client concern. The frontend sends only the user's natural language description and optional hints.

### AD-T16-003: Generate YAML, Not WorkflowInput

**Decision**: The LLM generates raw YAML text (the user-facing format), not a JSON WorkflowInput object.

**Rationale**: YAML is the canonical authoring format. The LLM can produce readable, well-structured YAML that the user can immediately understand and edit. After generation, the server validates the output through `parseWorkflowYaml()` (or Go equivalent), which catches structural errors before the YAML reaches the user. If validation fails, the server can retry with the error messages as correction context (up to a configurable retry limit). This is simpler and more transparent than having the LLM produce an intermediate JSON format that then needs conversion.

### AD-T16-004: Edition Classification — Core Feature (Both Editions)

**Decision**: Workflow generation is a core feature implemented in both OSS (Go) and Cloud (Java).

**Rationale**: The ability to generate workflows from natural language is fundamental to the creation experience, not a cloud-only enterprise feature. The OSS user provides their own LLM API key (via environment variable or configuration). The Cloud edition uses the platform's managed LLM proxy with billing metering. Both editions use the same proto contract and produce identical results.

### AD-T16-005: Validation-in-the-Loop

**Decision**: The server validates generated YAML before returning it. If validation fails, the server retries with error context (max 2 retries). The response always includes validation results so the client knows whether the YAML is clean or has warnings.

**Rationale**: Returning invalid YAML wastes the user's time. LLMs occasionally produce malformed output — missing required fields, unknown task kinds, invalid expressions. By validating server-side and retrying with the error messages, we can correct most issues before the user ever sees them. The client still receives validation results (errors/warnings) for transparency.

## Data Architecture

### Generation Flow

```
User prompt (natural language)
  ↓
Frontend: useGenerateWorkflow(prompt, options)
  ↓
RPC: generateWorkflowFromPrompt(GenerateWorkflowFromPromptInput)
  ↓
Server: construct prompt
  ├── Task kind registry (19 kinds with descriptions, fields, examples)
  ├── Org context (available agents, MCP servers, skills — optional)
  ├── Example workflow YAMLs (2-3 canonical examples)
  └── User's natural language description
  ↓
Server: LLM call (structured output)
  ↓
Server: validate generated YAML (parseWorkflowYaml equivalent)
  ├── Valid → return YAML + explanation
  └── Invalid → retry with error context (max 2 retries)
  ↓
Frontend: receive YAML + validation results
  ↓
Frontend: open in WorkflowEditorView (code or visual mode)
```

### Refinement Flow (T16.2)

```
Current YAML + user instruction ("add a human approval before the email")
  ↓
RPC: refineWorkflow(RefineWorkflowInput)
  ↓
Server: construct prompt
  ├── Current workflow YAML (the baseline)
  ├── User instruction (the change request)
  ├── Task kind registry context (subset relevant to the change)
  └── Optional: previous refinement history (for multi-turn context)
  ↓
Server: LLM call → validate → return updated YAML + explanation of changes
```

### Repair Flow (T16.3)

```
Failed execution events + current workflow YAML
  ↓
RPC: diagnoseWorkflowExecution(DiagnoseWorkflowExecutionInput)
  ↓
Server: construct prompt
  ├── Workflow YAML (the definition)
  ├── Execution events (task failures, error messages, timing)
  ├── Task kind registry context (for the failing task kinds)
  └── System prompt: "Diagnose the failure and suggest specific fixes"
  ↓
Server: LLM call → return diagnosis + suggested YAML patches + explanation
```

## Proto Contract

### New Messages (in `apis/ai/stigmer/agentic/workflow/v1/io.proto`)

```protobuf
// Input for generating a workflow from a natural language description.
message GenerateWorkflowFromPromptInput {
  // Natural language description of the desired workflow.
  string prompt = 1 [(buf.validate.field).string.min_len = 10];

  // Organization slug for context (available agents, MCP servers, skills).
  string org = 2 [(buf.validate.field).required = true];

  // Optional: preferred model for generation (e.g., "claude-sonnet-4.6").
  // When empty, the server selects a default model.
  string model = 3;

  // Optional: hint about which task kinds the user wants.
  // Helps focus the generation when the user knows they want
  // specific capabilities (e.g., ["llm_call", "human_input"]).
  repeated string task_kind_hints = 4;
}

// Response from workflow generation.
message GenerateWorkflowFromPromptOutput {
  // Generated workflow YAML. Always structurally valid (passed server-side
  // validation). May contain warnings for non-critical issues.
  string yaml = 1;

  // Human-readable explanation of what was generated and why.
  // Helps the user understand the workflow structure.
  string explanation = 2;

  // Validation warnings (non-fatal). Empty when the YAML is clean.
  repeated string warnings = 3;

  // The model that was used for generation.
  string model_used = 4;
}

// Input for refining an existing workflow with a natural language instruction.
message RefineWorkflowInput {
  // The current workflow YAML to modify.
  string current_yaml = 1 [(buf.validate.field).string.min_len = 1];

  // Natural language instruction for the change.
  string instruction = 2 [(buf.validate.field).string.min_len = 5];

  // Organization slug for context.
  string org = 3 [(buf.validate.field).required = true];

  // Optional: preferred model.
  string model = 4;
}

// Response from workflow refinement.
message RefineWorkflowOutput {
  // Updated workflow YAML.
  string yaml = 1;

  // Explanation of what changed and why.
  string explanation = 2;

  // Validation warnings.
  repeated string warnings = 3;

  // The model used.
  string model_used = 4;
}

// Input for diagnosing a failed workflow execution.
message DiagnoseWorkflowExecutionInput {
  // The workflow execution ID to diagnose.
  string execution_id = 1 [(buf.validate.field).required = true];

  // Organization slug.
  string org = 2 [(buf.validate.field).required = true];

  // Optional: preferred model.
  string model = 3;
}

// Response from execution diagnosis.
message DiagnoseWorkflowExecutionOutput {
  // Human-readable diagnosis of what went wrong.
  string diagnosis = 1;

  // Suggested fixes as YAML patches or full updated YAML.
  // Empty when no automated fix is possible.
  string suggested_yaml = 2;

  // Explanation of each suggested change.
  string fix_explanation = 3;

  // Validation warnings on the suggested YAML.
  repeated string warnings = 4;

  // The model used.
  string model_used = 5;
}
```

### New RPCs (in `apis/ai/stigmer/agentic/workflow/v1/command.proto`)

```protobuf
service WorkflowCommandController {
  // ... existing RPCs ...

  // Generate a workflow from a natural language description.
  rpc generateWorkflowFromPrompt(GenerateWorkflowFromPromptInput)
      returns (GenerateWorkflowFromPromptOutput) {
    option (ai.stigmer.commons.rpc.config).resource_kind = organization;
    option (ai.stigmer.commons.rpc.config).permission = can_create_workflow;
    option (ai.stigmer.commons.rpc.config).field_path = "org";
    option (ai.stigmer.commons.rpc.config).error_msg =
        "unauthorized to generate workflows in this organization";
  }

  // Refine an existing workflow with a natural language instruction.
  rpc refineWorkflow(RefineWorkflowInput) returns (RefineWorkflowOutput) {
    option (ai.stigmer.commons.rpc.config).resource_kind = organization;
    option (ai.stigmer.commons.rpc.config).permission = can_create_workflow;
    option (ai.stigmer.commons.rpc.config).field_path = "org";
    option (ai.stigmer.commons.rpc.config).error_msg =
        "unauthorized to generate workflows in this organization";
  }

  // Diagnose a failed workflow execution and suggest fixes.
  rpc diagnoseWorkflowExecution(DiagnoseWorkflowExecutionInput)
      returns (DiagnoseWorkflowExecutionOutput) {
    option (ai.stigmer.commons.rpc.config).resource_kind = organization;
    option (ai.stigmer.commons.rpc.config).permission = can_create_workflow;
    option (ai.stigmer.commons.rpc.config).field_path = "org";
    option (ai.stigmer.commons.rpc.config).error_msg =
        "unauthorized to diagnose workflow executions in this organization";
  }
}
```

### Edition Implementation Notes

**Go (OSS — stigmer-server)**:
- Handlers read LLM API key from environment (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
- Use a minimal HTTP client (not the workflow-runner's `pkg/llm/` — that's a different binary)
- Task kind registry data loaded from the embedded JSON file
- Org context: query SQLite for available agents/workflows/MCP servers

**Java (Cloud — stigmer-service)**:
- Handlers use the existing `LlmCallService` (metered, billable)
- Task kind registry data from the same embedded JSON
- Org context: query MongoDB with IAM scoping
- Model selection: fall back to model from model-registry.json if not specified

## Prompt Engineering Strategy

The prompt template is the most important implementation detail in T16. It determines generation quality.

### System Prompt Structure

```
You are a workflow architect for the Stigmer platform. You generate valid
Stigmer Workflow YAML from natural language descriptions.

## Workflow YAML Structure
[Canonical structure: apiVersion, kind, metadata, spec with document/tasks/env/budget]

## Available Task Kinds
[For each of the 19 task kinds: kind, description, required fields, optional fields, example config]
[Grouped by category: AI, Control Flow, Invocation, Data, Governance, Event]

## Available Resources in This Organization
[List of agents: slug, description]
[List of MCP servers: slug, description]
[List of skills: slug, description]

## Example Workflows
[2-3 complete example YAMLs showing different patterns:
 - Simple linear: agent_call → transform → notification
 - Branching: llm_call → switch_case → (different paths)
 - Approval: agent_call → human_input → (approve/deny paths)]

## Rules
1. Every workflow must have apiVersion, kind, metadata, and spec
2. spec.document must have dsl: "1.0.0", namespace, name, version
3. Every task must have name (unique), kind, and task_config
4. Use flow.then only for non-sequential transitions
5. Use export.as to pass data between tasks
6. Use ${...} expressions for dynamic values
7. Reference existing agents by their org/slug
8. Keep workflows focused — prefer 3-8 tasks over 15+
```

### Prompt Quality Iteration

The prompt template will need iterative refinement based on generation quality. Key areas to tune:

- Task kind selection accuracy (does the LLM pick the right kinds?)
- Expression syntax correctness (are `${...}` references valid?)
- Flow control logic (does branching make sense?)
- Budget/timeout defaults (are they reasonable?)
- Agent/MCP server references (do they match available resources?)

This iteration happens server-side (AD-T16-002) without requiring frontend changes.

## File Plan

### Proto Changes (Batch 1)

| File | Change |
|---|---|
| `apis/ai/stigmer/agentic/workflow/v1/io.proto` | Add 6 new messages (generate/refine/diagnose input/output) |
| `apis/ai/stigmer/agentic/workflow/v1/command.proto` | Add 3 new RPCs |

### Go Backend — stigmer-server (Batch 1)

All new files in `backend/services/stigmer-server/`:

| File | Purpose |
|---|---|
| `pkg/llmclient/client.go` | Minimal HTTP LLM client (OpenAI + Anthropic) for stigmer-server |
| `pkg/llmclient/prompt.go` | Prompt template construction from registry + org context |
| `controllers/workflow/generate_workflow.go` | Handler for `generateWorkflowFromPrompt` |
| `controllers/workflow/refine_workflow.go` | Handler for `refineWorkflow` (Batch 3) |
| `controllers/workflow/diagnose_execution.go` | Handler for `diagnoseWorkflowExecution` (Batch 4) |

### Java Backend — stigmer-service (Batch 1)

All new files in `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflow/`:

| File | Purpose |
|---|---|
| `request/handler/WorkflowGenerateFromPromptHandler.java` | Handler for `generateWorkflowFromPrompt` |
| `request/handler/WorkflowRefineHandler.java` | Handler for `refineWorkflow` (Batch 3) |
| `request/handler/WorkflowDiagnoseExecutionHandler.java` | Handler for `diagnoseWorkflowExecution` (Batch 4) |
| `generation/WorkflowPromptBuilder.java` | Prompt template construction |
| `generation/WorkflowYamlValidator.java` | Server-side YAML validation + retry logic |

### SDK — @stigmer/sdk (Batch 1)

| File | Change |
|---|---|
| `sdk/typescript/src/gen/workflow.ts` | Add `generateFromPrompt()`, `refine()`, `diagnoseExecution()` methods |

### SDK — @stigmer/react (Batch 2)

All new files in `sdk/react/src/workflow/`:

| File | Type | Batch | Purpose |
|---|---|---|---|
| `useGenerateWorkflow.ts` | Behavior Hook | 2 | Orchestrates generation: prompt → RPC → validation → result |
| `WorkflowGenerateDialog.tsx` | Component | 2 | Dialog: prompt textarea, generate button, loading/error, preview |
| `WorkflowGenerateInline.tsx` | Component | 2 | Inline prompt bar for the editor toolbar |
| `useRefineWorkflow.ts` | Behavior Hook | 3 | Orchestrates refinement: yaml + instruction → RPC → updated yaml |
| `WorkflowRefinePanel.tsx` | Component | 3 | Side panel: instruction input, diff preview, apply/discard |
| `useDiagnoseExecution.ts` | Behavior Hook | 4 | Orchestrates diagnosis: execution → RPC → diagnosis + suggestions |
| `WorkflowRepairCard.tsx` | Component | 4 | Card showing diagnosis, suggested fix, apply button |

### Console Integration (Batch 2, 3, 4)

| File | Batch | Change |
|---|---|---|
| `client-apps/web/src/domain/workflow/WorkflowListPage.tsx` | 2 | "Generate from description" button |
| `client-apps/web/src/domain/workflow/WorkflowDetailPage.tsx` | 2 | "Generate" entry point on new workflow creation |
| `client-apps/desktop/src/pages/workflow/WorkflowListPage.tsx` | 2 | DD-016 parity |
| `client-apps/desktop/src/pages/workflow/WorkflowDetailPage.tsx` | 2 | DD-016 parity |
| `sdk/react/src/workflow/WorkflowEditorView.tsx` | 3 | Refine panel integration in toolbar |
| `sdk/react/src/workflow/WorkflowExecutionViewer.tsx` | 4 | "Diagnose" action on failed executions |

## Batched Sub-Tasks

T16 is split into five batches. Batches 1–2 deliver the core generation feature. Batches 3–5 are independently shippable enhancements.

---

### Batch 1: Generation Infrastructure (Proto + Backend)

> Wire the generation pipeline end-to-end: proto contract, Go + Java handlers, prompt construction, LLM call, validation-in-the-loop, SDK client method.

This batch delivers the backend infrastructure that all subsequent batches build on. After this batch, the `generateWorkflowFromPrompt` RPC is callable from the SDK — no UI yet.

#### Proto Changes

- Add `GenerateWorkflowFromPromptInput`, `GenerateWorkflowFromPromptOutput` to `io.proto`
- Add `generateWorkflowFromPrompt` RPC to `command.proto`
- Run `make codegen` (OSS) + `make protos` (Cloud)

#### Go Handler (OSS)

**New**: `pkg/llmclient/client.go` — minimal HTTP LLM client:
- Supports OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`)
- Reads API key from environment (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)
- Non-streaming JSON response parsing
- No billing metering (OSS is self-hosted, user pays provider directly)
- Model default: `gpt-4o` (OpenAI) or `claude-sonnet-4-6` (Anthropic), configurable

**New**: `pkg/llmclient/prompt.go` — prompt template construction:
- Loads task kind registry descriptors from embedded JSON
- Queries SQLite for available agents/MCP servers/skills in the org
- Constructs the system prompt with registry context and example workflows
- Constructs the user prompt from `GenerateWorkflowFromPromptInput`

**New**: `controllers/workflow/generate_workflow.go` — RPC handler:
- Builds prompt via `prompt.go`
- Calls LLM via `client.go`
- Extracts YAML from LLM response (parse from markdown code fence if needed)
- Validates YAML via `parseWorkflowYaml` equivalent (Go YAML parsing + task kind validation)
- On validation failure: retry with error context (max 2 retries)
- Returns `GenerateWorkflowFromPromptOutput`

#### Java Handler (Cloud)

**New**: `WorkflowGenerateFromPromptHandler.java` — RPC handler:
- IAM-scoped: validates `can_create_workflow` permission on org
- Constructs prompt via `WorkflowPromptBuilder`
- Calls `LlmCallService.chatCompletion()` (already metered + billable)
- Validates YAML via YAML parser + task kind validation
- Retry logic on validation failure
- Returns `GenerateWorkflowFromPromptOutput`

**New**: `WorkflowPromptBuilder.java` — prompt construction:
- Loads task kind registry descriptors
- Queries MongoDB for org's available agents/MCP servers/skills (IAM-scoped)
- Same prompt structure as Go implementation

**New**: `WorkflowYamlValidator.java` — YAML validation:
- Parses YAML to verify structural validity
- Checks task kinds against registry
- Returns validation errors/warnings
- Used for the validation-in-the-loop retry pattern

#### SDK Client

- Add `generateFromPrompt(input)` method to `WorkflowClient` in `sdk/typescript/src/gen/workflow.ts`
- Manual patch (same codegen gap workaround as `getExecutionSummary`)

#### Verification

- `make codegen` (OSS) — clean
- `make protos` (Cloud) — clean
- `go build ./...` + `go vet ./...` — clean (stigmer-server)
- `bazelw build //backend/services/stigmer-service/...` — clean
- `tsc --noEmit` — clean (sdk/typescript)
- Manual test: call RPC with a sample prompt, verify valid YAML is returned

---

### Batch 2: Generation Dialog (SDK Components + Console Integration)

> Build the user-facing generation experience: dialog, inline prompt bar, preview, and console wiring.

This batch delivers the "describe-it lane" — the primary UX for creating workflows from natural language.

#### SDK Behavior Hook

**New**: `useGenerateWorkflow.ts`

Orchestrator hook following `useRunWorkflowFlow` pattern:
- Manages prompt input state
- Calls `stigmer.workflow.generateFromPrompt()` via `useStigmer()`
- Tracks generation state FSM: `idle → generating → validating → ready | error`
- Exposes: `generate(prompt)`, `isGenerating`, `result`, `error`, `reset()`
- On success: result contains `{ yaml, explanation, warnings }`
- Consumer decides what to do with the result (navigate to editor, open preview)

#### SDK Components

**New**: `WorkflowGenerateDialog.tsx`

Full-screen dialog (native `<dialog>` + `showModal()`, matching `WorkflowRunDialog` pattern):
- **Prompt input**: large textarea with placeholder hint ("Describe the workflow you want to create...")
- **Task kind hints** (optional): multi-select pills showing AI, Control Flow, Invocation, etc. categories — helps the user scope the generation
- **Generate button**: triggers `useGenerateWorkflow.generate()`
- **Loading state**: skeleton preview with progress indicator ("Generating workflow...")
- **Result state**: split view — left: explanation (markdown-rendered), right: YAML preview (read-only CodeMirror)
- **Action bar**: "Open in Editor" (primary, navigates to editor with generated YAML), "Regenerate" (secondary), "Cancel" (tertiary)
- **Error state**: error message with "Try again" button
- **Warning badges**: shown on the YAML preview if validation produced warnings
- All styles via `--stgm-*` tokens

**New**: `WorkflowGenerateInline.tsx`

Compact inline prompt bar for embedding in the editor toolbar:
- Single-line text input with "Generate" button
- Expands to multi-line on focus
- Uses `useGenerateWorkflow` internally
- On success: replaces editor content (with confirmation if dirty)
- Designed for the "generate into current editor" flow

#### Console Integration (DD-016)

Web (`client-apps/web`):
- Workflow list page: "New from Description" button alongside existing "New Workflow"
- Opens `WorkflowGenerateDialog`
- On success: navigates to `/workflows/[slug]/editor` with generated YAML

Desktop (`client-apps/desktop`):
- Identical button and dialog wiring (DD-016 parity)

#### Barrel Exports

- Export `useGenerateWorkflow`, `WorkflowGenerateDialog`, `WorkflowGenerateInline` from `sdk/react/src/workflow/index.ts`
- Top-level re-exports in `sdk/react/src/index.ts`

#### Verification

- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files
- DD-016 parity confirmed

---

### Batch 3: Iterative Refinement (T16.2)

> Enable users to refine a generated or existing workflow with natural language instructions, directly from the editor.

This batch adds a refinement panel to `WorkflowEditorView` — a side panel where users type instructions like "add a human approval step before the email notification" and see a diff preview of the changes.

#### Proto Changes

- Add `RefineWorkflowInput`, `RefineWorkflowOutput` to `io.proto` (if not already added in Batch 1)
- Add `refineWorkflow` RPC to `command.proto`
- Codegen across all stubs

#### Backend Handlers

Go + Java handlers mirror Batch 1 pattern:
- Receive current YAML + instruction
- Construct prompt: "Given this workflow YAML, apply the following change: [instruction]"
- Include relevant task kind context for the change
- LLM generates updated YAML
- Validate, retry on failure, return updated YAML + explanation

#### SDK

**New**: `useRefineWorkflow.ts`

Behavior hook:
- Takes current YAML from `useWorkflowEditor`
- Manages instruction input and refinement state
- Calls `stigmer.workflow.refine()`
- Returns: `refine(instruction)`, `isRefining`, `result`, `error`
- Result includes: updated YAML + explanation of changes

**New**: `WorkflowRefinePanel.tsx`

Side panel (right side of editor, toggleable):
- Instruction input textarea ("What would you like to change?")
- "Apply" button → triggers refinement
- Loading state with explanation preview
- Diff preview: before/after YAML with highlighted changes
- "Accept" (replaces editor content) / "Discard" (closes panel) actions
- Conversation history: shows previous refinement instructions for context
- All styles via `--stgm-*` tokens

#### Editor Integration

- Add "Refine with AI" button to `WorkflowEditorView` toolbar (both code and visual modes)
- Opens `WorkflowRefinePanel` as a collapsible right sidebar
- In visual mode: refinement applies to the serialized YAML, then re-parses into the canvas

#### Verification

- `tsc --noEmit` — clean across all packages
- Zero linter errors
- DD-016 parity (web + desktop)

---

### Batch 4: Workflow Repair Assistant (T16.3)

> Help users understand why a workflow execution failed and suggest specific fixes.

This batch adds a "Diagnose" action to failed workflow executions that uses AI to analyze the failure and suggest concrete YAML changes.

#### Proto Changes

- Add `DiagnoseWorkflowExecutionInput`, `DiagnoseWorkflowExecutionOutput` to `io.proto`
- Add `diagnoseWorkflowExecution` RPC to `command.proto`
- Codegen

#### Backend Handlers

Go + Java handlers:
- Fetch the workflow YAML (from the workflow resource)
- Fetch execution events (from the event log — task failures, error messages, timing)
- Construct prompt: workflow YAML + execution failure context + task kind metadata
- LLM analyzes the failure and suggests: diagnosis, fix explanation, updated YAML
- Validate suggested YAML if provided

The prompt for repair is different from generation — it focuses on:
- What task failed and why (error message, task kind)
- Common failure patterns for that task kind
- Suggested configuration changes (timeouts, retries, fallback tasks)
- Whether the workflow structure itself needs changes (missing error handling, etc.)

#### SDK

**New**: `useDiagnoseExecution.ts`

Behavior hook:
- Takes execution ID
- Calls `stigmer.workflow.diagnoseExecution()`
- Returns: `diagnose()`, `isDiagnosing`, `result`, `error`
- Result includes: diagnosis text, suggested YAML, fix explanation

**New**: `WorkflowRepairCard.tsx`

Card component for the execution viewer:
- Appears on failed executions (gated behind the "Diagnose" button)
- Shows: AI diagnosis (markdown-rendered), suggested fix explanation
- If YAML changes are suggested: diff preview + "Apply Fix" button
- "Apply Fix" navigates to the workflow editor with the suggested YAML
- Loading state, error state
- All styles via `--stgm-*` tokens

#### Console Integration

- Add "Diagnose with AI" button to `WorkflowExecutionViewer` header (shown only for failed executions)
- Renders `WorkflowRepairCard` inline when activated
- "Apply Fix" navigates to the workflow editor (web: router.push, desktop: navigate)

#### Verification

- `tsc --noEmit` — clean
- Zero linter errors
- DD-016 parity

---

### Batch 5: Session-to-Workflow Conversion (T16.4)

> Extract repeatable workflow patterns from agent sessions and generate a workflow that automates them.

This is the most experimental batch. It analyzes an agent session's message history — the tools used, the decisions made, the approvals requested — and generates a workflow that codifies that pattern.

**This batch should be scoped and planned in detail after Batches 1–4 are complete.** The design will depend on what we learn from the generation and refinement features. High-level direction:

#### Concept

- User views a completed agent session and clicks "Promote to Workflow"
- System reads the session's messages, tool calls, and decisions
- Constructs a prompt: "Given this agent session transcript, extract a repeatable workflow pattern"
- LLM generates a workflow YAML where each distinct step becomes a task
- Tool calls become `agent_call` or `llm_call` tasks
- Decision points become `switch_case` or `human_input` tasks
- Sequential steps become the task order

#### Open Questions (to resolve before implementation)

1. How much session context fits in a single LLM prompt? Long sessions may need summarization first.
2. Should the extraction be lossy (simplified pattern) or faithful (exact replay)?
3. How do we handle sessions that used tools/MCP servers not available as workflow task kinds?
4. Should this be a proto RPC or reuse `generateWorkflowFromPrompt` with session context?

---

## Naming Conventions (Following Existing Patterns)

| Convention | Existing Examples | T16 Follows Same Pattern |
|---|---|---|
| Behavior hooks: `use<Domain><Purpose>` | `useRunWorkflowFlow`, `useWorkflowEditor` | `useGenerateWorkflow`, `useRefineWorkflow`, `useDiagnoseExecution` |
| Styled components: `<Domain><Purpose>` | `WorkflowRunDialog`, `WorkflowEditorView` | `WorkflowGenerateDialog`, `WorkflowRefinePanel`, `WorkflowRepairCard` |
| Backend handlers: `<Resource><Action>Handler` | `WorkflowExecutionGetEventLogHandler` | `WorkflowGenerateFromPromptHandler`, `WorkflowRefineHandler` |
| Proto messages: `<Action><Resource>Input/Output` | `GetAgentExecutionSummaryRequest` | `GenerateWorkflowFromPromptInput/Output` |

## Implementation Order

Each batch is independently deliverable. Batches 1–2 must be executed in order. Batches 3–5 can be executed in any order after Batch 2.

```
Batch 1 (Proto + Backend) — Generation Infrastructure
  → Foundation: proto contract, Go + Java handlers, prompt template, LLM call, validation.
  → No UI. Backend-only. Verifiable via direct RPC calls.

Batch 2 (SDK + Console) — Generation Dialog
  → First user-visible feature: "New from Description" button, dialog, preview.
  → Delivers the "describe-it lane" from the research report.

Batch 3 (Refinement) — Iterative AI-Assisted Editing
  → Editor enhancement: "Refine with AI" panel for conversational modification.
  → Extends the editor, does not replace it.

Batch 4 (Repair) — Execution Diagnosis
  → Execution viewer enhancement: "Diagnose" on failed executions.
  → Bridges the gap between monitoring and authoring.

Batch 5 (Session-to-Workflow) — Pattern Extraction
  → Most experimental. Scope after Batches 1-4.
  → Bridges the gap between agent sessions and workflows.
```

## Per-Batch Deliverables

For each batch, the session should:

1. Follow SDK-first architecture (DD-001) — hooks and components in `@stigmer/react`
2. Use `--stgm-*` tokens for all visual properties (DD-005)
3. Ensure zero Console-specific dependencies in SDK code (DD-004)
4. Use generated types from `@stigmer/protos` (DD-007)
5. Wrap hook returns in `useMemo` for reference stability (DD-010)
6. Implement in both Go (OSS) and Java (Cloud) for backend changes
7. Maintain DD-016 parity (web + desktop) for console changes
8. Run `tsc --noEmit` — zero errors
9. Run `go build` + `go vet` — zero errors
10. Create a checkpoint in `checkpoints/` summarizing what was delivered

## Out of Scope for T16

- **Template gallery / marketplace** — separate task, not AI generation
- **Full conversational Workflow Builder Agent** — Phase 4+ (when use case demands tool-using, multi-turn agent)
- **Real-time streaming generation** — initial implementation is request/response, not SSE streaming of YAML tokens
- **Custom prompt template editing by users** — the prompt template is server-managed
- **Multi-language prompt support** — English-only prompt engineering initially
- **Session-to-workflow for non-agent sessions** — T16.4 only handles agent sessions
- **Auto-execution of generated workflows** — generation produces YAML for review, not auto-run

## Risks

| Risk | Mitigation |
|---|---|
| LLM generates invalid YAML | Validation-in-the-loop (AD-T16-005): server validates and retries up to 2 times with error context |
| LLM hallucinates non-existent task kinds | Prompt includes explicit task kind registry with all 19 valid kinds. Server validates kinds. |
| LLM references agents/MCP servers that don't exist | Prompt includes org's actual available resources. Warnings in response. |
| Generation quality varies by model | Default to a high-capability model (Claude Sonnet 4.6 / GPT-4o). Allow user override. |
| Prompt template needs frequent iteration | Server-side template (AD-T16-002) — updatable without frontend releases |
| Go OSS edition lacks LLM infrastructure | New minimal HTTP client in `pkg/llmclient/` — simple, focused, no shared dependency on workflow-runner |
| Generated workflows are too simple/complex | Include task count guidance in prompt. Refine prompt iteratively based on results. |
| Users expect a chatbot, not a generator | UX is explicitly a dialog/form, not a chat interface. Clear framing: "Describe and generate." |
| Session-to-workflow is too ambitious | Deferred to Batch 5 with explicit scoping gate. Not committed until Batches 1-4 prove the approach. |

## Suggested Starting Point

Begin with **Batch 1 (Proto + Backend)** — Generation Infrastructure — because it delivers the RPC contract and backend handlers that all UI batches depend on, and it can be verified independently via direct RPC calls before any UI work begins.

---

**Please review this plan and provide your feedback. I will not proceed to execution until you explicitly approve a batch.**
