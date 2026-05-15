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
**Current Task**: T01 — Batch 2 complete (MCP tools + seedpack agent)
**Status**: In Progress

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

1. **Batch 3: SDK + Frontend — Generate** — Build `useWorkflowArchitect` hook, `WorkflowArchitectDialog`, console integration
2. **Batch 4: SDK + Frontend — Refine** — Agent conversation panel in editor sidebar
3. **Batch 5: SDK + Frontend — Diagnose** — Agent diagnosis view in execution viewer

## Context for Resume

- Batch 1A (teardown) and Batch 2 (MCP tools + agent) are complete
- The `WorkflowCommandController` now has: `apply`, `create`, `update`, `delete`, **`validateSpec`**
- The MCP server has 16 tools (5 new workflow-specific ones)
- The `workflow-architect` seedpack agent exists with Generate/Refine/Diagnose system prompt
- The agent references `mcp-server-stigmer` with 10 `enabled_tools` (5 existing + 5 new)
- Pre-existing Bazel/Gazelle issue exists (missing `test/integration` BUILD file) — unrelated
- Changelog: `_changelog/2026-05/2026-05-15-115202-workflow-architect-mcp-tools-and-seedpack-agent.md`

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
