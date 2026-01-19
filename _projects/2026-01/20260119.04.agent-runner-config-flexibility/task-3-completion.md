# Task 3: Implement Ollama Support in Graphton

**Status**: ✅ COMPLETE  
**Date**: 2026-01-19  
**Location**: `backend/libs/python/graphton/`

## Objective

Add Ollama provider support to Graphton's `parse_model_string()` function so it can instantiate `ChatOllama` alongside `ChatAnthropic` and `ChatOpenAI`.

## What Was Implemented

### 1. Added langchain-ollama Dependency

Updated `backend/libs/python/graphton/pyproject.toml`:

```toml
langchain-ollama = ">=0.2.0,<1.0.0"
```

Installed version: `langchain-ollama==0.3.10`

### 2. Updated models.py

Made the following changes to `backend/libs/python/graphton/src/graphton/core/models.py`:

#### Added Ollama Import

```python
from langchain_ollama import ChatOllama
```

#### Added Ollama Model Mapping

```python
OLLAMA_MODEL_MAP = {
    "qwen2.5-coder": "qwen2.5-coder:7b",
    "llama3.2": "llama3.2:3b",
    "deepseek-coder": "deepseek-coder-v2:16b",
    "codellama": "codellama:13b",
}
```

#### Added Ollama Defaults

```python
OLLAMA_DEFAULTS = {
    "base_url": "http://localhost:11434",
    "temperature": 0.0,
}
```

#### Added Provider Inference Helper

Created `_infer_provider()` function to automatically detect the provider from model names:

```python
def _infer_provider(model_name: str) -> str:
    """Infer the LLM provider from the model name."""
    # Check Anthropic models
    if model_name.startswith("claude"):
        return "anthropic"
    
    # Check OpenAI models
    if model_name.startswith("gpt") or model_name.startswith("o1"):
        return "openai"
    
    # Check Ollama models (common prefixes)
    ollama_prefixes = [
        "qwen", "llama", "deepseek", "codellama", "mistral",
        "phi", "gemma", "yi", "solar", "orca", "vicuna",
    ]
    for prefix in ollama_prefixes:
        if model_name.lower().startswith(prefix):
            return "ollama"
    
    raise ValueError(...)
```

#### Updated Provider Prefix Parsing

Improved the provider prefix parsing logic to handle Ollama's model naming convention (which includes colons in model names):

```python
if ":" in model:
    parts = model.split(":", 1)
    potential_provider = parts[0].lower()
    
    # Check if first part is a known provider
    if potential_provider in ["anthropic", "openai", "ollama"]:
        provider = potential_provider
        model_name = parts[1].strip()
    else:
        # Not a provider prefix, treat whole string as model name
        model_name = model
        provider = _infer_provider(model_name)
```

#### Added Ollama Provider Case

Added Ollama handling in `parse_model_string()`:

```python
elif provider == "ollama":
    # Map friendly name to full model ID
    full_model_name = OLLAMA_MODEL_MAP.get(model_name, model_name)
    
    # Build model parameters with defaults
    ollama_params: dict[str, Any] = {**OLLAMA_DEFAULTS}
    
    # Apply user overrides (Ollama uses num_predict instead of max_tokens)
    if max_tokens is not None:
        ollama_params["num_predict"] = max_tokens
    if temperature is not None:
        ollama_params["temperature"] = temperature
    
    # Merge additional kwargs
    ollama_params.update(model_kwargs)
    
    return ChatOllama(
        model=full_model_name,
        **ollama_params,
    )
```

#### Updated Documentation

Updated the docstring to include Ollama examples:

```python
"""Parse a model name string into a LangChain model instance.

Supported Models:
    Ollama:
        - "qwen2.5-coder" -> qwen2.5-coder:7b
        - "llama3.2" -> llama3.2:3b
        - "deepseek-coder" -> deepseek-coder-v2:16b
        - "codellama" -> codellama:13b
        - Any other Ollama model name (passed through)

Examples:
    >>> model = parse_model_string("qwen2.5-coder")
    >>> model = parse_model_string("ollama:llama3.2:3b")
"""
```

### 3. Created Comprehensive Test Suite

Created `test_ollama_support.py` to verify all functionality:

- ✅ Ollama friendly names (qwen2.5-coder, llama3.2, etc.)
- ✅ Explicit provider prefix (ollama:qwen2.5-coder:7b)
- ✅ Parameter overrides (base_url, temperature, max_tokens → num_predict)
- ✅ Provider inference from model names
- ✅ All three providers work correctly (Anthropic, OpenAI, Ollama)

