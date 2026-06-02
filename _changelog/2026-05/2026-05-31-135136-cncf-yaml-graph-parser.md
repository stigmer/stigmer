# CNCF YAML Graph Parser for Version-Pinned Execution Viewer

**Date**: May 31, 2026

## Summary

Fixed "Unable to build workflow graph" error caused by a YAML format mismatch in the workflow versioning feature. The version-pinned execution graph path was passing CNCF Serverless Workflow DSL format YAML to a parser that only understood Stigmer native format. Added a CNCF-to-graph parser that enables the execution graph to render correctly from version-pinned YAML.

## Problem Statement

After the workflow versioning infrastructure was deployed, opening any workflow execution showed "Unable to build workflow graph" even though the execution was running successfully. The TS runner worked fine (it executed tasks correctly), but the frontend graph viewer could not render the DAG.

### Pain Points

- Every workflow execution created after versioning showed a broken graph
- The error message gave no indication of the actual failure (format mismatch)
- The `catch {}` in the graph-build `useMemo` silently swallowed the parse error
- Users had no way to visualize their running workflow executions

## Solution

### Root Cause

The `getVersion` RPC returns `validatedYaml` sourced from `workflow.status.serverlessWorkflowValidation.yaml`, which is in **CNCF Serverless Workflow DSL format** (top-level `document` + `do` array). The execution graph hook passed this directly to `yamlToGraph()`, which expects **Stigmer native format** (with `apiVersion`, `kind`, `spec.document`, `spec.tasks`). The format mismatch caused `yamlToGraph()` to throw at `requireObj(parsed.spec, "spec")`, which was swallowed by the catch block.

The TS runner was unaffected because it uses `loadWorkflowFromYaml()` which expects CNCF format.

### Fix: Dual-Format Graph Building

Added a `cncfYamlToGraph()` function that parses CNCF Serverless Workflow DSL directly into the same `WorkflowGraphModel` type used by the existing pipeline. The hook now detects the format and dispatches to the correct parser.

Key implementation details:

- **Format detection**: `isCncfWorkflowYaml()` checks for top-level `do` array (CNCF) vs `spec` object (Stigmer)
- **CNCF call type mapping**: The Go converter uses shortened call types (`agent` not `agent_call`, `http` not `http_call`). A static map translates these back to Stigmer `WorkflowTaskKind` enum names.
- **Task discrimination**: Handles all CNCF task types — `call:` (agent, human_input, emit_event, http, grpc, llm, etc.), `switch:`, `for:`, `fork:`, `set:`, `try:`, `run:`
- **Edge inference**: Explicit `then`, switch case branches, human_input outcome routing, and sequential fallthrough

## Implementation Details

### Files Created

- `sdk/react/src/workflow/cncf-yaml-to-graph.ts` — CNCF DSL parser producing `WorkflowGraphModel`
- `sdk/react/src/workflow/__tests__/cncf-yaml-to-graph.test.ts` — 22 unit tests covering all task kinds

### Files Modified

- `sdk/react/src/workflow/useWorkflowExecutionGraph.ts` — Format detection + dispatch (3-line change in `graphBuild` useMemo)

### CNCF Call Type -> Stigmer Kind Mapping

| CNCF `call` value | Stigmer `WorkflowTaskKind` |
|--------------------|---------------------------|
| `agent` | `agent_call` |
| `http` | `http_call` |
| `grpc` | `grpc_call` |
| `llm` | `llm_call` |
| `human_input` | `human_input` |
| `emit_event` | `emit_event` |
| `notification` | `notification` |
| `validate` | `validate` |
| `eval` | `eval` |
| `transform` | `transform` |

### Validation

- Tested against real CNCF YAML extracted from MongoDB (`workflow_audit` collection) for the `daily-notification-plan` workflow
- 22 unit tests pass covering: format detection, all task kinds, edge building (explicit then, switch cases, human_input outcomes, sequential flow), and a full complex workflow integration test

## Benefits

- **Version-pinned execution graphs now render correctly** — the core versioning feature works end-to-end
- **No backend or proto changes required** — purely frontend fix
- **Backward compatible** — Stigmer-format YAML (from live workflow fallback or overview graphs) continues to work via the existing `yamlToGraph()` path
- **Retroactive** — works for all existing audit entries without migration

## Impact

- All workflow execution graph viewers (desktop, web, embedded SDK components)
- Any execution created after workflow versioning was enabled
- Both OSS and Cloud editions (the hook is in the shared React SDK)

## Related Work

- Workflow Versioning Infrastructure (2026-05-30-175736) — introduced the versioning system
- Version-Pinned Execution Graph Correctness (2026-05-31-122533) — fixed pinning bugs
- Versioning Integration Fixes (2026-05-30-183501) — fixed TypeScript compilation errors

---

**Status**: Production Ready
**Timeline**: Single session
