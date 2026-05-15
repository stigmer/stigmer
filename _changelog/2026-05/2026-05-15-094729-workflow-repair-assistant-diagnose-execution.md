# Workflow Repair Assistant — AI-Powered Execution Diagnosis

**Date**: May 15, 2026

## Summary

Added an AI-powered "Diagnose with AI" capability for failed workflow executions, completing the execution feedback loop. When a workflow execution fails, users can now request an LLM-driven root cause analysis that distinguishes definition errors (bad config, invalid expressions) from runtime errors (transient failures, missing env vars), and when appropriate, receive a corrected YAML fix with a visual diff preview. Full vertical slice: proto contract, Go + Java backend handlers, TypeScript SDK client, React behavior hook, styled repair card, and console integration with DD-016 parity.

## Problem Statement

When a workflow execution fails, users had no automated way to understand the root cause or get actionable remediation. They had to manually inspect execution status, cross-reference with the workflow definition, and figure out what went wrong. This is time-consuming and error-prone, especially for definition errors where a small YAML fix could resolve the issue.

### Pain Points

- No guidance on why an execution failed beyond a raw error message
- No distinction between "fix the workflow definition" vs "operational issue"
- Manual YAML debugging required deep platform knowledge
- No path from "execution failed" to "here's the corrected definition"

## Solution

Server-side LLM diagnosis that loads execution failure context (phase, error, per-task statuses) alongside the parent workflow YAML, then produces a structured analysis:
- **Definition errors**: root cause explanation + corrected YAML + change description
- **Runtime errors**: root cause explanation + operational remediation guidance (no YAML change)

Validation-in-the-loop ensures suggested YAML fixes pass structural validation before being presented to the user. The UI bridges the gap from execution monitoring to authoring with a single "Apply Fix" action.

## Implementation Details

### Proto Contract
- `DiagnoseWorkflowExecutionInput` — execution_id, org, optional model preference
- `DiagnoseWorkflowExecutionOutput` — diagnosis, suggested_yaml (optional), fix_explanation (optional), warnings, model_used
- `diagnoseWorkflowExecution` RPC on `WorkflowCommandController` with `can_create_workflow` authorization

### Go Backend (OSS — stigmer-server)
- **`pkg/llmclient/prompt.go`** — `BuildDiagnosticPrompt()` constructs failure-focused system + user prompts with workflow YAML, execution failure context (phase, error, per-task statuses with kind/error/duration), task kind metadata for failing kinds, and instructions distinguishing definition vs runtime errors
- **`pkg/domain/workflow/controller/diagnose_execution.go`** — Handler: model resolution, execution loading via `store.GetResource`, workflow resolution (supports both `workflow_id` and `workflow_instance_id` references), workflow-to-YAML serialization (protojson → yaml), diagnostic prompt construction, LLM call, response parsing with `SplitDiagnosticResponse`, suggested YAML validation with max 2 retries

### Java Backend (Cloud — stigmer-service)
- **`WorkflowPromptBuilder.java`** — `buildDiagnosticPrompt()` mirrors Go logic: workflow YAML serialization (protobuf → JSON → YAML), execution failure context formatting, task kind reference for failing kinds
- **`WorkflowDiagnoseExecutionHandler.java`** — `RequestPipelineV2` with `DiagnoseStep`: loads execution from repo, loads workflow, serializes to YAML, builds prompt, calls `LlmCallService`, validates suggested YAML with retries

### SDK TypeScript Client
- `WorkflowClient.diagnoseExecution()` method with `DiagnoseExecutionInput` / `DiagnoseExecutionResult` types
- Exported from `@stigmer/sdk` barrel

### SDK React — Behavior Hook
- `useDiagnoseExecution` — manages `isDiagnosing`, `result`, `error` state; `diagnose()` triggers the RPC; `reset()` clears; return wrapped in `useMemo` (DD-010)

### SDK React — Styled Component
- `WorkflowRepairCard` — card with diagnosis text, conditional diff preview (reuses `computeUnifiedDiff`), warnings, "Apply Fix" button. Loading/error states. `--stgm-*` tokens, zero Console dependencies (DD-004)

### Viewer Integration
- "Diagnose" button in `WorkflowExecutionHeader` (failed executions only, alongside "Recover")
- `WorkflowRepairCard` rendered in `WorkflowExecutionViewer` sidebar when diagnosis is active
- `onNavigateToWorkflowEditor` callback prop for Apply Fix navigation (DD-004)

### Console Integration (DD-016 Parity)
- Web: `WorkflowExecutionDetailPage` passes `org` prop to viewer
- Desktop: extracts `org` from URL search params, passes to viewer
- Both wire `onNavigateToWorkflowEditor` for Apply Fix navigation

## Benefits

- **Closes the execution feedback loop**: users go from "what went wrong?" to "here's the fix" in one click
- **Intelligent categorization**: LLM distinguishes definition errors (fixable) from runtime errors (operational), preventing misleading "fix" suggestions
- **Validation safety net**: suggested YAML fixes are structurally validated before presentation, with automatic retry on validation failure
- **Cross-edition consistency**: identical prompt structure in Go and Java ensures consistent diagnosis quality across OSS and Cloud

## Impact

- **Users**: can self-serve diagnosis of failed workflow executions without deep platform knowledge
- **Platform**: completes the T16 AI-assisted workflow lifecycle (generate → refine → diagnose)
- **Architecture**: follows established patterns (generate/refine) for LLM-powered features; no new architectural concepts introduced

## Related Work

- T16 Batch 1: Prompt-to-Workflow Generation Infrastructure (backend pipeline)
- T16 Batch 2: Generation Dialog (SDK + Console Integration)
- T16 Batch 3: Refine Workflow — Chat-Style Iteration
- T09: Workflow Execution Viewer (the host component for the diagnosis UI)
- AD-T16-B4-001: Diagnosis from execution status data (not event log)
- AD-T16-B4-002: Not all failures need YAML fixes
- AD-T16-B4-003: RPC on WorkflowCommandController
- AD-T16-B4-004: Navigation via callback prop (DD-004)

---

**Status**: ✅ Production Ready
**Timeline**: T16 Batch 4 — single session
