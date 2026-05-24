# Fix Structured Output Extraction Pipeline

**Date**: May 24, 2026

## Summary

Fixed the structured output extraction pipeline in ExecuteCursor that was silently failing due to a hardcoded model ID not present in the registry, causing workflow agent_call tasks to trigger expensive and futile retry loops.

## Problem Statement

When a workflow defines `output.schema` on an `agent_call` task, the Cursor harness extracts structured data from the agent's response. The extraction LLM fallback was broken because it passed a hardcoded model ID (`"claude-sonnet-4-20250514"`) that doesn't exist in the model registry, causing the extraction to throw, the catch to silently swallow it, and `structured_output` to be `undefined` — triggering retry loops that burned $3+ per task without ever succeeding.

### Pain Points

- Extraction LLM used a non-existent model ID, so `extractStructuredOutput` always threw
- Errors were silently swallowed by a `console.warn` — no visibility into root cause
- Hardcoded `ECONOMY_MODELS` map in model-registry.ts didn't use the registry's actual `costTier` field
- Regex-based extraction tier was brittle and rarely matched real agent responses
- `jsonSchemaToZodForExtraction` mixed `require()` and `await import()` causing ESM issues

## Solution

1. **Registry-based model resolution** — `getEconomyModel(primaryModel)` queries the registry for `costTier=economy` + same provider + `harness=native`, eliminating hardcoded model IDs
2. **Simplified extraction tiers** — removed brittle regex tier, kept JSON.parse fast-path + LLM `withStructuredOutput` (guaranteed schema-conformant via function-calling)
3. **Proper diagnostics** — replaced silent `console.warn` with `console.error` including execution ID, model, and failure details

## Implementation Details

### model-registry.ts

- Extended `RegistryModel` interface with `costTier` and `harness` fields
- Updated `parseRegistry` to extract those fields from the registry JSON
- Added `getEconomyModel(primaryModel)` with same-provider → cross-provider → fallback resolution
- `getSummarizationModel` now delegates to `getEconomyModel` (backward-compatible)

### execute-cursor/index.ts

- Removed regex extraction tier (`/```(?:json)?\s*\n?([\s\S]*?)\n?```/`)
- `extractStructuredOutput` now accepts `primaryModel` parameter and resolves via registry
- Fixed `jsonSchemaToZodForExtraction` to use `await import("zod")` instead of `require("zod")`
- Replaced silent `console.warn` with descriptive `console.error`

## Benefits

- Extraction actually works — economy model resolves to a valid registry ID
- ~$3+ saved per workflow run that previously looped on extraction failure
- Diagnostics surface extraction issues immediately instead of silent failure
- No more hardcoded model IDs that drift out of sync with the registry

## Impact

- All workflows using `output.schema` on `agent_call` tasks with Cursor harness
- `classify-tool-approvals.ts` (uses `getSummarizationModel`) — backward-compatible via delegation
- Model registry test suite updated to use new fields

---

**Status**: ✅ Production Ready
