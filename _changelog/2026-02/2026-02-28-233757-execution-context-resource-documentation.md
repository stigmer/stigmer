# ExecutionContext Resource Documentation

**Date**: February 28, 2026

## Summary

Added comprehensive documentation for the `ExecutionContext` agentic resource — covering proto-level schema reference, lifecycle, authorization model, and a product-level "what-is" document. ExecutionContext is the ephemeral, operator-managed secret bundle the execution engine creates at the start of every run and destroys at the end, bridging the gap between persistent Environments and the decrypted runtime values that agent and workflow runners need.

## Problem Statement

ExecutionContext is one of the least visible but most critical resources in the Stigmer execution pipeline. It is the merge point for all referenced Environments, the carrier of B2B runtime-injected secrets, and the only place in the system where decrypted secret values are made available (exclusively to runners via `getByExecutionId`). Without documentation, its role, lifecycle, and relationship to Environment are opaque to new team members and integration partners.

### Pain Points

- No documentation explaining what ExecutionContext is, why it is operator-only, or how it fits into the Environment → AgentInstance → AgentExecution pipeline
- No schema reference for `ExecutionContextSpec`, `ExecutionValue`, and the IO types (`ExecutionContextId`, `ExecutionContextExecutionIdInput`)
- No explanation of the B2B runtime injection use case or why secrets must not persist beyond execution end
- No product-level document to link from what-is-environment and what-is-agent-execution
- The `getByExecutionId` RPC — the primary runner lookup path — was undocumented, leaving its significance and security model unexplained

## Solution

Created a three-file proto-level docs folder (`apis/ai/stigmer/agentic/executioncontext/docs/`) following the same structure used by Environment and AgentInstance, plus a product-level what-is document (`docs/product/what-is-execution-context.md`) following the style established by `what-is-agent-execution.md` and `what-is-environment.md`.

## Implementation Details

### Proto-Level Docs (`apis/ai/stigmer/agentic/executioncontext/docs/`)

**`README.md`**
- What is an ExecutionContext (one-paragraph definition)
- Pipeline diagram: `Environment A + B + runtime secrets → merge → ExecutionContext → runner sandbox`
- Comparison table: Environment (persistent, user-managed) vs. ExecutionContext (ephemeral, operator-managed)
- Key capabilities: ephemeral by design, tied to one execution, B2B runtime injection, operator-only access
- Documentation index and proto source file table

**`execution-context-resource-guide.md`**
- Top-level field table (`apiVersion`, `kind`, `metadata`, `spec`, `status`)
- Metadata field table with notes on operator-managed nature
- `ExecutionContextSpec` field table: `execution_id` (required, non-empty) and `data`
- `ExecutionValue` field table: `value` (required, non-empty) and `is_secret`
- Secret vs. non-secret comparison table (including the ephemeral deletion behavior for both)
- Full authorization model: every operation (`apply`, `create`, `delete`, `get`, `getByReference`, `getByExecutionId`) requires platform-level operator permission, with an explanation of *why* (`getByExecutionId` returns decrypted values)
- Full lifecycle diagram: execution start → env resolution → merge → create → runner lookup → execution end → delete
- Side-by-side comparison table with Environment on 10 dimensions

**`examples.md`**
- Minimal single non-secret value
- Single secret value
- Mixed secrets and plain config
- B2B runtime injection (Planton integration pattern)
- Merged result from multiple Environments (showing left-to-right override behavior)
- WorkflowExecution context (`execution_id` from a `wex_` ID)
- Runner lookup pseudocode (`getByExecutionId` pattern)
- Full-featured example with labels, annotations, and tags

### Product-Level Doc (`docs/product/what-is-execution-context.md`)

Follows the exact structure of `what-is-agent-execution.md` and `what-is-environment.md`:

- **One-Sentence Positioning**: process-lifetime analogy — the merged secret bundle exists only while the execution is running
- **Executive Summary**: where it fits in the data flow; the two distinguishing properties (ephemeral + runner-decrypted)
- **The Problem It Solves**: two distinct problems — (1) runners need a single merged map, not multiple per-Environment lookups with custom merge logic; (2) B2B runtime-injected secrets need an ephemeral home that doesn't persist in the execution record
- **The Resource**: annotated YAML spec and status examples with field tables; notes the intentional absence of `description` per value (unlike `EnvironmentValue`)
- **Lifecycle**: full diagram from execution start through merge → create → runner lookup → end → delete
- **How Runners Use It**: pseudocode for the `getByExecutionId` call pattern; explains why it is the singular decryption point in the system
- **ExecutionContext vs. Environment**: 10-row comparison table
- **What You See as a User**: bridges to `status.resolved_context.environment_keys` on AgentExecution so the doc is not a dead end for users who cannot read the resource directly
- **How It Compares**: before/after table on 5 dimensions
- **Further Reading**: links to Environment, AgentInstance, AgentExecution what-is docs and the new proto-level docs

## Benefits

- New team members and integration partners can understand ExecutionContext's role, lifecycle, and relationship to Environment without reading proto files
- The B2B runtime injection use case (Planton and similar) is now documented with an example
- The operator-only authorization model and its security rationale (`getByExecutionId` is the only decryption point) are clearly explained
- `status.resolved_context.environment_keys` on AgentExecution is connected back to ExecutionContext, completing the user-visible audit trail story

## Impact

- **Docs consumers**: engineers onboarding to the Stigmer codebase, integration partners building B2B workflows, and support staff investigating execution failures
- **Cross-references**: `what-is-execution-context.md` is linked from `what-is-environment.md` (Further Reading), `what-is-agent-execution.md` (Further Reading), and the proto docs link back to the product doc
- **Coverage**: fills the last major gap in the agentic resource documentation set — Agent, AgentInstance, Environment, AgentExecution, and now ExecutionContext are all documented at both proto and product levels

## Related Work

- [`2026-02-28-233537-environment-resource-documentation.md`](./2026-02-28-233537-environment-resource-documentation.md) — Environment and AgentInstance proto-level docs and what-is docs created in the same batch
- `apis/ai/stigmer/agentic/agentexecution/docs/` — AgentExecution proto-level docs (existing, established the pattern)
- `docs/product/what-is-agent-execution.md` — Primary structural template for the what-is format

---

**Status**: ✅ Production Ready
**Files created**: 4 (3 proto-level docs + 1 product what-is doc)
