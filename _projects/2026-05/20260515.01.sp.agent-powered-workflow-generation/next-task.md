# Next Task: 20260515.01.sp.agent-powered-workflow-generation

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260508.01.bring-workflows-to-foreground
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260508.01.bring-workflows-to-foreground
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/next-task.md`
**Spawned From Task**: T16

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260515.01.sp.agent-powered-workflow-generation

**Description**: Rewrite all workflow generation, refinement, and diagnosis flows from direct LLM calls to agent-powered sessions using the Cursor harness. The Workflow Architect agent uses MCP server connections and tool use for richer, more sophisticated workflow creation, replacing the current single-shot prompt approach.
**Goal**: Replace the current direct LLM RPCs (generateWorkflowFromPrompt, refineWorkflow, diagnoseWorkflowExecution) with a Workflow Architect agent that leverages the existing Cursor harness infrastructure, MCP server tool introspection, and streaming agent sessions to produce higher-quality workflows with full observability.
**Tech Stack**: Protobuf (APIs/schemas), Go (workflow-runner/Temporal workers), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal (durability), CNCF Serverless Workflow (DSL influence)
**Components**: Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner (Go/Temporal), stigmer-service (Java), Web UI (React — builder, execution viewer, dashboard), CLI (Go — workflow commands), agent-runner (Python — structured output support), model registry, artifact store

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-15 10:05
**Current Task**: T01 — Batch 3 complete (SDK + Frontend — Generate)
**Status**: In Progress

## Session Progress (May 15, 2026 — Session 3)

### Completed: Batch 3 — SDK + Frontend — Generate (WorkflowArchitectDialog)
- Regenerated TS proto stubs (`make -C apis ts-stubs`) — removed deleted LLM RPCs, added `validateSpec`
- Regenerated TS SDK client (`make -C sdk/typescript codegen`) — `WorkflowClient` updated
- Fixed codegen import bug: `serverless/io_pb` → `serverless/validation_pb` for `ServerlessWorkflowValidation`
- Cleaned stale type exports from `@stigmer/sdk` barrel (`GenerateFromPromptInput`, `RefineWorkflowClientInput`, `DiagnoseExecutionInput`, etc.)
- Stubbed `useRefineWorkflowFlow` and `useDiagnoseExecution` with descriptive runtime errors (Batch 4/5 placeholders)
- Created `extract-workflow-yaml.ts` — pure utility extracting last YAML fenced block from `AgentExecution` messages
- Created `useWorkflowArchitectFlow` — behavior hook composing `useCreateSession` + `useCreateAgentExecution` + `useExecutionStream`/`ConversationStore` + YAML extraction + `workflow.apply()`
- Created `WorkflowArchitectDialog` — three-phase styled component (Input → Streaming with `MessageThread` → Result with YAML preview)
- Updated barrel exports in `workflow/index.ts` and root `index.ts`
- Wired `WorkflowArchitectDialog` in both web and desktop `WorkflowListPage` (DD-016 parity)
- Deleted `useGenerateWorkflowFlow.ts` (7KB) and `WorkflowGenerateDialog.tsx` (16KB)
- Verification: `tsc --noEmit` passes clean across all 4 packages (sdk/typescript, sdk/react, client-apps/web, client-apps/desktop)

### Key Decisions
- **Dialog with embedded streaming** — kept the dialog UX (user stays on workflow list) instead of navigating to a full session page; agent messages stream inside the dialog via `MessageThread`
- **Reuse full streaming infra** — `useExecutionStream` + `ConversationStore` + `StreamController` (DD-009) — no custom streaming
- **Convention-based YAML extraction** — scan last AI message for fenced ````yaml` block; `null` if not found (surfaces as extraction-failed state)
- **Session persists for refinement** — generate creates a real Session so Batch 4 can reuse it for conversational context
- **Batch 4/5 stubs, not deletions** — stubbed hooks with runtime errors to keep barrel exports stable; will be replaced in Batches 4-5
- **Drop-in prop replacement** — `WorkflowArchitectDialogProps` matches `WorkflowGenerateDialogProps` exactly, making console wiring a one-line import swap

### Surprises Discovered
- TS SDK codegen had not been run after Batch 1A proto teardown — `sdk/typescript/src/gen/workflow.ts` still had `generateFromPrompt`, `refine`, `diagnoseExecution`
- TS proto stubs (`apis/stubs/ts`) were also stale — needed `make -C apis ts-stubs` before TS SDK codegen would produce correct output
- Codegen import bug: generated `serverless/io_pb` import path but actual stub is `serverless/validation_pb` — manually fixed in generated file
- Pre-existing Bazel/Gazelle issue blocks `make -C apis build` (Go stubs fail) — workaround: run `make -C apis ts-stubs` directly

