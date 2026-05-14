# Session Notes: 2026-05-14 — T16 Batch 1: Prompt-to-Workflow Generation Infrastructure

## Accomplishments

- Defined and codegen'd `GenerateWorkflowFromPromptInput/Output` proto messages and `generateWorkflowFromPrompt` RPC across Go, Java, TypeScript, and Python stubs (both OSS and Cloud repos)
- Built standalone HTTP LLM client for stigmer-server (`pkg/llmclient/client.go`) supporting OpenAI and Anthropic with environment-based key resolution
- Built prompt template engine (`pkg/llmclient/prompt.go`) that assembles: workflow structure rules, filtered task kind reference from embedded registry, org resource context (agents, MCP servers, skills, existing workflows), canonical examples, and generation rules
- Implemented Go handler (`generate_workflow.go`) with model resolution, org context building, LLM call, YAML/explanation splitting, structural validation, and retry-with-error-feedback loop (max 2 retries)
- Built Java Cloud equivalents: `WorkflowPromptBuilder.java` (classpath registry, MongoDB org queries), `WorkflowYamlValidator.java` (SnakeYAML validation), `WorkflowGenerateFromPromptHandler.java` (LlmCallService + LlmProxyConfig pipeline)
- Added `generateFromPrompt()` method and types to TypeScript SDK `WorkflowClient`
- All builds clean: buf lint, go build/vet, bazelw build (85 targets), tsc --noEmit

## Decisions Made

- **AD-T16-001: Server-side generation** — prompts constructed server-side, not sent from client. Enables iteration on prompt templates without frontend deploys.
- **AD-T16-002: Generate YAML, not proto** — YAML is the canonical authoring format. LLM output directly editable by user in YAML editor (T10).
- **AD-T16-003: Separate LLM client** — `pkg/llmclient/` is independent from workflow-runner's `pkg/llm/`. Different needs: stigmer-server does non-streaming generation; workflow-runner does streaming task execution.
- **AD-T16-004: Validation-in-the-loop** — Server validates generated YAML (parse + task kind checks), feeds errors back to LLM for a corrective retry (max 2). Reduces user-facing errors without excessive cost.
- **AD-T16-005: Org context injection** — Prompt includes summaries of the org's agents, MCP servers, skills, and existing workflows so the LLM can reference real resources.
- **AD-T16-006: Java model resolution via LlmProxyConfig** — No dedicated ModelPricingService needed. Handler resolves default model from configured provider keys (Anthropic preferred, then OpenAI).

## Key Code Changes

### OSS (stigmer repo)
- `apis/ai/stigmer/agentic/workflow/v1/io.proto` — New messages
- `apis/ai/stigmer/agentic/workflow/v1/command.proto` — New RPC
- `backend/services/stigmer-server/pkg/llmclient/client.go` — LLM HTTP client (new)
- `backend/services/stigmer-server/pkg/llmclient/prompt.go` — Prompt builder (new)
- `backend/services/stigmer-server/pkg/domain/workflow/controller/generate_workflow.go` — Handler (new)
- `backend/services/stigmer-server/pkg/domain/workflow/controller/workflow_controller.go` — Extended
- `backend/services/stigmer-server/pkg/domain/workflow/registry/task_kind_registry.go` — ReadEmbeddedRegistry()
- `backend/services/stigmer-server/pkg/server/server.go` — Wiring
- `sdk/typescript/src/gen/workflow.ts` — SDK method + types
- `sdk/typescript/src/index.ts` — Barrel exports
- Generated stubs in Go, Java, TS, Python

### Cloud (stigmer-cloud repo)
- `domain/agentic/workflow/generation/WorkflowPromptBuilder.java` — Prompt builder (new)
- `domain/agentic/workflow/generation/WorkflowYamlValidator.java` — Validator (new)
- `domain/agentic/workflow/request/handler/WorkflowGenerateFromPromptHandler.java` — Handler (new)
- `backend/services/stigmer-service/BUILD.bazel` — SnakeYAML dep
- Generated stubs in Go, Java, TS, Python, Dart

## Learnings

- The `make protos` command in the OSS repo depends on Bazel/Gazelle for the `go-stubs` target, which fails when the `test/integration` directory has no BUILD file. Workaround: run individual codegen targets (`buf generate` per template) and then fix-up Go stubs manually.
- Java Cloud backend uses `LlmCallService.chatCompletion()` for metered, billable calls — simpler than building a standalone HTTP client like Go. The `LlmProxyConfig` bean already holds all provider base URLs and API keys.
- Task kind registry is embedded differently: Go uses `//go:embed`, Java uses classpath `getResourceAsStream`. Both work at runtime without filesystem access.
- The `WorkflowCommandController.Method.generateWorkflowFromPrompt` enum constant was auto-generated from the proto — no manual registration needed in Java.

## Open Questions

- Batch 2 design: Should the generation dialog allow specifying `task_kind_hints` in the UI, or derive them from the prompt? The proto supports hints but the UX tradeoff is unclear.
- Should generated workflows be auto-saved as drafts, or presented to the user for review before persisting?
- Refine (Batch 3) will need conversation state — should it be client-managed or server-managed?

## Next Session Plan

1. T16 Batch 2: Generation Dialog
   - SDK `useGenerateWorkflow` hook (calls `generateFromPrompt`, manages loading/error/result state)
   - `WorkflowGenerateDialog` styled component (prompt textarea, optional model selector, result preview with YAML editor, "Save as Workflow" action)
   - Console integration: "Generate from Prompt" button on workflow list page
2. T16 Batch 3: Refine Workflow RPC
3. T16 Batch 4: Diagnose Workflow RPC
