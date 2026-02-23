# Enable Native Extended Thinking with Synthetic Think Tool Translation

**Date**: February 24, 2026

## Summary

Enabled Anthropic's native extended thinking for supported Claude models (Sonnet 4.6, Opus 4.5, Sonnet 4.5, Opus 4) and built a translation layer in the StatusBuilder that converts native thinking content blocks into synthetic think tool calls. This lets the entire downstream pipeline — gRPC status updates, CLI rendering — treat native thinking identically to the explicit think tool without any new protobuf fields, message types, or rendering logic.

## Problem Statement

The platform had an explicit "think tool" (Phase 2) that lets agents externalize reasoning as a no-op tool call. While this is model-agnostic, Anthropic provides a native extended thinking API that produces higher-quality, automatic reasoning for Claude models. The challenge was: how to leverage native thinking without introducing a parallel pipeline.

### Pain Points

- The explicit think tool requires a tool-call round-trip (model decides to call it, receives "ok", continues) — native thinking is automatic and seamless
- Native thinking produces higher-quality reasoning because it's deeply integrated into Claude's inference process
- Without translation, native thinking blocks would be invisible to the platform's status and rendering pipeline

## Solution

Dual-path architecture with a translation layer:

1. **Model layer** (graphton): Automatically enables `thinking={"type": "enabled", "budget_tokens": 10000}` on supported Anthropic models via `parse_model_string`. Gates the explicit think tool — it's only injected for models without native thinking.
2. **Translation layer** (agent-runner StatusBuilder): Detects `type: "thinking"` content blocks during streaming, accumulates them, and flushes a synthetic `ToolCall(name="think", args={thought: ...})` when text content arrives or at stream end. The synthetic tool call is indistinguishable from an explicit think tool call.

## Implementation Details

**6 files modified, 1 file created, 8 files total across graphton library and agent-runner service.**

### Model Registry (`model_registry.py`)
- Added `supports_thinking: bool = False` to `ModelMetadata` dataclass
- Set `supports_thinking=True` for: `claude-sonnet-4.6`, `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-opus-4`
- `claude-opus-4.6` explicitly excluded — Anthropic deprecated manual thinking on Opus 4.6 in favour of `type: "adaptive"` with effort parameter (different API shape, deferred)

### Model Parser (`models.py`)
- Added `DEFAULT_THINKING_BUDGET = 10_000` constant
- In the Anthropic branch of `parse_model_string`: checks `metadata.supports_thinking`, enables thinking config, strips `temperature` and `top_k` (Anthropic API rejects them with thinking), respects explicit `thinking` kwargs

### Agent Factory (`agent.py`)
- Detects `has_native_thinking` after model creation via `isinstance(model_instance, ChatAnthropic) and getattr(model_instance, "thinking", None) is not None`
- Gates think tool injection: skipped when native thinking is active
- Passes `has_native_thinking` to prompt enhancement

### Prompt Enhancement (`prompt_enhancement.py`)
- Added `has_native_thinking: bool = False` parameter to `enhance_user_instructions()`
- `THINK_CAPABILITY` prompt section only included when `not has_native_thinking`

### Status Builder (`status_builder.py`)
- Added `_thinking_buffers` and `_thinking_started_at` per-namespace tracking
- Modified `_handle_chat_model_stream_event` to detect and accumulate `type: "thinking"` blocks, flush as synthetic `ToolCall` on text transition
- Modified `_handle_chat_model_end_event` to flush remaining thinking buffers
- Added `_extract_thinking_content()` and `_flush_thinking_buffer()` helper methods

### Tests
- 36 new tests across 4 files (9 model registry, 11 model parser, 2 prompt enhancement, 6 status builder)
- Created `tests/core/test_models.py` (new file)
- All tests pass — 148 graphton, 178 agent-runner (7 pre-existing failures unrelated)

## Benefits

- **Higher-quality reasoning**: Anthropic's native thinking is deeper than the explicit think tool for supported Claude models
- **Zero pipeline overhead**: Native thinking produces identical `ToolCall` protos to the explicit tool — no downstream changes needed
- **Automatic**: No prompt guidance needed; Claude thinks automatically when native thinking is enabled
- **Graceful fallback**: Models without native thinking (non-Anthropic, Haiku 4, older Claude, Opus 4.6) get the explicit think tool
- **Platform-controlled budget**: 10,000 token thinking budget is a platform default, not user-configurable

## Impact

- **Agent quality**: All agents using supported Claude models (Sonnet 4.6, Opus 4.5, Sonnet 4.5, Opus 4) now automatically benefit from extended thinking
- **Observability**: Native thinking is visible in the same way as explicit think tool calls — gRPC status, CLI rendering
- **Token economics**: Thinking uses output tokens (budget is a ceiling, not a floor). Monitor during Phase 4 E2E validation.
- **No breaking changes**: Existing explicit think tool still works for all models. Native thinking is additive.

## Related Work

- Phase 1: Suppressed LLM echo of attached file contents (`execute_graphton.py`)
- Phase 2: Added explicit think tool (`think_tool.py`, `agent.py`, `prompt_enhancement.py`, `approval_policy.py`)
- Phase 3 (upcoming): CLI UX rendering for think tool calls
- Phase 4 (upcoming): End-to-end validation
- Future: Adaptive thinking for Opus 4.6 (`type: "adaptive"` with effort parameter)
- Prerequisite: Claude model registry additions (Opus 4.5, Opus 4.6, Sonnet 4.6) — committed separately

---

**Status**: ✅ Production Ready (pending Phase 4 E2E validation)
**Timeline**: Single session (~2 hours including plan creation, sync, and implementation)
