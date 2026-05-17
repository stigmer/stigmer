# Workflow Architect MCP Tools + Seedpack Agent

**Date**: May 15, 2026

## Summary

Extended the Stigmer MCP server with 5 new workflow-specific tools for the Workflow Architect agent, added a `validateSpec` gRPC RPC to the workflow command controller with implementations in both Go (OSS) and Java (Cloud), and created the `workflow-architect` system agent in the seedpack. This is the MCP-tools-first slice of Batch 2 in the agent-powered workflow generation project.

## Problem Statement

After Batch 1A removed the direct-LLM workflow generation infrastructure (~3,800 lines), the platform had no way to generate, refine, or diagnose workflows with AI assistance. The replacement architecture uses a Workflow Architect agent that introspects platform resources and validates YAML through MCP tools, but those tools didn't exist yet.

### Pain Points

- No MCP tools for querying the task kind registry (19 task types with field schemas)
- No standalone workflow validation endpoint — validation was only available as a side effect of create/update
- No MCP tools for inspecting workflow executions (needed for diagnosis)
- No system agent definition for the Workflow Architect

## Solution

Extended the existing `mcp-server-stigmer` Go binary with 5 new tools backed by existing gRPC APIs, added a new `validateSpec` RPC to `WorkflowCommandController` that reuses the existing Temporal validation pipeline, and created a seedpack agent YAML following the established `agent-creator`/`skill-creator` pattern.

## Implementation Details

### Proto Changes (stigmer OSS)

- Added `validateSpec` RPC to `WorkflowCommandController` in `command.proto`
- Input: `Workflow` (same message create/apply accept)
- Output: `ServerlessWorkflowValidation` (state, yaml, errors, warnings)
- Authorization: `can_create_workflow` on the org (same as create)
- Ran `make codegen` (OSS) + `make protos` (Cloud) + SDK codegen

### Go Backend (stigmer-server)

- New `validate_spec.go` — thin 2-step pipeline reusing `validateWorkflowSpecStep`:
  1. Proto field constraints (buf validate)
  2. Temporal-based structural validation (proto → YAML → Zigflow)
- No persist, no authorize, no instance creation — pure validation

### Java Backend (stigmer-cloud)

- New `WorkflowValidateSpecHandler.java` — `CustomOperationHandlerV2<Workflow, ServerlessWorkflowValidation>`
- 3-step pipeline: validate input → run Temporal validation → send result
- Injects `ServerlessWorkflowValidator` directly (same component as create/update)

### MCP Server Tools (5 new, 11 → 16 total)

| Tool | Purpose |
|------|---------|
| `get_task_kind_registry` | Full 19-kind registry with field schemas, JSON Schemas, examples |
| `get_task_kind` | Single task kind descriptor by name |
| `validate_workflow_yaml` | Parse YAML → proto → call `validateSpec` RPC → return validation |
| `get_workflow_execution` | Execution status, tasks, errors for diagnosis |
| `get_workflow_execution_events` | Event log for deep execution diagnosis |

The `validate_workflow_yaml` tool includes a YAML-to-proto parser that maps task kind string names to proto enum values and uses `protojson.Unmarshal` for the conversion. `task_config` (a `google.protobuf.Struct`) round-trips through JSON naturally.

### Seedpack Agent

- New `seedpack/agents/workflow-architect.yaml` — system agent with:
  - Label `stigmer.ai/system: "true"`, `visibility_public`
  - 10 enabled MCP tools (5 existing + 5 new)
  - System prompt with Generate/Refine/Diagnose modes
  - Step-by-step workflow: understand intent → discover resources → load task kinds → generate YAML → validate → present

### Bug Fix

- Fixed pre-existing test filename mismatch in `seedpack/seedpack_test.go` (expected `mcp-servers/mcp-server-stigmer.yaml` but actual file is `mcp-servers/stigmer.yaml`)

## Benefits

- **Single source of truth for validation**: The `validateSpec` RPC uses the same Temporal pipeline as create/update — no drift between validation and actual acceptance
- **Available to all consumers**: CLI, frontend, and MCP server can all call the validation RPC
- **Agent-ready infrastructure**: The Workflow Architect agent now has all the tools it needs to generate, refine, and diagnose workflows
- **Zero new infrastructure**: All tools call existing gRPC APIs; the validation RPC reuses existing Temporal workflows and activities

## Impact

- MCP server: 5 new tools, tool count 11 → 16
- Proto: 1 new RPC on `WorkflowCommandController`
- Backend: 1 new handler in Go (stigmer-server), 1 new handler in Java (stigmer-service)
- Seedpack: 1 new system agent (`workflow-architect`)
- Enables Batches 3-5 (frontend: generate, refine, diagnose UX)

## Related Work

- **Parent**: 20260508.01.bring-workflows-to-foreground (Phase 3: AI-Assisted Creation)
- **Sub-project**: 20260515.01.sp.agent-powered-workflow-generation
- **Batch 1A**: Removed direct-LLM workflow generation infrastructure (~3,800 lines)
- **Next**: Batch 3 — SDK + Frontend for workflow generation via agent sessions

---

**Status**: Production Ready
**Timeline**: ~1 hour (single session)
