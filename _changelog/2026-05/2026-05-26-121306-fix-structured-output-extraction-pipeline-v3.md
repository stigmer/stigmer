# Fix Structured Output Extraction Pipeline (Tier 1 + Tier 2)

**Date**: May 26, 2026

## Summary

Restored safe heuristic extraction in Tier 1 with end-first scanning, and fixed a provider routing mismatch in Tier 2 that caused 403 errors when Anthropic economy models were routed through the OpenAI proxy path. Together these two independent failures were compounding to silently drop structured output from every Cursor agent execution.

## Problem Statement

The `daily-notification-plan` workflow consistently failed with "Agent did not return structured output" despite the agent producing valid JSON in its response (verified via MongoDB inspection of the `agent_execution` document).

### Pain Points

- Tier 1 (`extractJsonFromText` in `extract-json.ts`) had been stripped to bare `JSON.parse` by commit `4380dcfca`, which removed code-fence and brace-matching heuristics. This broke the dominant Cursor agent response pattern: prose analysis followed by JSON output.
- Tier 2 (`extractStructuredOutput` in `execute-cursor/index.ts`) hardcoded `"openai"` as the proxy provider, but `getEconomyModel("claude-sonnet-4")` resolves to `claude-haiku-4.5` (Anthropic). The Anthropic model was sent to the OpenAI proxy endpoint and rejected with a 403.
- Six of eleven existing unit tests for `extractJsonFromText` were failing, confirming the Tier 1 regression was known but unaddressed.
- The compounding failure meant zero structured output extraction was succeeding for Cursor-harness agent calls.

## Solution

**Tier 1 — End-first heuristic extraction**: Restored code-fence and last-brace extraction with a key safety improvement over the previous implementation: scanning from the end of the text rather than the beginning. This aligns with the prompt injection contract that instructs the agent to put JSON as its "final response," ensuring the correct fragment is picked when multiple JSON objects exist.

**Tier 2 — Provider-aware LLM client**: Replaced the hardcoded `"openai"` provider with `inferProvider(extractionModel)`, constructing the correct LangChain client (`ChatAnthropic` or `ChatOpenAI`) with the matching proxy endpoint and client options shape. Follows the exact pattern already established in `call-llm.ts`.

## Implementation Details

### Tier 1: `extract-json.ts`

Three-tier extraction pipeline:

1. **Tier 1**: `JSON.parse` on full trimmed text (unchanged)
2. **Tier 1.5**: Code-fence extraction — regex matches ` ```json ``` ` and bare ` ``` ``` ` fences, iterates last-to-first, only attempts parse on content starting with `{` or `[` (skips SQL, YAML, etc.)
3. **Tier 1.75**: Last-brace extraction — backward scan from the last `}` to find the matching `{`, respecting nesting depth and string literals

Trailing-comma repair (`stripTrailingCommas`) is applied before every `JSON.parse` attempt across all tiers via a shared `tryParse` helper.

### Tier 2: `execute-cursor/index.ts`

- `inferProvider(extractionModel)` determines `"anthropic"` or `"openai"` from the model name
- `resolveProxyBaseUrl(proxyEndpoint, provider)` constructs the correct proxy path
- Anthropic models use `ChatAnthropic` with `clientOptions.baseURL`; OpenAI models use `ChatOpenAI` with `configuration.baseURL`
- API key resolution is provider-aware: `ANTHROPIC_API_KEY` for Anthropic, `OPENAI_API_KEY` for OpenAI

### Tests: `extract-json.test.ts`

- All 11 original tests pass (6 were previously failing)
- Added 3 new tests:
  - Multiple JSON objects in prose — verifies the **last** one is extracted
  - Trailing prose after JSON — verifies JSON is still found
  - Production failure pattern — prose ending with a bare JSON object (no code fence)

## Benefits

- Structured output extraction works for the dominant Cursor agent response pattern (prose + JSON)
- Tier 2 LLM fallback works for any provider's economy model, not just OpenAI
- End-first scanning reduces false positives from intermediate debug JSON fragments
- Layered safety net: fast heuristic (usually correct) → schema-aware LLM (always correct) → no silent wrong data propagation

## Impact

- All Cursor-harness agent executions requiring structured output are unblocked
- The `daily-notification-plan` workflow (and any workflow with `output.schema`) should now complete successfully
- No changes to protos, Java service, Go server, workflow engine validation, or callback mechanism

## Related Work

- `2026-05-25-232524-structured-output-cursor-path-fix.md` — Prior fix attempt that addressed Cursor-specific extraction path
- `2026-05-25-153147-structured-output-pipeline-test-suite.md` — Test suite that identified the 15 handoff points in the pipeline
- `2026-05-24-222528-fix-structured-output-pipeline-data-loss.md` — Earlier data loss fix in the pipeline

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
