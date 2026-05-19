# Multi-Provider Model Support for Unified TS Runner

**Date**: May 19, 2026

## Summary

Added OpenAI model support to the unified TypeScript runner's ExecuteDeepAgent activity and fixed a latent proxy routing bug that would have broken cloud deployment for all LLM calls. The runner now supports both Anthropic and OpenAI models via the cloud proxy with correct provider-specific routing paths.

## Problem Statement

The unified TS runner's `constructModel` function had two issues blocking production readiness:

1. **Proxy routing was broken** — LLM calls passed bare `STIGMER_PROXY_ENDPOINT` as `baseURL` without the `/v1/proxy/llm/{provider}` path suffix that `LlmProxyController` expects. Anthropic calls would hit `https://api.stigmer.ai/v1/messages` instead of `https://api.stigmer.ai/v1/proxy/llm/anthropic/v1/messages`.

2. **OpenAI models were blocked** — Models with `gpt`/`o1`/`o3` prefixes threw an explicit "deferred to Phase 4" error, preventing multi-model executions.

### Pain Points

- Cannot run agents with OpenAI models (GPT-4.1, o3-mini, etc.) on the native harness
- Cloud deployment would fail silently when proxy can't route LLM requests
- No `X-Stigmer-Execution-Id` scope header for billing attribution on deep-agent calls
- `classify-tool-approvals.ts` had the same proxy URL bug

## Solution

Created a shared `llm-proxy.ts` module that centralizes provider inference, proxy URL resolution, and header construction. Refactored model construction to dispatch to provider-specific builders based on model name prefix heuristics.

## Implementation Details

**New module: `src/shared/llm-proxy.ts`**
- `inferProvider(modelName)` — Infers provider from name prefixes (`claude*` → anthropic, `gpt*/o1*/o3*/o4*` → openai) with explicit prefix syntax (`"openai:model-name"`) for edge cases
- `stripProviderPrefix(modelName)` — Extracts the API model ID from explicit prefix syntax
- `resolveProxyBaseUrl(proxyEndpoint, provider)` — Constructs provider-specific proxy paths matching Python's `build_llm_kwargs` pattern
- `buildProxyHeaders(token, options?)` — Constructs Authorization + scope headers (`X-Stigmer-Execution-Id`, `X-Stigmer-Mcp-Server-Id`)

**Refactored `constructModel` in `setup.ts`**:
- Multi-provider dispatch: `inferProvider` → switch → `buildAnthropicModel` / `buildOpenAIModel`
- Each builder constructs the appropriate LangChain class with correct proxy URL and headers
- Removed the Phase 4 deferred error

**Fixed `classify-tool-approvals.ts`**:
- Uses `resolveProxyBaseUrl` instead of passing raw `proxyEndpoint`
- Uses `buildProxyHeaders` for consistent header construction

## Benefits

- OpenAI models (GPT-4.1, o3-mini, o1-preview) now work for deep-agent executions
- Proxy routing is correct for both providers — ready for cloud deployment
- Billing attribution via `X-Stigmer-Execution-Id` header (Python parity)
- Shared utility eliminates duplication between activities
- Adding future providers (Gemini) requires only one switch branch + one function

## Impact

- **Runner service**: ExecuteDeepAgent now supports all models in the native harness registry (both Anthropic and OpenAI providers)
- **Cloud readiness**: LLM proxy routing fixed before production deployment catches the bug
- **Test coverage**: 39 new unit tests; 471 total tests passing

## Related Work

- [Unified Runner Phase 3a](2026-05-19-154517-unified-runner-phase3a-execute-deep-agent-skeleton.md) — Original `constructModel` implementation
- [Classify Tool Approvals Port](2026-05-19-204647-classify-tool-approvals-activity-port.md) — Activity that already used `@langchain/openai`
- [Unified Model Registry](2026-05-01-183214-unified-model-registry.md) — Registry that maps model names to providers/pricing

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (~20 minutes)
