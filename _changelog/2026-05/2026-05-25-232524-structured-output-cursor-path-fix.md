# Structured Output Pipeline -- Cursor Path Fix & Native Path Cleanup

**Date**: May 25, 2026

## Summary

Fixed the Cursor harness structured output extraction pipeline (23/23 provider tests pass) and cleaned up the broken Native path extraction hack. Created a tracked project for the v3 streaming migration that will properly fix the Native path.

## Problem Statement

The structured output extraction was completely non-functional across both execution paths. The previous session added a three-layer fallback hack to the Native path (stream capture, getState, text parsing) -- all three layers were based on incorrect assumptions about how `createDeepAgent` works internally.

### Pain Points

- Native path: `structuredResponse` is an `UntrackedValue` in deepagents, invisible via v2 `streamEvents()` and stripped from checkpoints. The hack was dead code with false confidence.
- Cursor path: extraction code existed but had infrastructure bugs -- missing `apiKey` for proxy mode, economy model fallback returning invalid model name `"default"` when registry unavailable.
- `extractJsonFromText` used heuristic code-fence and brace-matching tiers that could silently return wrong data when responses contained multiple JSON fragments.

## Solution

Two-track approach:

1. **Cursor path (fixed now)**: Verified and fixed the extraction pipeline. Simplified text extraction to safe-only Tier 1 (JSON.parse + trailing-comma repair). Fixed Tier 2 LLM extraction infrastructure (economy model fallback, proxy apiKey).
2. **Native path (tracked for v3)**: Reverted the dead three-layer hack. Added clear log message. Created `_projects/2026-05/20260525.01.v3-streaming-migration/` project to properly fix via v3 streaming API.

## Implementation Details

### extract-json.ts (simplified)
- Removed Tiers 1.5 (code-fence scanning) and 1.75 (brace heuristic) -- these produce silent wrong data with multiple JSON fragments
- Kept Tier 1: `JSON.parse` on full trimmed text
- Added trailing-comma repair (common LLM quirk): `json.replace(/,\s*([}\]])/g, "$1")`

### model-registry.ts (economy model fallback)
- Added `FALLBACK_ECONOMY_MODEL = "gpt-4o-mini"` -- used when model registry fetch fails (401 in local/integration environments)
- Previously returned `primaryModel` which was `"default"` -- an invalid OpenAI model name

### execute-cursor/index.ts (proxy apiKey)
- Added `apiKey: config.stigmerToken ?? process.env.OPENAI_API_KEY ?? "proxy-managed"` to the `ChatOpenAI` constructor for Tier 2 extraction
- Without this, proxy mode failed with "Missing credentials"

### streaming.ts + index.ts (Native path cleanup)
- Removed `structuredResponse` from `StreamResult` interface
- Removed `capturedStructuredResponse` variable and `on_chain_end` / `on_chat_model_end` event capture handlers
- Removed `extractStructuredFromMessages()` function and three-layer fallback block
- Added clear log: "Structured output requested but not available via v2 streaming"

## Benefits

- Cursor path structured output fully functional (23/23 tests pass with real API keys)
- No more dead code in the streaming loop creating false confidence
- No more heuristic JSON extraction that could return wrong data silently
- Clear architectural path forward (v3 migration project with detailed technical plan)
- Economy model fallback ensures Tier 2 LLM extraction works in all environments

## Impact

- **Customer demos**: Cursor path structured output works end-to-end for the `daily-notification-plan` workflow and similar structured-output workflows
- **Native path**: Temporarily unsupported for structured output (clear error message). Tracked by v3 migration project.
- **Test infrastructure**: Provider tests properly exercise Cursor extraction with real API keys

---

**Status**: Production Ready (Cursor path)
**Timeline**: Single session
