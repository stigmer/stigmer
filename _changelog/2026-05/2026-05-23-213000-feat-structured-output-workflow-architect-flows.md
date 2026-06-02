# Structured Output for Workflow Architect/Refine/Diagnose Flows

**Date**: May 23, 2026

## Summary

Replaced the regex-based YAML extraction in the workflow architect/refine/diagnose flows with the deterministic structured output mechanism. The runner now extracts schema-conforming JSON from the agent's final response and persists it atomically with the COMPLETED status, so frontend subscribers receive structured data without parsing messages. Falls back to regex extraction for backward compatibility.

## Problem Statement

The workflow architect/refine/diagnose flows relied on **prompt convention + client-side regex** (`extractWorkflowYaml`) to parse YAML from agent messages. If the agent didn't produce a ` ```yaml ` fence, the flow hit `extraction-failed`. The structured output enforcement mechanism (ToolStrategy for native harness, 3-tier extraction for Cursor) was already built for `call:agent` workflow tasks but didn't flow to the frontend subscriber path.

### Pain Points

- Non-deterministic extraction: agent formatting changes could break parsing
- Race condition: runner persisted COMPLETED status before extracting structured output, so the subscriber disconnected before seeing structured data
- No first-class proto field for structured output on `AgentExecutionStatus`
- Dead extraction code in the workflow domain (never wired)
- `call-agent-output.ts` had redundant `JSON.parse(final_text)` fallback that duplicated agent domain responsibility

## Solution

End-to-end structured output pipeline: proto field → runner reorder → server merge → frontend hooks read `structuredOutput` first, fall back to regex extraction for backward compatibility.

## Implementation Details

### Proto Layer
- Added `google.protobuf.Struct structured_output = 21` to `AgentExecutionStatus`
- Regenerated all stubs (TS/Go/Java/Python/Dart) via `make protos`

### Runner Reorder (Critical Fix)
- **Native harness** (`execute-deep-agent/index.ts`): Extract `structuredResponse` from LangGraph state BEFORE `persistStatus(COMPLETED)`, set it on the status proto
- **Cursor harness** (`execute-cursor/index.ts`): Run 3-tier extraction (JSON.parse → fence → extraction LLM) BEFORE `persistStatus(COMPLETED)`, set on proto
- Both harnesses still append to slim status for the Temporal callback path

### Server Merge
- **Go** (`update_status.go`): `if requestStatus.StructuredOutput != nil` merge in `BuildNewStateWithStatusStep`
- **Java** (`AgentExecutionUpdateStatusHandler.java`): Equivalent `hasStructuredOutput()` → `setStructuredOutput()` merge

### Frontend SDK
- `useCreateAgentExecution`: Added `structuredOutputSchema` field, wired to `executionConfig`
- Created `architect-response-schema.ts` with `WORKFLOW_ARCHITECT_RESPONSE_SCHEMA` (generated_yaml/clarification/no_changes) and `WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA` (diagnosis/fix_yaml/clarification)
- Updated all three hooks to pass schema on execution creation and read `structuredOutput` on terminal phase

### Agent Instructions
- Updated `workflow-architect.yaml` Step 6 to reference structured output tool actions instead of fenced code blocks

### Cleanup (Phase 2.5)
- Simplified `call-agent-output.ts`: removed `JSON.parse(final_text)` fallback — workflow domain now trusts `result.structured` from agent domain
- Removed dead `extractStructuredOutput` from `TaskExecutionContext` interface
- Removed unreachable pre-retry extraction block from `call-agent.ts`

## Benefits

- **Deterministic**: Structured output enforcement (Zod schema via ToolStrategy) eliminates formatting-dependent extraction failures
- **Atomic**: Frontend subscriber sees COMPLETED + structured_output in the same gRPC broadcast (no race condition)
- **Backward-compatible**: Falls back to regex extraction for in-flight executions without the schema
- **Cleaner ownership**: Agent domain owns extraction; workflow domain owns validation + policy routing
- **Reduced dead code**: ~50 lines of unreachable extraction logic removed

## Impact

- Frontend: `useWorkflowArchitectFlow`, `useRefineWorkflowFlow`, `useDiagnoseExecutionFlow` — all three hooks now use structured output
- Backend: Both runner harnesses (native + Cursor), Go server, Java server (Cloud)
- Agent: `workflow-architect` seedpack agent instructions updated
- SDK: `useCreateAgentExecution` exposes `structuredOutputSchema` for any consumer

## Related Work

- Builds on: `_changelog/2026-05/2026-05-23-194126-feat-agent-call-strategy-structured-output-langchain.md` (structured output for workflow `call:agent` tasks)
- Part of: `_projects/2026-05/20260523.02.workflow-ux-implementation`

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
