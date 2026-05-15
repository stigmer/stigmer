# Remove Direct LLM Workflow Generation Infrastructure

**Date**: May 15, 2026

## Summary

Removed all direct LLM-powered workflow generation, refinement, and diagnosis infrastructure across both the stigmer (OSS) and stigmer-cloud repositories. This is the first step of the agent-powered workflow generation rewrite — clearing the path for the Workflow Architect agent to replace single-shot LLM calls with richer, tool-use-based agent sessions.

## Problem Statement

The existing workflow generation approach used direct LLM HTTP calls with hand-crafted prompts to generate, refine, and diagnose workflows. This architecture had fundamental limitations that prevented it from scaling to the sophistication needed for production workflow authoring.

### Pain Points

- Single-shot LLM calls couldn't iteratively explore MCP server capabilities or validate tool schemas
- Prompt construction was fragile — 660+ lines of Go code building prompts with string concatenation
- No observability into the generation process — users got a result or an error, nothing in between
- The refinement flow was a separate RPC rather than a continuation of the generation conversation
- Diagnosis was disconnected from the generation context, reducing repair quality

## Solution

Performed a clean, subtractive teardown of all LLM-related infrastructure across both repositories. This removes 3 gRPC RPCs, 6 protobuf messages, the Go LLM HTTP client, prompt construction logic, Go controller implementations, Java Spring handlers, and the Java-side prompt builder and YAML validator. All generated stubs (Go, Java, TypeScript, Python, Dart) were regenerated to reflect the updated proto definitions.

## Implementation Details

### Proto API Changes (`stigmer` repo)

**`io.proto`**: Removed 6 messages (140 lines):
- `GenerateWorkflowFromPromptInput/Output` — prompt text, model selection, task kind registry
- `RefineWorkflowInput/Output` — iterative refinement with change instructions
- `DiagnoseWorkflowExecutionInput/Output` — execution error analysis and repair suggestions

Retained `WorkflowId` — still used by the `delete` RPC.

**`command.proto`**: Removed 3 RPCs (38 lines):
- `generateWorkflowFromPrompt`
- `refineWorkflow`
- `diagnoseWorkflowExecution`

Retained CRUD operations: `apply`, `create`, `update`, `delete`.

### Go Backend Teardown (`stigmer` repo)

- **Deleted `pkg/llmclient/`** (2 files, 1,057 lines) — standalone HTTP client for LLM chat completions, prompt construction, YAML extraction/splitting utilities
- **Deleted 3 controller files** (795 lines) — `generate_workflow.go`, `refine_workflow.go`, `diagnose_execution.go`
- **Modified `workflow_controller.go`** — removed `llmClient` and `taskKindRegistry` fields plus their setter methods
- **Modified `server.go`** — removed LLM client instantiation and wiring block; kept `taskkindregistry` HTTP handler (serves the frontend workflow editor independently)

### Java Backend Teardown (`stigmer-cloud` repo)

- **Deleted `generation/` directory** (2 files) — `WorkflowPromptBuilder.java` (prompt construction), `WorkflowYamlValidator.java` (LLM output validation)
- **Deleted 3 handler files** — `WorkflowGenerateFromPromptHandler.java`, `WorkflowRefineHandler.java`, `WorkflowDiagnoseExecutionHandler.java` (Spring auto-discovered via annotation processor — no manual unregistration needed)

### Codegen and SDK

- **`make codegen`** in stigmer repo — regenerated Go, TypeScript, Python, Dart stubs
- **`make -C sdk/go codegen`** — regenerated SDK-specific Go stubs and the generated facade (`sdk/go/internal/gen/workflow.go`), which automatically dropped the `GenerateWorkflowFromPrompt`, `RefineWorkflow`, and `DiagnoseWorkflowExecution` wrapper methods
- **`make protos`** in stigmer-cloud repo — regenerated Java, Go, Python, TypeScript, Dart stubs

## Benefits

- Clean slate for the Workflow Architect agent — no dead code paths or conflicting abstractions
- Removed ~3,800 lines of code across both repositories (net: -3,838 in stigmer, significant deletions in stigmer-cloud)
- Simplified the `WorkflowCommandController` — fewer responsibilities, clearer contract
- Eliminated the standalone LLM HTTP client that would have competed with the agent harness
- All generated stubs are consistent with the updated proto definitions

## Impact

- **API surface**: 3 RPCs and 6 message types removed from the workflow gRPC service. Any direct callers would get `UNIMPLEMENTED`. Since the SDK/React layer never exposed these (no frontend components were ever built for them), the blast radius is minimal.
- **Task kind registry HTTP endpoint**: Preserved — serves the workflow editor UI independently of LLM generation
- **Build systems**: Go builds and vet pass cleanly. Proto lint passes. Pre-existing Bazel/Gazelle `test/integration` issue noted but unrelated to this change.

## Related Work

- [workflow-repair-assistant-diagnose-execution](2026-05-15-094729-workflow-repair-assistant-diagnose-execution.md) — the diagnose RPC we just removed was added in the previous session
- [workflow-refinement-chat-style-iteration](2026-05-15-085414-workflow-refinement-chat-style-iteration.md) — the refine RPC we just removed
- Part of project **20260515.01.sp.agent-powered-workflow-generation** — Batch 1A (Proto Cleanup + Backend Teardown)

---

**Status**: Production Ready
**Timeline**: ~30 minutes (exploration, deletion, codegen, verification)
