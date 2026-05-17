# Session Notes: 2026-05-15 — T16 Batch 4: Workflow Repair Assistant

## Accomplishments

- Designed and implemented the complete "Diagnose with AI" feature for failed workflow executions
- Full vertical slice: proto contract → Go backend → Java backend → SDK client → React hook → styled component → viewer integration → console integration
- Phase 3 (AI-Assisted Creation) is now COMPLETE with all 4 batches delivered

## Files Created (5)

- `backend/services/stigmer-server/pkg/domain/workflow/controller/diagnose_execution.go` — Go handler
- `sdk/react/src/workflow/useDiagnoseExecution.ts` — React behavior hook
- `sdk/react/src/workflow/WorkflowRepairCard.tsx` — Styled repair card component
- `backend/services/stigmer-service/.../WorkflowDiagnoseExecutionHandler.java` — Java handler (Cloud repo)
- Proto stubs: `DiagnoseWorkflowExecutionInput.java`, `DiagnoseWorkflowExecutionOutput.java` + OrBuilder variants

## Files Modified (12+)

- `apis/ai/stigmer/agentic/workflow/v1/io.proto` — DiagnoseWorkflowExecutionInput/Output messages
- `apis/ai/stigmer/agentic/workflow/v1/command.proto` — diagnoseWorkflowExecution RPC
- `backend/services/stigmer-server/pkg/llmclient/prompt.go` — BuildDiagnosticPrompt, SplitDiagnosticResponse
- `sdk/typescript/src/gen/workflow.ts` — diagnoseExecution() method + types
- `sdk/typescript/src/index.ts` — barrel exports
- `sdk/react/src/workflow/WorkflowExecutionHeader.tsx` — "Diagnose" button
- `sdk/react/src/workflow/WorkflowExecutionViewer.tsx` — repair card integration
- `sdk/react/src/workflow/index.ts` — barrel exports
- `sdk/react/src/index.ts` — barrel exports
- `client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx` — org prop
- `client-apps/desktop/src/pages/workflow/WorkflowExecutionDetailPage.tsx` — org from search params
- `backend/services/stigmer-service/.../WorkflowPromptBuilder.java` — buildDiagnosticPrompt (Cloud repo)
- All proto stubs (Go, Java, TS, Python) in both repos

## Decisions Made

- **AD-T16-B4-001**: Diagnosis from execution status data, not event log — works in both OSS (no event log) and Cloud
- **AD-T16-B4-002**: Not all failures need YAML fixes — definition errors get suggested_yaml, runtime errors get diagnosis only
- **AD-T16-B4-003**: RPC on WorkflowCommandController — consistent with generate/refine, same auth pattern
- **AD-T16-B4-004**: Navigation via callback prop — Apply Fix uses onNavigateToWorkflowEditor (DD-004)

## Key Code Patterns

- **Diagnostic prompt structure**: Failure-focused system prompt with workflow YAML + execution failure context + task kind reference for failing kinds + definition vs runtime classification instructions
- **Response parsing**: `SplitDiagnosticResponse` extracts diagnosis + YAML block + fix explanation from LLM output
- **Workflow proto-to-YAML**: `workflowProtoToYAML()` converts Protobuf object via protojson.Marshal → yaml.Marshal
- **Workflow ID resolution**: Handler supports both `workflow_id` and `workflow_instance_id` on execution spec

## Learnings

- The `WorkflowExecution.spec` in OSS primarily uses `workflow_id` to reference the parent workflow — `workflow_instance_id` resolution is available but not the common path
- Proto stubs for `DiagnoseWorkflowExecutionInput`/`Output` were not picked up by the `proto2schema` codegen for the SDK client, requiring the same manual patch pattern used for generate/refine
- Barrel exports in `sdk/react/src/index.ts` use separate `export { ... }` and `export type { ... }` blocks — mixing `type` inline modifiers inside `export type` blocks causes TS2207

## Open Questions

- Event log enrichment in Cloud: could include last 10-20 events for richer diagnostic context (not implemented yet — deferred)
- "Apply Fix" currently navigates to editor with suggested YAML; could alternatively create a draft version (manual review preferred for safety)

## Next Session Plan

- Phase 3 is complete. Next: Phase 4 (T17) or open tech debt items
- stigmer-cloud needs a matching commit for its proto stubs + Java handler
