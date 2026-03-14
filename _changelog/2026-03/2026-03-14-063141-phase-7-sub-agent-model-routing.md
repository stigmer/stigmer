# Phase 7: Sub-Agent Model Routing

**Date**: March 14, 2026

## Summary

Wired the `SubAgent.model_override` proto field through the agent-runner transformer and graphton's HITL sub-agent compilation path, enabling each sub-agent to run on a different LLM model than the parent agent. This is the core cost optimization mechanism — operators can route research sub-agents to cheaper models while keeping the orchestrator on a high-capability model.

## Problem Statement

Sub-agents inherited the parent agent's LLM model unconditionally. For multi-agent workflows where sub-agents perform narrow, well-defined tasks (web search, data extraction, summarization), using the same expensive model as the orchestrator wastes money.

### Pain Points

- No mechanism to assign cheaper models to sub-agents despite `model_override` being defined in the proto schema since Phase 1
- Operators had no way to optimize per-sub-agent cost without modifying the agent runner code
- Invalid model configurations would silently fall back to the parent model, hiding misconfigurations

## Solution

Thread the `model_override` string from the proto definition through two layers:

1. **Transformer layer** (`subagent_transformer.py`): Reads the field, validates it against the `ModelRegistry`, and either adds a `"model"` key to the sub-agent dict or rejects the sub-agent entirely (fail-fast).
2. **Agent factory layer** (`agent.py`): In the HITL compilation loop, resolves the `"model"` key via `parse_model_string()` to produce a fully configured `BaseChatModel` instance with correct provider settings, thinking config, and cache control.

The non-HITL path (DeepAgents middleware) requires no changes — `SubAgentMiddleware` already supports an optional `model` key in its `SubAgent` TypedDict.

## Implementation Details

### subagent_transformer.py — Validation & Propagation

- Reads `sub_agent.model_override` from the proto message
- Two-step validation: `ModelRegistry.is_registered()` (platform name) then `ModelRegistry.get_by_api_model_id()` (raw API model ID)
- On invalid model: logs an error with the unrecognized model name and returns `None`, causing `transform_subagents()` to skip this sub-agent entirely
- On valid model: adds `"model": candidate` to the sub-agent dictionary

### agent.py — HITL Path Resolution

- Before `compile_subagent_with_proxy()`, checks for `sa.get("model")` in each sub-agent dict
- String values are resolved via `parse_model_string()` with parent's `max_tokens` and `temperature`
- Pre-built `BaseChatModel` instances (from programmatic use) are passed through directly
- Absent model key falls back to the parent's `model_instance`

### Test Coverage

- `test_subagent_transformer.py`: 5 new tests in `TestModelOverride` class covering valid override, empty override, invalid override (fail-fast), isolation of valid sub-agents from invalid, and API model ID fallback
- `test_subagent_model_routing.py`: 4 new tests for the HITL path covering string resolution, instance passthrough, parent fallback, and mixed sub-agent routing

## Benefits

- **Cost reduction**: Operators can route sub-agents to models 5-20x cheaper than the orchestrator (e.g. Haiku for summarization tasks vs Opus for orchestration)
- **Fail-fast safety**: Invalid model overrides are caught at sub-agent construction time rather than producing unexpected costs or silent fallbacks
- **Zero-change usage tracking**: `UsageTracker` already resolves pricing from actual model names in LLM callbacks, so per-model cost attribution is automatically correct
- **Consistent model instantiation**: Sub-agent models go through the same `parse_model_string()` pipeline as parent models — Anthropic thinking config, cache control, and provider inference are all preserved

## Impact

- **Agent authors**: Can specify `model_override` on any sub-agent in their agent YAML to control per-sub-agent LLM costs
- **Platform operators**: Get accurate per-model cost attribution in usage reports without any additional configuration
- **Agent runner codebase**: Minimal footprint — ~30 lines in transformer, ~32 lines in agent factory, all behind clear conditional logic

## Related Work

- Phase 1 (Schema Foundation) defined `SubAgent.model_override` field
- Phase 2 (Model Pricing Registry) provides `ModelRegistry` used for validation
- Phase 3 (Usage Metrics Pipeline) provides `UsageTracker` that handles per-model cost attribution
- Phase 3B (Cost Cap) uses parent model pricing conservatively — no changes needed

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
