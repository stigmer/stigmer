# Fix Structured Output Extraction Pipeline (v2)

**Date**: May 24, 2026

## Summary

Fixed the structured output extraction pipeline that was silently failing
on every `agent_call` task with `output.schema`. Two root causes: (1) the
code-fence extraction tier was removed in the prior fix, leaving no way to
extract JSON from the most common agent response format (prose + markdown
code fences); (2) the JSON Schema to Zod converter used `.optional()`
instead of `.nullable()` for non-required fields, which OpenAI's structured
output API rejects.

## Root Causes

### 1. Missing code-fence extraction tier

The prior fix removed the regex-based code-fence extraction
(`/```(?:json)?\s*\n?([\s\S]*?)\n?```/`) calling it "brittle". This left
only two tiers: `JSON.parse(fullText)` and LLM `withStructuredOutput`.
Agents naturally wrap JSON in prose and markdown fences, so `JSON.parse`
fails and the pipeline falls through to the LLM tier.

### 2. Zod `.optional()` incompatible with OpenAI structured output

`_convertJsonSchemaToZod` marked non-required JSON Schema fields with
`.optional()`. OpenAI's structured output API requires all fields to be
present (required); optional semantics must use `.nullable()` (value can
be null). LangChain's `withStructuredOutput` rejected the schema before
making any API call:

```
Zod field at `#/definitions/extract/properties/anomalies/items/properties/metric`
uses `.optional()` without `.nullable()` which is not supported by the API.
```

### 3. Zod converter duplicated in three files

The converter existed as three independent copies that could drift:
- `execute-cursor/index.ts` — `_convertJsonSchemaToZod`
- `call-llm.ts` — `jsonSchemaToZod`
- `execute-deep-agent/setup.ts` — `jsonSchemaToZod`

All three had the same `.optional()` bug.

## Solution

### Consolidated Zod converter (`shared/json-schema-to-zod.ts`)

- Extracted into a single shared module imported by all three consumers
- Changed `.optional()` to `.nullable()` for non-required fields
- Preserves support for string enums, nested objects, arrays, null type

### Robust JSON extraction (`shared/extract-json.ts`)

New extraction utility with three tiers:
1. `JSON.parse(fullText)` — pure JSON responses
2. Code-fence extraction — finds all ``` blocks, tries JSON.parse on each
3. Heuristic brace extraction — finds outermost `{...}` pair, tries parse

### Updated ExecuteCursor extraction pipeline

- Tiers 1 + 1.5 use `extractJsonFromText` (free, instant)
- Tier 2 (LLM `withStructuredOutput`) only runs when text extraction fails
- Diagnostic logging at each tier for immediate failure visibility

## Test Coverage Added

- `shared/__tests__/json-schema-to-zod.test.ts` — 17 tests covering type
  mapping, nested schemas, and OpenAI `.nullable()` compatibility
- `shared/__tests__/extract-json.test.ts` — 11 tests covering pure JSON,
  code-fenced, heuristic extraction, multi-fence, and failure cases
- Tests use the exact schema and response from the production failure

## Impact

- All workflows using `output.schema` on `agent_call` tasks (Cursor and
  native harness)
- `call:llm` tasks with `response_schema`
- Zero behavioral change for schemas where all fields are required
