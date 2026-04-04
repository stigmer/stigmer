# ExecutionContext Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Cleaned up all proto comments in the ExecutionContext resource (`apis/ai/stigmer/agentic/executioncontext/v1/`) so that auto-generated SDK documentation surfaces proper, SDK-facing descriptions for every message, field, RPC, and service. Added a missing `docs/overview.md` for the SDK reference page overview section.

## Problem Statement

The ExecutionContext proto files had documentation that leaked internal implementation details into SDK-facing output. The SDK docs generator extracts the first sentence of each comment (stripping everything after `@internal`), but several comments lacked `@internal` markers, causing authorization models, FGA details, runner internals, and internal product names to flow into public SDK documentation.

### Pain Points

- Service comments on `ExecutionContextCommandController` and `ExecutionContextQueryController` contained full authorization/FGA model descriptions with no `@internal` separator
- Message comments on `ExecutionContext`, `ExecutionContextSpec`, and `ExecutionContextExecutionIdInput` mixed SDK-facing and internal content in the same paragraph
- Field comments used vague first sentences (e.g., "The actual value.") or included `Example:` blocks before `@internal`
- The `apply` RPC comment exposed authorization implementation details without `@internal`
- No `docs/overview.md` existed, leaving the SDK reference page without an overview section
- Internal product name "Plant & Cloud" appeared in a proto comment

## Solution

Applied the same documentation conventions used in the well-documented Agent resource: clean first sentences for SDK consumption, `@internal` markers before implementation details, and a `docs/overview.md` for the SDK reference page overview.

## Implementation Details

**Files modified** (5 proto files + 1 new markdown file):

- `v1/api.proto`: Rewrote `ExecutionContext` message comment and tightened `metadata`, `spec`, `status` field descriptions
- `v1/spec.proto`: Restructured `ExecutionContextSpec` and `ExecutionValue` message comments; moved examples and encryption details behind `@internal`; improved `value` field from "The actual value." to "String content of this entry."
- `v1/io.proto`: Added `@internal` to `ExecutionContextExecutionIdInput` message and `execution_id` field comments
- `v1/query.proto`: Added `@internal` to service comment; improved `getByExecutionId` first sentence
- `v1/command.proto`: Added `@internal` to service comment and `apply` RPC comment
- `docs/overview.md`: Created new file with 3-sentence description and representative YAML example

## Benefits

- SDK TypeTable rows now show clean, meaningful descriptions instead of internal implementation details
- RPC overview table shows concise verb-led summaries without authorization model leakage
- Internal details (FGA, runner behavior, encryption mechanics) remain available to proto readers behind `@internal`
- SDK reference page now has a proper overview section with a YAML example

## Impact

Affects the auto-generated SDK documentation for the ExecutionContext resource across TypeScript, Go, Python, and Java SDK references. No functional or behavioral changes to the API itself.

## Related Work

- Follows the same cleanup pattern applied to Agent, AgentInstance, AgentExecution, and Environment resources earlier in this branch
- Guided by the document writer role (`_roles/002_document_writer.md`) and the SDK docs generator extraction logic (`tools/codegen/generator/sdk_docs.go`)

---

**Status**: Production Ready
