# Workflow Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Cleaned proto documentation across all 21 workflow proto files (core resource, task configs, and serverless validation) to match the agent resource quality standard. Added `@internal` markers to prevent internal implementation details from leaking into auto-generated SDK docs, created `docs/overview.md`, and regenerated all schemas and SDK docs.

## Problem Statement

The workflow resource had systemic documentation issues across its 21 proto files that directly affected the quality of auto-generated SDK documentation.

### Pain Points

- Internal terminology ("Zigflow DSL", "Planton", "Temporal") leaked into SDK-facing descriptions
- RPC comments exposed authorization implementation details to SDK users
- `WorkflowTaskKind` enum values had redundant name prefixes and leaked config format details
- Message-level comments contained JSON examples, backend unmarshalling details, and architecture notes without `@internal` markers
- No `docs/overview.md` existed for the workflow resource (agent had one)
- `ValidationState` enum values and `ServerlessWorkflowValidation` fields had verbose, run-on descriptions without clean first sentences

## Solution

Applied the `@internal` comment convention systematically across all three file groups (core protos, validation proto, task config protos), following the agent resource as the gold standard. Created `docs/overview.md` with a representative YAML example.

## Implementation Details

### Phase 1: Core Resource Protos (SDK-facing, highest impact)

- **api.proto**: Rewrote `Workflow` message description from vague "represents a workflow orchestration definition" to specific "defines a multi-step task orchestration with sequential, parallel, and conditional execution"; aligned field comments with agent pattern
- **spec.proto**: Added `@internal` to `WorkflowSpec`, `WorkflowDocument`, `WorkflowTask`, `Export`, `FlowControl`; removed "Zigflow DSL", "Planton", and "kind + Struct" pattern leaks from SDK-facing text
- **enum.proto**: Rewrote all 13 `WorkflowTaskKind` values to remove redundant `set_vars:` name prefixes and `Config: {...}` format details; moved naming conventions and config schema catalog behind `@internal`
- **command.proto**: Added `@internal` to `apply` and `create` RPCs to hide authorization details; fixed "Create a new workflow" to "Create a workflow"
- **query.proto**: Added resolution context to `getByReference` ("Resolves a human-readable reference like 'stigmer/deploy'...")
- **status.proto**: Restructured `serverless_workflow_validation` field to hide Temporal references behind `@internal`
- **overview.md**: Created with brief description and representative YAML showing workflow resource shape

### Phase 2: Validation Proto

- **serverless/validation.proto**: Hid Temporal references on message and field comments; cleaned all `ValidationState` enum values; fixed verbose field descriptions (`yaml`, `errors`, `warnings`, `validated_at`) to have proper period-terminated first sentences

### Phase 3: Task Config Protos (13 files)

- Added `@internal` before YAML examples and "Reference: zigflow-dsl-pattern-catalog.md" lines
- Rewrote first sentences to be clean standalone descriptions
- Hid Temporal implementation details (`listen`, `wait`, `run`, `call_activity`)
- Cleaned `@since` annotation on `agent_call.proto` context_management field

### Verification

Scanned generated `workflow.mdx` for internal terms ("Temporal", "Zigflow", "Planton", "synthesized_yaml", "kind + Struct") — zero matches found.

## Benefits

- SDK docs for the workflow resource now show clean, professional descriptions without internal implementation noise
- All 13 `WorkflowTaskKind` enum values display meaningful one-line descriptions instead of verbose config format dumps
- `ValidationState` enum and `ServerlessWorkflowValidation` fields no longer expose Temporal infrastructure details
- Consistent documentation quality across agent and workflow resources

## Impact

- **SDK consumers**: See clean, actionable descriptions when browsing workflow SDK reference docs
- **Proto source readers**: Internal implementation context is preserved behind `@internal` markers
- **SDK docs generator**: Properly extracts first-sentence summaries via `docFirstSentence(docStripInternal(...))`

## Related Work

- Agent proto documentation (gold standard reference)
- [SDK docs auto-generation POC](2026-04-03-185754-sdk-docs-auto-generation-poc.md)
- [Audience-aware proto comments](2026-04-03-201354-audience-aware-proto-comments-sdk-docs.md)
- [SDK docs enums and cross-page links](2026-04-04-110432-sdk-docs-enums-commons-and-cross-page-links.md)

---

**Status**: ✅ Production Ready
**Files Changed**: 21 proto files + 1 overview.md + regenerated schemas and SDK docs