## Session Progress (May 15, 2026 — Session 2)

### Completed: Batch 2 — Workflow Architect MCP Tools + Seedpack Agent
- Added `validateSpec` RPC to `WorkflowCommandController` proto (Workflow → ServerlessWorkflowValidation)
- Implemented Go handler in stigmer-server (thin 2-step pipeline reusing existing Temporal validation)
- Implemented Java handler in stigmer-cloud (`WorkflowValidateSpecHandler` with `CustomOperationHandlerV2`)
- Added 5 new MCP tools to `mcp-server-stigmer` (total: 11 → 16):
  - `get_task_kind_registry` — full 19-kind registry with schemas
  - `get_task_kind` — single task kind descriptor by name
  - `validate_workflow_yaml` — YAML → proto → `validateSpec` RPC
  - `get_workflow_execution` — execution status for diagnosis
  - `get_workflow_execution_events` — event log for deep diagnosis
- Created `seedpack/agents/workflow-architect.yaml` system agent with Generate/Refine/Diagnose modes
- Fixed pre-existing seedpack test filename mismatch
- Codegen: `make codegen` (OSS) + `make protos` (Cloud) + SDK codegen + MCP server stubs
- Verification: buf lint, go build, go vet, go test — all clean

### Key Decisions
- **Server-side validation via Temporal** — `validate_workflow_yaml` calls `validateSpec` RPC which reuses the same Temporal validation pipeline as create/update (single source of truth)
- **YAML-to-proto parsing in MCP server** — YAML → map → JSON → protojson with task kind enum mapping (19-entry lookup table)
- **No new proto for task kind registry** — tool calls existing `TaskKindRegistryQueryController.getTaskKindRegistry()` gRPC RPC
- **Agent follows seedpack pattern** — same `stigmer.ai/system: "true"` label, `mcp-server-stigmer` reference, `enabled_tools` subset

## Session Progress (May 15, 2026 — Session 1)

### Completed: Batch 1A — Proto Cleanup + Backend Teardown
- Removed 3 gRPC RPCs and 6 protobuf messages from the workflow API (`io.proto`, `command.proto`)
- Deleted Go LLM HTTP client (`pkg/llmclient/`, 1,057 lines), 3 Go controller files (795 lines)
- Cleaned `workflow_controller.go` (removed LLM fields/setters) and `server.go` (removed LLM wiring)
- Deleted Java `generation/` directory and 3 Java handler files in stigmer-cloud
- Regenerated all stubs across both repos; verified builds clean (go build, go vet, proto lint)
- Net removal: ~3,800 lines across stigmer, significant deletions in stigmer-cloud

### Key Decisions
- **Kept `taskkindregistry` HTTP handler** — serves frontend workflow editor independently
- **SDK codegen is separate** — requires `make -C sdk/go codegen` in addition to top-level `make codegen`
- **No frontend changes needed** — SDK/React/Console deletion targets never existed

## Next Steps

1. **Batch 4: SDK + Frontend — Refine** — Replace stubbed `useRefineWorkflowFlow` with agent-powered refinement; build agent conversation panel in editor sidebar; reuse the session created during generation for conversational context
2. **Batch 5: SDK + Frontend — Diagnose** — Replace stubbed `useDiagnoseExecution` with agent-powered diagnosis; build agent diagnosis view in execution viewer
3. **End-to-end testing** — Seed `workflow-architect` agent, test the full generate flow with a running Stigmer instance

## Context for Resume

- Batches 1A (teardown), 2 (MCP tools + agent), and **3 (SDK + Frontend — Generate)** are complete
- The `WorkflowArchitectDialog` is wired in both web and desktop consoles
- `useWorkflowArchitectFlow` composes `useCreateSession` → `useCreateAgentExecution` → `useExecutionStream` → `extractWorkflowYaml` → `workflow.apply()`
- `useRefineWorkflowFlow` and `useDiagnoseExecution` are **stubbed** with runtime errors — Batch 4/5 will replace them
- TS proto stubs and TS SDK are regenerated and clean — `validateSpec` added, LLM methods removed
- Codegen import bug exists: `serverless/io_pb` → `serverless/validation_pb` fix is manual in `sdk/typescript/src/gen/workflow.ts` — will be overwritten on next codegen run (needs codegen tool fix)
- Pre-existing Bazel/Gazelle issue blocks `make -C apis build` — use `make -C apis ts-stubs` directly
- Changelog: `_changelog/2026-05/2026-05-15-122724-workflow-architect-generate-dialog.md`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
