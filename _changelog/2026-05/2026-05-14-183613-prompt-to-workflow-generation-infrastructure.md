# Prompt-to-Workflow Generation Infrastructure (T16 Batch 1)

**Date**: May 14, 2026

## Summary

Added the `generateWorkflowFromPrompt` RPC — a new endpoint that accepts a natural language description and returns a validated Stigmer Workflow YAML document. The implementation spans the proto contract, both Go (OSS) and Java (Cloud) backends, and the TypeScript SDK client. This is the foundation for Phase 3 (AI-Assisted Creation), enabling users to describe what they want a workflow to do in plain English and receive a runnable workflow definition.

## Problem Statement

Creating workflows requires knowledge of the YAML schema, available task kinds, their configuration fields, and flow control semantics. This is a steep learning curve for new users and a friction point even for experienced ones when prototyping new automations.

### Pain Points

- Users must memorize or reference 19+ task kinds and their configurations
- Writing YAML from scratch is slow and error-prone
- No way to leverage AI to bootstrap workflow definitions
- Organizational context (existing agents, MCP servers, skills) not automatically considered when creating workflows

## Solution

Server-side workflow generation using LLM APIs with structured prompt engineering. The server constructs a comprehensive prompt that includes workflow structure rules, a filtered task kind reference, the organization's existing resources, canonical examples, and strict generation rules. The LLM response is parsed, structurally validated, and retried with error feedback if invalid.

## Implementation Details

### Proto Contract

New messages in `workflow/v1/io.proto`:
- `GenerateWorkflowFromPromptInput` — prompt (min 10 chars), org, optional model override, optional task_kind_hints for filtering
- `GenerateWorkflowFromPromptOutput` — yaml, explanation, warnings, model_used

New RPC in `workflow/v1/command.proto`:
- `generateWorkflowFromPrompt` — requires `can_create_workflow` permission on the organization

### Go Backend (stigmer-server)

**New `pkg/llmclient/` package** (2 files):
- `client.go` — Standalone HTTP client supporting OpenAI and Anthropic providers. Resolves API keys from environment variables, handles provider-specific request/response formats, includes YAML extraction and validation error formatting utilities.
- `prompt.go` — Prompt template builder. Assembles system prompt from: workflow YAML structure documentation, task kind reference (filtered by hints if provided, parsed from the embedded registry), organization resource context (agents, MCP servers, skills, existing workflows queried from the store), two canonical example workflows, and 12 generation rules.

**Handler** (`generate_workflow.go`):
1. Resolve model (explicit or default from environment)
2. Build org context by querying the store for agents, MCP servers, skills, and workflows
3. Construct system + user prompts via the prompt builder
4. Call LLM via the HTTP client
5. Split response into YAML + explanation
6. Validate YAML structurally (parse check + task kind validation against registry)
7. If validation fails and retries remain, append errors to prompt and retry (max 2)
8. Return YAML, explanation, warnings, and model_used

### Java Backend (stigmer-service)

**`WorkflowPromptBuilder.java`** — Spring component mirroring Go's prompt.go. Loads task kind registry from classpath at startup, queries MongoDB repos (AgentRepo, McpServerRepo, SkillRepo, WorkflowRepo) for org-scoped resources, constructs identical prompt structure.

**`WorkflowYamlValidator.java`** — SnakeYAML-based structural validation. Checks YAML parseability, required top-level fields (apiVersion, kind, metadata, spec), spec structure (description, tasks array), and validates task kinds against the registry.

**`WorkflowGenerateFromPromptHandler.java`** — Extends `CustomOperationHandlerV2` with a standard pipeline (common steps → generate step). The generate step resolves the default model from `LlmProxyConfig` (Anthropic preferred, then OpenAI), calls `LlmCallService.chatCompletion()` for metered/billable execution, validates, and retries.

### TypeScript SDK

Added `generateFromPrompt(input)` method to `WorkflowClient` with `GenerateFromPromptInput` and `GenerateFromPromptResult` types. Exported from the SDK barrel.

### Key Design Choices

- **Server-side prompts**: Templates live on the server, enabling iteration without frontend deploys
- **Generate YAML, not proto**: YAML is the canonical authoring format — generated output is directly editable in the YAML editor (T10)
- **Validation-in-the-loop**: Reduces user-facing errors; catches malformed YAML and invalid task kinds before returning to the client
- **Org context injection**: LLM references real organizational resources in generated workflows

## Benefits

- Users can describe workflow intent in natural language and receive a valid, runnable YAML document
- Server-side prompt templates can be refined independently of client releases
- Structural validation catches most LLM errors before they reach the user
- Both OSS and Cloud editions support generation with identical prompting logic
- Org-aware generation produces workflows that reference real agents, skills, and MCP servers

## Impact

- **End users**: Dramatically lowers the barrier to creating workflows — no YAML knowledge required for initial drafts
- **Platform**: First AI-assisted creation feature; establishes patterns for refine (Batch 3) and diagnose (Batch 4)
- **Developer experience**: Prompt template changes don't require SDK or frontend deployments

## Related Work

- T04 (Task Schema Registry) — registry data embedded in prompts for task kind reference
- T10 (YAML Editor) — generated YAML can be opened directly in the editor for refinement
- T15 (Visual Canvas) — generated YAML can be visualized in the canvas editor
- T16 Batch 2 (next) — SDK hooks and dialog UI for invoking generation from the console

## Files Changed

### New Files (6)
- `backend/services/stigmer-server/pkg/llmclient/client.go`
- `backend/services/stigmer-server/pkg/llmclient/prompt.go`
- `backend/services/stigmer-server/pkg/domain/workflow/controller/generate_workflow.go`
- `stigmer-cloud: domain/agentic/workflow/generation/WorkflowPromptBuilder.java`
- `stigmer-cloud: domain/agentic/workflow/generation/WorkflowYamlValidator.java`
- `stigmer-cloud: domain/agentic/workflow/request/handler/WorkflowGenerateFromPromptHandler.java`

### Modified Files (18+)
- Proto definitions (2), generated stubs in Go/Java/TS/Python (12+), controller + server wiring (3), SDK client + barrel (2), BUILD.bazel (1)

---

**Status**: ✅ Production Ready (backend infrastructure — UI integration in Batch 2)
**Timeline**: Single session
