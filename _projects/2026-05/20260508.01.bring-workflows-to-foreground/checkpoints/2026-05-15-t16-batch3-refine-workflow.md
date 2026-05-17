# Session Notes: 2026-05-15 — T16 Batch 3: Refine Workflow

## Accomplishments

- Implemented the complete `refineWorkflow` feature end-to-end across all layers
- Proto contract: `RefineWorkflowInput`/`RefineWorkflowOutput` messages + `refineWorkflow` RPC
- Go handler: `refine_workflow.go` + `BuildRefinementPrompt()` in `prompt.go`
- Java handler: `WorkflowRefineHandler.java` + `buildRefinementPrompt()` in `WorkflowPromptBuilder.java`
- SDK TypeScript: `WorkflowClient.refine()` method with typed input/result interfaces
- React behavior hook: `useRefineWorkflowFlow` (refinement state, history, refine/reset/clearHistory)
- Self-contained diff utility: `workflow-yaml-diff.ts` (Myers diff algorithm, no deps)
- UI panel: `WorkflowRefinePanel` with instruction input, conversation history, diff preview, accept/discard
- Editor integration: toolbar toggle, panel replaces graph in code mode, sidebar in visual mode
- Barrel exports updated at both workflow and top-level index files
- Codegen propagated across Go, Java, TypeScript, Python stubs (both repos)

## Decisions Made

- **Stateless refinement (AD-T16-B3-001)**: Only `current_yaml` + `instruction` sent to server per request. Conversation history tracked exclusively on the UI client. This reduces token cost, simplifies backend, and avoids growing context windows.
- **Self-contained Myers diff (AD-T16-B3-002)**: Implemented in-house rather than pulling an external dependency, complying with SDK license policy (DD-012) and keeping bundle size minimal (~60 LOC).
- **Refinement prompt strategy (AD-T16-B3-003)**: System prompt explicitly instructs the LLM to make minimal targeted changes and provide concise change-focused explanations — addresses user trust concerns about unexpected workflow alterations.
- **Panel layout (AD-T16-B3-004)**: In code mode, refine panel replaces the topology graph to avoid a cramped three-pane layout. In visual mode, it appears as a collapsible sidebar with the canvas shrinking to accommodate.

## Key Code Changes

- `apis/ai/stigmer/agentic/workflow/v1/io.proto` — Added `RefineWorkflowInput` and `RefineWorkflowOutput` messages
- `apis/ai/stigmer/agentic/workflow/v1/command.proto` — Added `refineWorkflow` RPC with org-level authorization
- `backend/services/stigmer-server/pkg/llmclient/prompt.go` — Added `BuildRefinementPrompt()` and `writeRefinementRules()`
- `backend/services/stigmer-server/pkg/domain/workflow/controller/refine_workflow.go` — New Go handler
- `stigmer-cloud/.../WorkflowPromptBuilder.java` — Added `buildRefinementPrompt()`
- `stigmer-cloud/.../WorkflowRefineHandler.java` — New Java handler
- `sdk/typescript/src/gen/workflow.ts` — Added `refine()` method + types
- `sdk/react/src/workflow/useRefineWorkflowFlow.ts` — New behavior hook
- `sdk/react/src/workflow/workflow-yaml-diff.ts` — New diff utility
- `sdk/react/src/workflow/WorkflowRefinePanel.tsx` — New UI panel
- `sdk/react/src/workflow/WorkflowEditorView.tsx` — Toolbar toggle + layout integration

## Learnings

- The `generateFromPrompt` method on `WorkflowClient` is a manual patch over codegen — regenerating stubs wipes it. Must restore manually after each codegen run until `proto2schema` gap is fixed.
- `buf generate` for Go stubs sometimes creates nested directory structures; needs manual relocation.
- Aliasing re-exported types (e.g., `WorkflowDiffLine` vs `DiffLine`) is necessary to avoid namespace collisions across SDK modules.

## Open Questions

- Should refinement support streaming responses in a future batch? Would improve perceived latency for large workflows.
- Should the refine panel support "undo last refinement" beyond just discard? Could use the YAML history already tracked in the hook.

## Next Session Plan

1. **T16 Batch 4: Diagnose Workflow** — `diagnoseWorkflow` RPC + error analysis + repair suggestions
2. Or proceed to Phase 4 (Advanced Agentic Orchestration) if T16 Batch 4 is deprioritized
