# Workflow Architect: Agent-Powered Generate Dialog (Batch 3)

**Date**: May 15, 2026

## Summary

Replaced the direct-LLM `WorkflowGenerateDialog` with an agent-powered `WorkflowArchitectDialog` that creates a session with the `workflow-architect` system agent, streams the agent's work (tool calls, validation, generation) in real-time inside the dialog, extracts validated YAML from the agent's response, and persists the workflow. This is Batch 3 of the agent-powered workflow generation project.

## Problem Statement

The old workflow generation flow called a synchronous `generateWorkflowFromPrompt` RPC that returned YAML after a 10-30 second spinner. The user had zero visibility into what the LLM was doing, no validation loop, and no access to org resources (agents, MCP servers, skills) during generation.

### Pain Points

- Opaque generation: spinner-only UX with no feedback during generation
- No iterative validation: single-shot prompt with crude retry on failure
- No org context: LLM could not discover or introspect available agents, MCP servers, or skills
- Stateless: no conversational context preserved for follow-up refinement

## Solution

The generate flow now launches the `workflow-architect` system agent via the standard agent execution infrastructure. The dialog shows real-time streaming of agent messages, tool calls (task kind registry queries, YAML validation), and thinking. On completion, YAML is extracted from the agent's fenced code block and presented for review.

## Implementation Details

### New SDK Components (`@stigmer/react`)

- **`extract-workflow-yaml.ts`** — Pure utility that scans `AgentExecution` messages for the last YAML fenced code block, separating YAML content from explanation prose
- **`useWorkflowArchitectFlow`** — Behavior hook composing `useCreateSession` + `useCreateAgentExecution` + `useExecutionStream`/`ConversationStore` + YAML extraction + `workflow.apply()`. State machine: `idle → starting → streaming → complete → applying → success`
- **`WorkflowArchitectDialog`** — Three-phase styled component (Input → Streaming with `MessageThread` → Result with YAML preview). Drop-in replacement for the old dialog — identical prop shape

### Prerequisite Work

- Regenerated TS proto stubs (`apis/stubs/ts`) — removed deleted LLM RPCs, added `validateSpec`
- Regenerated TS SDK client (`sdk/typescript`) — `WorkflowClient` updated
- Fixed codegen import bug: `serverless/io_pb` → `serverless/validation_pb`
- Cleaned stale type exports from `@stigmer/sdk` barrel

### Batch 4/5 Stubs

- Stubbed `useRefineWorkflowFlow` and `useDiagnoseExecution` with descriptive runtime errors — all type exports preserved for barrel compatibility

### Console Wiring (DD-016 Parity)

- Web and desktop `WorkflowListPage` both swap `WorkflowArchitectDialog` in place of `WorkflowGenerateDialog` — one-line import changes

### Deletion

- `useGenerateWorkflowFlow.ts` (7KB) — replaced by `useWorkflowArchitectFlow`
- `WorkflowGenerateDialog.tsx` (16KB) — replaced by `WorkflowArchitectDialog`

## Benefits

- Real-time visibility into workflow generation (streaming agent messages and tool calls)
- Agent can query task kind registry, validate YAML iteratively, and discover org resources
- Session persists for conversational refinement (Batch 4 foundation)
- Cleaner input UX — agent handles model selection and task kind discovery via tools
- Net code reduction: -1,660 lines across 21 files

## Impact

- **Web Console + Desktop**: "Generate" button on workflow list now opens the agent-powered dialog
- **SDK consumers**: `WorkflowGenerateDialog` / `useGenerateWorkflowFlow` replaced by `WorkflowArchitectDialog` / `useWorkflowArchitectFlow` — breaking change for SDK consumers using the old exports
- **Refine/Diagnose**: temporarily stubbed with descriptive errors until Batches 4-5

## Related Work

- Batch 1A: Proto cleanup + backend teardown (same project, Session 1)
- Batch 2: MCP tools + seedpack agent (same project, Session 2)
- Batch 4 (next): SDK + Frontend — Refine
- Batch 5 (next): SDK + Frontend — Diagnose
- Changelog: `2026-05-15-115202-workflow-architect-mcp-tools-and-seedpack-agent.md`

---

**Status**: ✅ Production Ready (pending end-to-end testing with seeded agent)
**Timeline**: Single session (~30 minutes)
