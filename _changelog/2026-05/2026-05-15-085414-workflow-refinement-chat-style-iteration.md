# Workflow Refinement: Chat-Style Iteration

**Date**: May 15, 2026

## Summary

Added the `refineWorkflow` RPC and a complete chat-style refinement experience to the Stigmer workflow editor. Users can now iteratively improve generated or hand-written workflows through natural language instructions, with a diff preview showing exactly what changed before accepting or discarding each refinement.

## Problem Statement

After Batch 1 (generation infrastructure) and Batch 2 (generation dialog), users could create workflows from prompts but had no way to iteratively refine them through conversation. The only option was to manually edit the YAML, which breaks the "AI-assisted creation" flow and requires deep knowledge of the workflow DSL.

### Pain Points

- Generated workflows rarely match intent perfectly on the first attempt
- Manual YAML editing requires workflow DSL expertise
- No visibility into what the AI changed during refinement
- No way to build on previous generation results through follow-up instructions

## Solution

Implemented a stateless refinement RPC where the client sends the current YAML and a natural language instruction, and the server returns a refined YAML with an explanation of changes. The UI presents this as a chat-style panel with conversation history (tracked client-side), a line-by-line diff preview, and accept/discard actions.

## Implementation Details

### Proto Contract
- `RefineWorkflowInput`: current_yaml, instruction, org, model (optional)
- `RefineWorkflowOutput`: yaml, explanation, warnings, model_used
- `refineWorkflow` RPC on `WorkflowCommandController` with `can_create_workflow` authorization

### Backend (Go + Java)
- Refinement-specific prompt templates (`BuildRefinementPrompt`) that instruct the LLM to:
  - Make minimal, targeted changes to the existing YAML
  - Preserve task names, structure, and flow unless explicitly asked to change
  - Provide concise, change-focused explanations (not full workflow descriptions)
- Validation-in-the-loop with max 2 retries (same pattern as generation)
- Org context injection for resource-aware refinements

### SDK TypeScript
- `WorkflowClient.refine()` method with typed `RefineWorkflowClientInput` and `RefineWorkflowResult`

### SDK React
- `useRefineWorkflowFlow` behavior hook: manages refinement state, result, error, and conversation history
- `workflow-yaml-diff.ts`: self-contained Myers diff algorithm (~60 LOC, zero dependencies) producing `DiffLine[]` for UI visualization
- `WorkflowRefinePanel`: instruction input, scrollable history, diff preview with color-coded added/removed lines, accept/discard buttons

### Editor Integration
- "Refine with AI" toggle in `WorkflowEditorView` toolbar
- Code mode: panel replaces topology graph (avoids three-pane crowding)
- Visual mode: panel as collapsible sidebar alongside canvas

## Benefits

- Users can iterate on workflows through natural language without leaving the editor
- Diff preview builds trust by showing exactly what changed before accepting
- Stateless design keeps backend simple and token costs low (no growing context window)
- Self-contained diff algorithm avoids external dependencies (SDK license compliance)
- Refinement-specific prompts produce minimal, predictable changes

## Impact

- **End users**: Can now go from rough prompt → polished workflow entirely through conversation
- **Workflow editor**: Gains AI-powered editing capability alongside manual YAML and visual canvas
- **Platform**: Completes the generate → refine loop in the AI-assisted creation phase (Phase 3 Batches 1-3)

## Related Work

- T16 Batch 1: Generation infrastructure (proto + Go/Java handlers + SDK client)
- T16 Batch 2: Generation dialog (SDK hook + two-phase dialog + console integration)
- T16 Batch 4 (next): Diagnose workflow — error analysis + repair suggestions

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~3 hours)
