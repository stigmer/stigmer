# Seedpack Workflow Apply Test Coverage Gap Fixed

**Date**: May 18, 2026

## Summary

Discovered and closed a critical test coverage gap where all three seedpack workflow YAMLs failed server-side `Apply` validation, but integration tests reported green because the only tests exercising the server path were silently skipped without LLM API keys. Added a new "Tier 1.5" test that calls the real server Apply API without LLM dependencies, and fixed three categories of validation errors in the seedpack workflow YAMLs.

## Problem Statement

Running `stigmer apply` on any seedpack workflow (e.g., `content-review-pipeline.yaml`) returned "Internal server error," but the integration test suite reported all tests passing.

### Pain Points

- **Parse-only tests (Tier 1)** in `seedpack_workflow_test.go` validated YAML-to-proto conversion locally but never contacted the server — they couldn't catch server-side validation failures
- **Full E2E tests (Tier 2)** in `workflow_seedpack_test.go` did call the server, but were gated behind `requireSeedpackPrereqs()` which skipped them when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` were absent or the workflow-runner wasn't running
- Go's `t.Skip()` doesn't cause test failures — skipped tests appear as "ok" in the output, creating a false sense of coverage
- No test existed that simply called `WorkflowCommand.Apply()` without also requiring LLM keys for execution

## Solution

### New test: `TestSeedpackWorkflow_ApplyAll`

Added a server-side apply test in `workflow_seedpack_test.go` that:
1. Loads each seedpack workflow YAML and parses it to a proto
2. Calls `WorkflowCommand.Apply()` against the real test server via gRPC
3. Asserts the apply succeeds and the server returns an ID
4. Cleans up via `WorkflowCommand.Delete()`
5. Is gated only on `grpcConn != nil` — no LLM keys, no workflow runner needed

This runs in every integration suite execution, catching server-side validation failures that parse tests miss.

### Seedpack YAML fixes (all three workflows)

Three categories of validation errors were found and fixed:

1. **Missing `timeout` and `max_retries` on `llm_call` tasks** — server requires `timeout` (1-600) and `max_retries` (1-5) but they defaulted to 0 when omitted
2. **Invalid `engine` enum value on `transform` tasks** — `engine: jq` is not a valid proto enum; changed to `engine: TRANSFORM_ENGINE_JQ`
3. **Invalid `input` type on `transform` tasks** — `input` is a `string` field in the proto (a single expression), not a YAML map; restructured all transform tasks to use a single `input` expression with JQ dot-notation

## Implementation Details

### Files changed

- `test/integration/workflow_seedpack_test.go` — added `TestSeedpackWorkflow_ApplyAll` test function and `workflowv1` import
- `seedpack/workflows/content-review-pipeline.yaml` — added timeout/max_retries to llm_call tasks, fixed transform engine enum and input format
- `seedpack/workflows/support-ticket-triage.yaml` — added max_tokens/timeout to llm_call task, fixed transform engine enum and input format
- `seedpack/workflows/research-and-summarize.yaml` — added timeout/max_retries/max_tokens to llm_call tasks (including nested fork branches), fixed transform engine enum and input format

### Test tier architecture

| Tier | Test | Server contact | LLM keys needed | Always runs |
|------|------|----------------|-----------------|-------------|
| 1 | `Parse_*`, `StrictParse`, `LoadAll` | No | No | Yes |
| 1.5 | **`ApplyAll` (new)** | **Yes** | **No** | **Yes** |
| 2 | E2E (`ContentReviewPipeline`, etc.) | Yes | Yes | No (skipped) |

## Benefits

- Server-side apply failures are now caught in the offline (no API keys) test suite
- Validation errors surface with actionable messages (e.g., "field 'timeout' must be >= 1") instead of opaque "Internal server error"
- Seedpack workflows are now confirmed deployable, not just parseable
- Future seedpack YAML changes that break server apply will fail the test immediately

## Impact

- **Integration test suite**: One new always-on test covering all seedpack workflow apply operations
- **Seedpack workflows**: All three workflows now pass server-side validation and can be applied via `stigmer apply`
- **Developer experience**: `stigmer apply` on seedpack workflows works correctly again

## Related Work

- Prior session fixed 49 integration test failures (commit `88cdb4a5b`)
- Seedpack workflow E2E tests were added in `workflow_seedpack_test.go` but only ran with LLM keys

---

**Status**: Production Ready
