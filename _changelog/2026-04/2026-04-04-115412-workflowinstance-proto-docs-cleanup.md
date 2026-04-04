# WorkflowInstance Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Restructured all proto comments in the workflowinstance resource to follow the `@internal` boundary convention established by the agent resource. Added the missing `overview.md` for the SDK docs generator. Internal details (authorization, validation, design philosophy) no longer leak into auto-generated SDK documentation.

## Problem Statement

The workflowinstance proto files contained verbose, well-intentioned comments that mixed SDK-facing descriptions with internal implementation details. Because none of the comments used `@internal` markers, the SDK docs generator included authorization policies, validation rules, pagination flow examples, cascading delete semantics, and design philosophy directly in the public SDK documentation pages.

### Pain Points

- SDK users saw authorization error codes, FGA query details, and field validation rules they had no use for
- Method descriptions in the SDK reference table ran to full paragraphs instead of one-line summaries
- Field descriptions in TypeTable cells contained bullet lists, examples, and layering behavior that overwhelmed the actual type information
- The `workflow-instance.mdx` page had no overview section because the `overview.md` file did not exist

## Solution

Applied the same `@internal` boundary pattern used in the agent resource:

1. **First sentence** (SDK-facing): concise, standalone, works in a table row
2. **Optional elaboration** (SDK-facing): 0-2 additional sentences for methods that need context
3. **`@internal`**: everything after this marker is stripped from generated docs
4. **Internal content**: authorization, validation, implementation notes — preserved for proto readers

## Implementation Details

### Files modified

- `apis/ai/stigmer/agentic/workflowinstance/v1/api.proto` — WorkflowInstance message + 5 fields
- `apis/ai/stigmer/agentic/workflowinstance/v1/spec.proto` — WorkflowInstanceSpec message + 3 fields
- `apis/ai/stigmer/agentic/workflowinstance/v1/io.proto` — 3 messages (WorkflowInstanceId, GetWorkflowInstancesByWorkflowRequest, WorkflowInstanceList) + 5 fields
- `apis/ai/stigmer/agentic/workflowinstance/v1/query.proto` — service comment + 3 RPCs (get, getByWorkflow, getByReference)
- `apis/ai/stigmer/agentic/workflowinstance/v1/command.proto` — service comment + 4 RPCs (apply, create, update, delete)

### New file

- `apis/ai/stigmer/agentic/workflowinstance/docs/overview.md` — 2-sentence overview + representative YAML example, matching the agent pattern

### Regenerated artifacts

- `tools/codegen/schemas/agentic/workflowinstance/workflowinstance.json` — updated descriptions with `@internal` markers
- `tools/codegen/schemas/services/workflowinstance.json` — updated service/method descriptions
- `docs/sdk/workflow-instance.mdx` — now includes overview, clean method table, and tight field descriptions

### Key decisions

- **No information deleted**: all verbose content was relocated behind `@internal`, preserving it for internal proto readers
- **Environment layering note kept SDK-facing**: the `environment_refs` field retains "Environments are merged in declaration order — later entries override earlier ones when keys conflict" before `@internal` because SDK users need this to understand the field's behavior
- **No enums to document**: the workflowinstance resource defines zero enum types, so that part of the scope was not applicable

## Benefits

- SDK reference pages show clean, scannable descriptions instead of implementation dumps
- Method overview table has one-line descriptions that fit table cells
- Field descriptions in TypeTable are concise and useful
- Internal documentation preserved for developers reading proto source
- Consistent with agent resource quality standard

## Impact

- **SDK users**: cleaner, more professional reference documentation for the WorkflowInstance resource
- **Proto maintainers**: clear `@internal` convention to follow when adding new comments
- **Docs pipeline**: `overview.md` now feeds the SDK page's opening section

## Related Work

- Prior sessions cleaned up agent, agentexecution, agentinstance, environment, executioncontext, session, skill, and mcpserver protos
- Part of the broader `feat/sdk-docs-auto-generation-improvements` branch

---

**Status**: Production Ready
