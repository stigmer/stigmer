# SDK Streaming How-to Guide

**Date**: April 4, 2026

## Summary

Added a hand-written Streaming how-to guide (`docs/sdk/streaming.mdx`) to the SDK Reference section, covering the production patterns developers need when consuming real-time Agent Execution and Workflow Execution updates across all four SDK languages.

## Problem Statement

The SDK documentation had streaming examples scattered across the Quickstart (minimal subscribe loop) and Connect Tools tutorial (approval handling in streams), plus auto-generated method stubs on the Agent Execution and Workflow Execution reference pages. There was no single place that covered the complete set of production patterns: phase-aware loops, error handling, cancellation, and the Workflow Execution API differences.

### Pain Points

- Developers had to piece together streaming knowledge from three different pages
- No guidance on handling transport-level stream errors vs execution-level failures
- No documentation of client-side cancellation (AbortSignal in TS, context in Go)
- The API asymmetry between AgentExecution subscribe (bare string ID) and WorkflowExecution subscribe (request object) was not called out anywhere
- No extracted helper pattern for checking terminal phases

## Solution

A dedicated Streaming how-to guide that covers the practical patterns not found elsewhere, with cross-references to existing coverage instead of duplicating content.

## Implementation Details

### New file: `docs/sdk/streaming.mdx`

Six focused sections, all using `SDKTabs` with TypeScript, Go, Python, and Java examples:

1. **Subscribe to an Agent Execution** — The complete, phase-aware subscribe loop that production code needs (vs the Quickstart's "grab first content and break" pattern)
2. **Read the snapshot** — Brief field orientation table pointing to the key `status` fields (phase, messages, error, pendingApprovals, todos, subAgentExecutions, artifacts, setupProgress), linking to the generated reference for full type tables
3. **Detect completion** — Terminal vs non-terminal phase tables with an extracted `isTerminal` helper function per language
4. **Handle stream errors** — Try/catch patterns separating transport errors from execution failures, with `isRetryable` checks
5. **Cancel a stream** — AbortSignal (TS), context cancellation (Go), iterator break (Python/Java), with a callout that stream cancellation does not cancel the execution
6. **Subscribe to a Workflow Execution** — Documents the API asymmetry (request object vs bare string), shows task-based progress tracking

### Modified file: `docs/sdk/meta.json`

Added `"streaming"` as the first page in the sidebar, followed by a `"---Resources---"` separator before the auto-generated resource pages.

## Benefits

- Single authoritative source for SDK streaming patterns
- Clear separation between how-to content and auto-generated reference
- Follows Diataxis how-to type strictly — no mixing with tutorial or reference content
- Cross-references to Quickstart, Connect Tools, and generated reference pages avoid duplication
- Sidebar now has visual separation between hand-written guides and auto-generated resource pages

## Impact

- SDK developers can find all streaming patterns in one place
- The SDK Reference section sidebar is better organized with the Resources separator
- Foundation laid for the React SDK page (next hand-written page to add above the separator)

## Related Work

- Session 7: SDK Overview landing page (`docs/sdk/index.mdx`)
- Sessions 1-6: Auto-generated SDK reference pages from proto schemas
- Quickstart: Basic subscribe loop
- Connect Tools: Approval handling in streams

---

**Status**: Production Ready
**Timeline**: Session 8 (2026-04-04)
