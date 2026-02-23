# Connect Model Configuration Pipeline

**Date**: February 24, 2026

## Summary

Fixed a critical architectural flaw where `execute_graphton.py` was directly instantiating LLM models, bypassing the entire model configuration pipeline. This disconnected production from model registry defaults (`max_tokens=20000`), native extended thinking, and adaptive thinking for Claude Opus 4.6 — causing the Opus 4.6 echo behavior and leaving the Phase 2 native thinking pipeline unused.

## Problem Statement

Claude Opus 4.6 was echoing all file contents after reading them via the `read` tool. Investigation revealed this was not a prompt engineering issue but a fundamental pipeline disconnect.

### Pain Points

- `execute_graphton.py` created bare `ChatAnthropic(model=..., api_key=...)` instances directly, bypassing `parse_model_string()` entirely
- `ANTHROPIC_DEFAULTS` (notably `max_tokens=20000`) were never applied to any Anthropic model in production
- The entire Phase 2 native thinking pipeline (StatusBuilder translation, CLI streaming) was built but dormant — `has_native_thinking` always evaluated to `False` because model instances lacked `thinking` configuration
- Claude Opus 4.6 lacked adaptive thinking support (`type: "adaptive"` with `effort` parameter), causing it to dump all reasoning into response text
- The explicit think tool was incorrectly injected for all models, even those capable of native thinking

## Solution

Two interconnected changes that connect existing plumbing without adding new abstractions:

1. **Route model creation through `parse_model_string()`** — replace direct model instantiation with passing the model name as a string to `create_deep_agent()`, which internally calls `parse_model_string()` to apply registry defaults and thinking configuration
2. **Add adaptive thinking for Opus 4.6** — new `supports_adaptive_thinking` field in `ModelMetadata` and corresponding configuration branch in `parse_model_string()`

## Implementation Details

### Model Registry (`model_registry.py`)

- Added `supports_adaptive_thinking: bool = False` to `ModelMetadata` dataclass, alongside the existing `supports_thinking` field
- Set `supports_adaptive_thinking=True` for `claude-opus-4.6`
- The two flags are mutually exclusive: `supports_thinking` is for manual mode (`type: "enabled"`, `budget_tokens`), `supports_adaptive_thinking` is for adaptive mode (`type: "adaptive"`, `effort`)

### Model Parser (`models.py`)

- Added `DEFAULT_THINKING_EFFORT = "medium"` constant
- Added `elif metadata.supports_adaptive_thinking` branch after the existing manual thinking block: auto-enables `thinking={"type": "adaptive", "effort": "medium"}` with temperature/top_k stripping

### Execute Graphton (`execute_graphton.py`)

- Replaced a 25-line block that directly instantiated `ChatOllama`/`ChatAnthropic`/`ChatOpenAI` with a 6-line `llm_kwargs` dict that collects provider-specific params (`api_key`, `base_url`)
- Changed `create_deep_agent(model=llm_model)` to `create_deep_agent(model=model_name, **llm_kwargs)` — the string flows through `parse_model_string()` which applies all configuration
- Kept early `resolve_or_passthrough()` for logging/heartbeat diagnostics only

### Tests

- 6 new tests across 3 files (model registry, model parser, prompt enhancement)
- All 151 targeted tests pass

## Benefits

- **Opus 4.6 echo resolved**: Adaptive thinking gives the model an internal reasoning channel, preventing content dumping into response text
- **Phase 2 pipeline activated**: Native thinking (StatusBuilder → CLI streaming) now works for Sonnet 4.5, Sonnet 4.6, Opus 4.5, Opus 4 — previously dormant
- **`max_tokens=20000` applied**: All Anthropic models now get the intended token limit
- **Think tool correctly conditional**: Only injected for models without native thinking (Haiku 4, older models)
- **Net code reduction**: 19 lines removed — simpler, more correct

## Impact

- **All Anthropic models in production**: Now correctly configured with registry defaults and thinking support
- **CLI users running Opus 4.6**: Should no longer see file content echoing
- **CLI users on any thinking-capable model**: Will see live thinking stream in the terminal
- **No breaking changes**: Ollama and OpenAI paths work identically (kwargs flow through)

## Related Work

- [Enable Native Extended Thinking](2026-02-24-005527-enable-native-extended-thinking.md) — Phase 2 that built the thinking pipeline (now activated)
- [Think Tool Streaming UX](2026-02-24-012820-think-tool-streaming-ux.md) — Phase 3 CLI rendering (now reachable via native thinking)
- [Suppress LLM Echo](2026-02-23-235004-suppress-llm-echo-of-attached-file-contents.md) — Initial prompt-based suppression (stays as defense-in-depth)
- [Add Claude Models](2026-02-24-004107-add-claude-models-fix-model-registry.md) — Registry entries for new models

---

**Status**: ✅ Production Ready (pending e2e validation)
**Timeline**: Session 4 of project 20260223.01.agent-thinking-flow
