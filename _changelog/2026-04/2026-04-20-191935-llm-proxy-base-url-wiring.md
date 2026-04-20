# Wire LLM Client Construction Through Side-Channel Proxy

**Date**: April 20, 2026

## Summary

Completed the runner-side LLM proxy wiring — the last functional gap between "proxy exists" and "proxy is used for LLM calls." All six LLM client construction paths in the agent-runner now route through the Side-Channel Proxy when `STIGMER_PROXY_ENDPOINT` is set, eliminating the need for provider API keys on the runner. Also fixed a pre-existing bug where `CheckpointerConfig` rejected the `http` type that prod kustomize already configures.

## Problem Statement

Phase 0 of the agent-runner-as-resource project built the Side-Channel Proxy (LLM passthrough, checkpointer REST API, artifact presigned URLs) and wired the checkpointer and artifact storage to use it. However, LLM calls — the highest-volume external traffic from the runner — still bypassed the proxy and went directly to provider APIs using API keys stored as runner env vars.

### Pain Points

- Runner still required `STIGMER_LLM_API_KEY` / `ANTHROPIC_API_KEY` env vars even though the proxy was designed to inject them server-side
- `llm_kwargs` construction (provider branching for `api_key` vs `base_url`) was duplicated verbatim in 4 separate files
- Sub-agent model overrides called `parse_model_string` without forwarding `**model_kwargs`, so sub-agents couldn't get proxy routing or even API keys in direct mode
- Summarization middleware directly constructed `ChatAnthropic` / `ChatOpenAI` without any `api_key` or `base_url`, relying on env vars that won't exist in proxy mode
- `CheckpointerConfig.validate()` only accepted `memory | sqlite | mongodb`, but prod kustomize sets `STIGMER_CHECKPOINTER_TYPE: http` — the runner would crash on startup
- Anthropic SDK sends `x-api-key` not `Authorization: Bearer`, so the proxy's Spring Security JWT validator wouldn't authenticate Anthropic-routed requests

## Solution

Centralize proxy-aware LLM kwargs construction in `LLMConfig.build_llm_kwargs()`, fix all six construction paths to use it, and add a custom `BearerTokenResolver` on the proxy to accept auth from both header conventions.

## Implementation Details

### Runner-side (stigmer, 7 files, +145/-135)

**`worker/config.py`** — three changes in one file:
- `LLMConfig.build_llm_kwargs(proxy_endpoint, proxy_auth_token)` — new method that returns the right `base_url` and `api_key` kwargs based on provider and deployment mode. Handles the OpenAI/Anthropic SDK `base_url` convention difference (OpenAI includes `/v1` in its base URL, Anthropic does not).
- `LLMConfig.validate(proxy_active=...)` — relaxed to skip `api_key` requirement when proxy is active. `Config.load_from_env()` detects proxy mode from `STIGMER_PROXY_ENDPOINT`.
- `CheckpointerConfig` — added `"http"` to valid types, `load_from_env()` now populates `proxy_endpoint` and `auth_token` from env vars for the `http` type, `validate()` enforces their presence.

**4 activity files** — replaced the duplicated 5-line `llm_kwargs` pattern with a single `build_llm_kwargs()` call:
- `worker/activities/graphton/setup.py` (main agent)
- `worker/activities/generate_session_subject.py` (session title generation)
- `worker/activities/classify_tool_approvals.py` (tool approval classification)
- `worker/activities/graphton/handlers/sub_agent.py` (sub-agent title generation)

**`graphton/core/agent.py`** — two fixes:
- Forward `**model_kwargs` to sub-agent string model override `parse_model_string` calls (pre-existing gap where sub-agents didn't inherit proxy routing or API keys)
- Pass `llm_kwargs=model_kwargs` to all three `ContextSummarizationMiddleware` creation sites (main agent, explicit sub-agents, general-purpose sub-agent)

**`graphton/core/summarization_middleware.py`** — replaced the three provider-specific back-door methods (`_create_anthropic_model`, `_create_openai_model`, `_create_ollama_model`) with a single `_create_summarization_model` that delegates to `parse_model_string` with the kwargs received via constructor injection.

### Proxy-side (stigmer-cloud, 1 file)

**`HttpSecurityConfig.java`** — added `resolveProxyBearerToken()` as a custom bearer token resolver. Extracts auth from both `Authorization: Bearer` (OpenAI SDK, httpx clients) and `x-api-key` (Anthropic SDK) headers. The proxy's Spring Security now authenticates requests from both SDKs transparently.

## Benefits

- **Runner is credential-free for LLM calls**: no `STIGMER_LLM_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` env vars needed when proxy is active
- **All 6 LLM construction paths route through proxy**: main agent, session title, tool classification, sub-agent title, sub-agent model overrides, summarization middleware
- **Duplicated code eliminated**: 4x5-line `llm_kwargs` blocks replaced with single centralized method
- **Pre-existing bugs fixed**: sub-agent kwargs gap and CheckpointerConfig `http` validation crash
- **Provider SDK auth handled transparently**: no per-provider workarounds on the client side

## Impact

- **agent-runner**: All LLM traffic can now route through `proxy.stigmer.ai` — the last infrastructure dependency removed from the runner
- **graphton library**: Remains proxy-unaware (kwargs flow through existing `**model_kwargs` path) — clean separation of concerns
- **stigmer-service**: Proxy security now handles both OpenAI and Anthropic SDK auth conventions

## Related Work

- Phase 0 proxy implementation: commits `0329220b` (stigmer-cloud) and `e690b95ff` (stigmer)
- Project: `_projects/2026-04/20260420.01.agent-runner-as-resource`

---

**Status**: Production Ready (pending Phase 0 deploy validation)
