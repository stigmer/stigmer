# Realign Runner Unit Test Suite with LangChain Streaming + Structured-Output Rework

**Date**: June 2, 2026

## Summary

The runner service's `npm test` suite had drifted out of sync with the production `call-llm` rework that moved completions to LangChain streaming (`model.stream()` → SSE) and structured output to `withStructuredOutput()` forced tool-calling. `make check` failed at the `test` target with **40 failed unit tests across 11 files**. This change brings the unit tests, fixtures, and mocks back in line with the intended behavior, fixes one genuine production fallback bug it surfaced, and makes the live Cursor smoke tests skip cleanly when no API key is present. The full runner suite now passes (**2240 passed, 6 skipped, 0 failures**).

## Problem Statement

The integration test suite had already been updated for the LangChain rework (see `_cursor/integration-test-triage-2026-06-02.md`), but the vitest unit tests still mocked the old direct-`fetch`, non-streaming JSON contract. As a result the unit suite was red on `HEAD` independently of any in-flight work, blocking `make check`.

### Pain Points

- **`call-llm` / eval / MCP-HITL deterministic replay (~24 tests)**: the replay interceptor returned a single non-streaming JSON body, but the source now streams (expects `text/event-stream`) for plain completions and uses forced tool-calling (expects `tool_use` blocks) for structured output. Results came back empty / `null` with zeroed token counts.
- **`http2-interceptor` (9 tests)**: `wrapSession` now calls `session.once("close", …)`, which the mock session didn't implement (`TypeError: session.once is not a function`).
- **`execute-deep-agent/index` (6 tests)**: the activity reads `Context.current()`, which throws "Activity context not initialized" outside a Temporal worker.
- **`approval-gate` (2 tests)**: `interrupt()` now also carries `tool_name` and `mcp_server_slug`, which the assertions didn't expect.
- **`model-registry` (1 test)**: the empty-registry economy fallback returned a hardcoded `gpt-4o-mini`, contradicting both the function docstring and the test (which expect the primary model).
- **`execute-serverless-workflow` (1 test)**: the `@temporalio/workflow` mock was missing the `ActivityFailure` export that `engine-core` unwraps.
- **3 Cursor smoke suites**: hard-failed with "CURSOR_API_KEY not set" during a keyless `make check` instead of skipping.

## Solution

Treat the reworked production behavior as the source of truth (it is already covered and validated by the integration suite) and realign the unit-level mocks/fixtures to it — rather than reverting the source. The one exception is `model-registry`, where the implementation contradicted its own documented contract and was corrected.

All provider mock formats (Anthropic + OpenAI, streaming text, streamed `tool_use`, and structured `invoke`) were validated against the installed LangChain v1 packages with throwaway harness scripts before being encoded into the mocks, so the SSE event sequences and token-usage extraction match a live provider exactly.

## Implementation Details

**Test infrastructure**

- `src/__test-utils__/replay-fetch.ts`: the replay interceptor now detects streaming requests (`stream: true`) and synthesizes the equivalent provider SSE event stream from the recorded logical body — Anthropic (`message_start` → `content_block_*` for both `text` and `tool_use` → `message_delta` with usage → `message_stop`) and OpenAI (`chat.completion.chunk` deltas + final `usage` chunk + `[DONE]`). Structured `invoke()` requests keep their JSON body unchanged.

**Fixtures** (faithful forced-tool-calling shape)

- `workflow-llm-structured`, `workflow-eval-passfail`, `workflow-eval-numeric`, `workflow-eval-warn`: converted text-with-embedded-JSON blocks to `tool_use` blocks (`name: "extract"`, `stop_reason: "tool_use"`), matching what Anthropic returns under `withStructuredOutput`.

**Production fix**

- `src/shared/model-registry.ts`: `getEconomyModel` now returns the **primary model** when the registry is empty/unavailable, instead of a hardcoded `gpt-4o-mini`. This matches the docstring ("fall back to the primary model itself") and avoids silently switching summarization to a possibly-unconfigured provider when the registry is down.

**Unit test updates**

- `call-llm.test.ts`: streaming mocks emit SSE; headers are read via the `Headers` API (LangChain passes a `Headers` instance, not a plain object); the structured-request assertion expects `response_format.type === "json_schema"`; the non-200 case uses `400` (non-retryable, fast) instead of `429` (SDK retries → timeout); the obsolete `parse_error` test was removed because that field is no longer produced and the invalid-JSON path inherently triggers slow SDK retries.
- `http2-interceptor.test.ts`: mock session implements `once`/`on`.
- `execute-deep-agent/index.test.ts`: mocks `@temporalio/activity` with a minimal `Context.current()` (cancellation signal + heartbeat).
- `approval-gate.test.ts`: assertions include `tool_name` and `mcp_server_slug`.
- `execute-serverless-workflow.test.ts`: adds `ActivityFailure` to the `@temporalio/workflow` mock.
- `cursor-sdk-auth-smoke`, `cursor-baseurl-routing`, `cursor-fetch-interceptor-bypass`: use `describe.skip` when `CURSOR_API_KEY` is unset so keyless CI shows them as skipped rather than failed.

## Benefits

- `make check` clears the `test` target again; runner unit suite: **2240 passed, 6 skipped, 0 failures** (was 40 failed / 2201 passed).
- The replay interceptor now models real streaming/tool-calling, so future deterministic fixtures don't need bespoke streaming bodies — they describe the logical response and the interceptor handles the transport shape.
- Keyless local/CI runs no longer hard-fail on live-only smoke tests.
- One real production fallback bug fixed (registry-down summarization no longer jumps providers).

## Impact

- **Runner test suite** only; no change to runtime behavior except the `model-registry` economy fallback. The `make check` targets from the previously-failing point onward (`test test-web test-desktop validate-demos check-deps`) were re-run and all pass.

## Related Work

- Builds on the integration-test realignment captured in `_cursor/integration-test-triage-2026-06-02.md` (LangChain streaming usage, forced tool-calling for eval, deep-agent text-extraction fallback).

---

**Status**: ✅ Production Ready
**Timeline**: Single session
