# Session 14: Phase 4 — Multi-Provider Model Support

**Date**: 2026-05-19  
**Duration**: ~20 minutes  
**Status**: Complete

## Accomplishments

- Created shared `llm-proxy.ts` module with provider inference, proxy URL resolution, and header construction
- Refactored `constructModel` in `setup.ts` to support both Anthropic and OpenAI models
- Fixed critical proxy routing bug — TS runner was passing raw `proxyEndpoint` without provider-specific path suffixes expected by `LlmProxyController`
- Added `X-Stigmer-Execution-Id` scope header to deep-agent LLM calls (Python parity)
- Fixed same proxy URL bug in `classify-tool-approvals.ts`
- Added 39 unit tests for the new llm-proxy module
- All 471 tests passing, TypeScript type check clean

## Key Decisions

1. **Provider inference from model name (prefix heuristics)** — Same approach as Python's `_infer_provider`. Synchronous, no registry dependency. Throws on unknown models rather than silently defaulting.

2. **Explicit prefix syntax** — Support `"openai:model-name"` or `"anthropic:model-name"` for edge cases where name heuristics fail.

3. **No factory class** — Simple functions composed by `constructModel`. A full abstract factory is premature for 2 providers. Adding Gemini later is one switch branch + one function.

4. **Gemini deferred** — Cloud proxy (`LlmProxyConfig`) only supports `openai` and `anthropic`. Gemini requires proxy-side changes in stigmer-cloud before TS runner support makes sense.

5. **Ollama deferred** — Local-only provider, deferred to a later phase per user decision.

## Discovery: Proxy Routing Bug

The existing TS runner code passed bare `STIGMER_PROXY_ENDPOINT` (e.g. `https://api.stigmer.ai`) as `baseURL` to `ChatAnthropic`. The Java `LlmProxyController` expects:
- Anthropic: `{proxy}/v1/proxy/llm/anthropic/v1/messages`
- OpenAI: `{proxy}/v1/proxy/llm/openai/v1/chat/completions`

This was a latent bug (not yet a prod issue since Python still handles native agents) that would have broken cloud deployment. Fixed for both providers.

## Files Created

| File | Purpose |
|------|---------|
| `src/shared/llm-proxy.ts` | `inferProvider`, `stripProviderPrefix`, `resolveProxyBaseUrl`, `buildProxyHeaders` |
| `src/shared/__tests__/llm-proxy.test.ts` | 39 unit tests |

## Files Modified

| File | Change |
|------|--------|
| `src/activities/execute-deep-agent/setup.ts` | Replaced single-provider `constructModel` with multi-provider dispatch; added `ChatOpenAI` import; added execution scope headers |
| `src/activities/classify-tool-approvals.ts` | Use `resolveProxyBaseUrl` + `buildProxyHeaders` instead of raw endpoint |
| `src/activities/__tests__/classify-tool-approvals.test.ts` | Updated assertion to expect correct proxy URL with suffix |

## Verification

- `createDeepAgent` accepts `ChatOpenAI` via `BaseLanguageModel | string` parameter type
- `deepagents` library's `cache_control` annotations are safe for non-Anthropic providers (designed as no-op)
- 471 tests pass, `tsc --noEmit` clean

## Next Session

Continue with remaining Phase 4 items:
- MCP package pre-installer
- Connect backfill for undiscovered/stale MCP servers
- Skill relevance filtering
- Remote workspace backend (Daytona sandbox)
