# feat(agent-runner): Implement Flexible LLM Configuration

**Date**: 2026-01-19  
**Type**: Feature  
**Component**: Agent Runner Worker  
**Impact**: Medium - Configuration Change  
**Breaking**: No

## Summary

Implemented flexible LLM configuration in the agent runner worker, enabling support for multiple LLM providers (Anthropic, Ollama, OpenAI) with mode-aware defaults and zero-config local development.

## What Changed

### New Configuration System

Added `LLMConfig` dataclass to worker configuration with:
- Support for multiple providers (Anthropic, Ollama, OpenAI)
- Mode-aware defaults (local → Ollama, cloud → Anthropic)
- Configuration cascade: execution config > env vars > defaults
- Provider-specific validation

### Zero-Config Local Development

Local mode now defaults to Ollama without requiring any configuration:

```bash
MODE=local  # Automatically uses Ollama with qwen2.5-coder:7b
```

### Environment Variables

New environment variables for LLM configuration:

- `STIGMER_LLM_PROVIDER` - Provider: anthropic, ollama, openai
- `STIGMER_LLM_MODEL` - Model name (provider-specific)
- `STIGMER_LLM_BASE_URL` - Ollama server URL (default: http://localhost:11434)
- `STIGMER_LLM_API_KEY` - API key for Anthropic/OpenAI
- `STIGMER_LLM_MAX_TOKENS` - Override default max_tokens
- `STIGMER_LLM_TEMPERATURE` - Override default temperature

Backward compatible: Falls back to `ANTHROPIC_API_KEY` if `STIGMER_LLM_API_KEY` not set.

## Files Modified

### `backend/services/agent-runner/worker/config.py`

**Added**:
- `LLMConfig` dataclass with provider, model_name, base_url, api_key, etc.
- `load_from_env(mode)` class method with mode-aware defaults
- `validate()` method for provider-specific validation
- `llm: LLMConfig` field to `Config` dataclass

**Changed**:
- `Config.load_from_env()` now initializes LLM config based on execution mode

### `backend/services/agent-runner/worker/activities/execute_graphton.py`

**Changed**:
- Replaced hardcoded "claude-sonnet-4.5" default with `worker_config.llm.model_name`
- Moved worker config loading earlier to access both sandbox and LLM config
- Updated model selection to use configuration cascade

**Improved**:
- Added provider logging: `model={model_name} (provider={worker_config.llm.provider})`

## Mode-Aware Defaults

### Local Mode (MODE=local)

Zero-config defaults for local development:

```python
{
    "provider": "ollama",
    "model_name": "qwen2.5-coder:7b",
    "base_url": "http://localhost:11434",
    "max_tokens": 8192,
    "temperature": 0.0,
}
```

### Cloud Mode (MODE=cloud)

Production defaults:

```python
{
    "provider": "anthropic",
    "model_name": "claude-sonnet-4.5",
    "max_tokens": 20000,
    "temperature": None,  # Use Anthropic default
}
```

## Configuration Examples

### Example 1: Zero-Config Local

```bash
MODE=local python -m worker.main
# Uses: Ollama with qwen2.5-coder:7b
```

### Example 2: Custom Ollama Model

```bash
export MODE=local
export STIGMER_LLM_MODEL=deepseek-coder-v2:16b
python -m worker.main
# Uses: Ollama with deepseek-coder-v2:16b
```

### Example 3: Anthropic in Local Mode

```bash
export MODE=local
export STIGMER_LLM_PROVIDER=anthropic
export STIGMER_LLM_API_KEY=sk-ant-...
python -m worker.main
# Uses: Anthropic with claude-sonnet-4.5
```

### Example 4: Cloud Mode (Default)

```bash
export MODE=cloud
export ANTHROPIC_API_KEY=sk-ant-...
python -m worker.main
# Uses: Anthropic with claude-sonnet-4.5
```

### Example 5: Remote Ollama

```bash
export MODE=local
export STIGMER_LLM_BASE_URL=http://ollama-server:11434
export STIGMER_LLM_MODEL=llama3.2:3b
python -m worker.main
# Uses: Remote Ollama with llama3.2:3b
```

## Validation

### Provider Validation

- Provider must be "anthropic", "ollama", or "openai"
- Ollama requires `base_url`
- Anthropic/OpenAI require `api_key`
- Model name cannot be empty

### Error Messages

Validation errors are raised at config load time with helpful messages:

```python
# Missing Ollama base_url
ValueError: base_url is required for Ollama provider. 
            Set STIGMER_LLM_BASE_URL (default: http://localhost:11434)

# Missing Anthropic API key
ValueError: api_key is required for anthropic provider. 
            Set STIGMER_LLM_API_KEY or ANTHROPIC_API_KEY

# Invalid provider
ValueError: Invalid provider 'gemini'. 
            Must be one of: anthropic, ollama, openai
```

## Backward Compatibility

- Existing deployments using `ANTHROPIC_API_KEY` continue to work
- Cloud mode defaults to Anthropic (unchanged behavior)
- Execution config from gRPC still has highest priority (unchanged)

## Dependencies

Requires:
- Task 3: Ollama support in Graphton (`backend/libs/python/graphton`)
- Task 2: Configuration design specification

## Testing Status

- ✅ Linter validation passed
- ✅ Configuration loading tested
- ⏳ Integration testing pending
- ⏳ End-to-end testing pending

## Migration Guide

### For Existing Cloud Deployments

No changes required. Existing configuration works as-is:

```bash
# Before (still works):
MODE=cloud
ANTHROPIC_API_KEY=sk-ant-...

# After (same behavior):
MODE=cloud
ANTHROPIC_API_KEY=sk-ant-...
```

### For New Local Deployments

Zero configuration needed:

```bash
# Just set mode to local:
MODE=local

# Optionally override model:
MODE=local
STIGMER_LLM_MODEL=llama3.2:3b
```

### For Custom Configurations

Use new `STIGMER_LLM_*` variables:

```bash
# Full control:
STIGMER_LLM_PROVIDER=ollama
STIGMER_LLM_MODEL=custom-model
STIGMER_LLM_BASE_URL=http://custom-server:11434
```

## Benefits

1. **Zero-Config Local Development**: Just set `MODE=local` and go
2. **Flexibility**: Support for multiple LLM providers
3. **Validation**: Catch misconfiguration at startup, not runtime
4. **Backward Compatible**: Existing deployments unaffected
5. **Future-Proof**: Easy to add new providers (e.g., Google, Cohere)

## Known Limitations

- No health check for Ollama endpoint on startup (logs error during first execution)
- No auto-detection of available Ollama models
- No friendly model aliases (e.g., "fast", "balanced", "powerful")
- No config file support (environment variables only)

## Future Enhancements

Potential improvements for future tasks:

1. Add startup logging to show active LLM configuration
2. Add Ollama health check on worker startup
3. Support model aliases for common use cases
4. Add `.stigmer/config.yaml` support
5. Auto-detect and recommend Ollama models
6. Add configuration reload without restart

## Related Changes

- **Task 3**: Ollama support in Graphton (prerequisite)
- **Next**: Integration testing and user documentation

## References

- Project: `_projects/2026-01/20260119.04.agent-runner-config-flexibility/`
- Design: `task-2-configuration-design.md`
- Implementation: `task-4-completion.md`
- Checkpoint: `checkpoints/2026-01-19-task-4-llm-config-complete.md`

---

**Impact**: Medium - New configuration system, but backward compatible  
**Breaking**: No  
**Testing**: Manual testing required before deployment  
**Documentation**: User-facing docs update needed