## Test Results

All tests passed successfully:

```
✅ qwen2.5-coder: ChatOllama
   Model: qwen2.5-coder:7b
   Base URL: http://localhost:11434
   Temperature: 0.0

✅ llama3.2: ChatOllama
   Model: llama3.2:3b

✅ deepseek-coder: ChatOllama
   Model: deepseek-coder-v2:16b

✅ codellama: ChatOllama
   Model: codellama:13b

✅ ollama:mistral:latest: ChatOllama
✅ Custom base_url: http://custom-host:11434
✅ Custom temperature: 0.7
✅ max_tokens → num_predict: 2048

✅ Provider Inference: All Ollama models correctly identified
✅ All Providers: Anthropic, OpenAI, Ollama all work
```

## Files Modified

1. `backend/libs/python/graphton/pyproject.toml`
   - Added `langchain-ollama` dependency

2. `backend/libs/python/graphton/src/graphton/core/models.py`
   - Added `ChatOllama` import
   - Added `OLLAMA_MODEL_MAP` for friendly names
   - Added `OLLAMA_DEFAULTS` for default parameters
   - Added `_infer_provider()` helper function
   - Updated provider prefix parsing logic
   - Added Ollama provider case in `parse_model_string()`
   - Updated docstring with Ollama examples

3. `backend/libs/python/graphton/poetry.lock`
   - Updated with langchain-ollama and its dependencies

## Key Features

### 1. Friendly Model Names

Users can use short, memorable names instead of full model IDs:

```python
model = parse_model_string("qwen2.5-coder")  # → qwen2.5-coder:7b
model = parse_model_string("llama3.2")       # → llama3.2:3b
```

### 2. Explicit Provider Prefix

Users can explicitly specify the provider when needed:

```python
model = parse_model_string("ollama:qwen2.5-coder:7b")
model = parse_model_string("ollama:mistral:latest")
```

### 3. Automatic Provider Inference

The system automatically detects Ollama models from common prefixes:

```python
model = parse_model_string("qwen2.5-coder:latest")  # Auto-detected as Ollama
model = parse_model_string("llama3.2:3b")           # Auto-detected as Ollama
model = parse_model_string("mistral:7b")            # Auto-detected as Ollama
```

### 4. Parameter Overrides

All parameters can be customized:

```python
model = parse_model_string(
    "qwen2.5-coder",
    base_url="http://custom-host:11434",
    temperature=0.7,
    max_tokens=2048  # Automatically mapped to num_predict
)
```

### 5. Sensible Defaults

- **base_url**: `http://localhost:11434` (standard Ollama endpoint)
- **temperature**: `0.0` (deterministic responses)
- **Model**: Falls back to exact string if not in friendly name map

## Breaking Changes

None. The changes are fully backward compatible:

- Existing Anthropic and OpenAI usage continues to work
- No changes to function signatures
- Only additions, no removals

## Next Steps

Task 4: Implement LLMConfig in Worker Config

Now that Graphton supports Ollama, we need to:
1. Add LLM configuration to the agent runner worker config
2. Read configuration from environment variables
3. Pass the config to Graphton's `parse_model_string()`
4. Replace hardcoded "claude-sonnet-4.5" with config value

## Notes

### Ollama Parameter Differences

Ollama uses different parameter names than Anthropic/OpenAI:

- `max_tokens` (Anthropic/OpenAI) → `num_predict` (Ollama)

The implementation handles this automatically by mapping `max_tokens` to `num_predict` when the provider is Ollama.

### Model Name Format

Ollama models use colon-separated names (e.g., `llama3.2:3b`), which required special handling in the provider prefix parsing logic. The implementation correctly distinguishes between:

- Provider prefix: `ollama:llama3.2:3b` (provider = "ollama", model = "llama3.2:3b")
- Model name: `llama3.2:3b` (inferred provider = "ollama", model = "llama3.2:3b")

### Supported Ollama Models

The inference logic recognizes these common Ollama model prefixes:

- qwen, llama, deepseek, codellama, mistral
- phi, gemma, yi, solar, orca, vicuna

Any other model name can still be used with an explicit `ollama:` prefix.

---

**Task 3 Status**: ✅ COMPLETE  
**Next Task**: Task 4 - Implement LLMConfig in Worker Config
