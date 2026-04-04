# WorkflowExecution Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Restructured all proto comments in the workflowexecution resource to follow the `@internal` boundary convention established by the agent resource. Created the missing `overview.md` for the SDK docs generator. Removed decorative dividers and markdown headers from proto comments. Fixed first sentences that leaked internal terminology (HITL phase references, Temporal engine name) into SDK-facing documentation.

## Problem Statement

The workflowexecution proto files contained extensive, well-written comments that mixed SDK-facing descriptions with internal implementation details. Because none of the comments used `@internal` markers, the SDK docs generator could not distinguish between public and internal content. Additionally, several first sentences — the only content extracted for message/field/enum descriptions — contained internal jargon that SDK users should not see.

### Pain Points

- First sentences exposed internal terminology: "HITL Phase 1", "HITL Phase 5.3", "Temporal workflow ID"
- No `@internal` markers on any message, field, or enum comment across 5 proto files
- Decorative dividers (`─────`) and markdown headers (`## Section`) violated documentation standards
- The `workflow-execution.mdx` SDK page had no overview section because `docs/overview.md` did not exist
- The `temporal_workflow_id` field exposed implementation engine details in its SDK-facing description

## Solution

Applied the `@internal` boundary pattern used in the agent resource, plus targeted first-sentence rewrites:

1. **First sentence** (SDK-facing): concise, standalone, free of internal jargon
2. **`@internal`**: everything after this marker is stripped from generated SDK docs
3. **Internal content**: preserved below `@internal` for proto readers (not deleted)
4. **Decorative dividers and markdown headers**: removed entirely or moved behind `@internal`

## Implementation Details

### Files modified

- `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto` — WorkflowExecution, WorkflowExecutionStatus, WorkflowTask, WorkflowPendingApproval messages and all fields (4 messages, ~20 fields)
- `apis/ai/stigmer/agentic/workflowexecution/v1/spec.proto` — WorkflowExecutionSpec message and all 7 fields, including condensing ~60 lines of Temporal callback_token detail behind `@internal`
- `apis/ai/stigmer/agentic/workflowexecution/v1/enum.proto` — ExecutionPhase (7 values), WorkflowTaskType (7 values), WorkflowTaskStatus (6 values) enums and all values
- `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto` — 14 messages and their fields: ID wrappers, list request/response, update/approval inputs, subscribe, lifecycle control (cancel, terminate, recover, pause, resume), signal delivery
- `apis/ai/stigmer/agentic/workflowexecution/v1/command.proto` — update/delete RPC first sentences improved, 52 markdown headers converted to plain text, 2 decorative divider blocks removed

### New file

- `apis/ai/stigmer/agentic/workflowexecution/docs/overview.md` — brief overview + representative YAML example, matching the agent resource pattern

### First sentences rewritten

- `pending_approvals`: removed "(HITL)" acronym
- `temporal_workflow_id`: changed from "Temporal workflow ID" to "Correlation ID for the underlying workflow engine"
- `WORKFLOW_TASK_WAITING_APPROVAL`: changed from "(HITL Phase 1)" to "human approval from a child agent execution"
- `submitApproval` RPC: changed from "(HITL Phase 5.3)" to "an approval decision"
- `update` RPC: changed from "Update execution with full state" to "Update an existing workflow execution with full state"
- `delete` RPC: changed from "Delete an execution" to "Delete a workflow execution"

### Key decisions

- **No information deleted**: all verbose content was relocated behind `@internal`, preserving it for internal proto readers
- **Temporal reference hidden from SDK**: the `temporal_workflow_id` field now uses "Correlation ID for the underlying workflow engine" as its SDK-facing sentence, with Temporal-specific details behind `@internal`
- **Markdown headers in RPCs converted**: 52 `// ## Section` headers in command.proto were converted to plain text (`// Section:`) to comply with documentation standards, even within `@internal` sections

## Benefits

- SDK reference pages show clean, scannable descriptions instead of implementation dumps
- Internal terminology no longer leaks into auto-generated SDK documentation
- Net reduction of 1,290 lines across 5 proto files (352 insertions, 1,642 deletions) — all from removing redundancy in SDK-facing content, not from deleting internal documentation
- Consistent with agent resource quality standard
- `overview.md` now feeds the SDK page's opening section

## Impact

- **SDK users**: cleaner, more professional reference documentation for the WorkflowExecution resource
- **Proto maintainers**: clear `@internal` convention to follow when adding new comments
- **Docs pipeline**: `overview.md` now feeds the SDK page's opening section

## Related Work

- Prior sessions cleaned up agent, agentexecution, agentinstance, environment, executioncontext, session, skill, mcpserver, workflow, workflowinstance, commons, iam, identity-account, identity-provider, api-key, platform/github, and tenancy protos
- Part of the broader `feat/sdk-docs-auto-generation-improvements` branch

---

**Status**: Production Ready
