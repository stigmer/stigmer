# Task 1 Analysis: Current Agent Runner Implementation

**Completed**: 2026-01-19  
**Status**: ✅ Complete

## Summary

Analyzed the agent runner's LLM configuration flow and identified where model selection happens, how it's currently hardcoded, and what needs to change to support both Anthropic and Ollama providers.

## Key Findings

### 1. Configuration Flow

```
execution.spec.execution_config.model_name (from gRPC)
    ↓ (if empty)
"claude-sonnet-4.5" (hardcoded fallback)
    ↓
create_deep_agent(model=model_name)
    ↓
parse_model_string(model_name)
    ↓
ChatAnthropic() or ChatOpenAI() instantiation
```

### 2. Model Configuration Location

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py`

**Lines 157-161**: Model name resolution with hardcoded default
```python
model_name = (
    execution.spec.execution_config.model_name 
    if execution.spec.execution_config and execution.spec.execution_config.model_name
    else "claude-sonnet-4.5"  # ❌ Hardcoded default
)
```

**Line 356**: Model passed to graphton
```python
agent_graph = create_deep_agent(
    model=model_name,  # String or BaseChatModel instance
    system_prompt=enhanced_system_prompt,
    # ...
)
```

### 3. Graphton Model Parsing

**File**: `backend/libs/python/graphton/src/graphton/core/agent.py`

**Lines 258-264**: Parse model string to LangChain instance
```python
if isinstance(model, str):
    model_instance = parse_model_string(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        **model_kwargs,
    )
```

### 4. Current Provider Support

**File**: `backend/libs/python/graphton/src/graphton/core/models.py`

**Supported Providers**:
- ✅ Anthropic (`ChatAnthropic`)
  - Friendly names: `claude-sonnet-4.5`, `claude-opus-4`, `claude-haiku-4`
  - Maps to full model IDs (e.g., `claude-sonnet-4-5-20250929`)
  - Default: `max_tokens=20000`
- ✅ OpenAI (`ChatOpenAI`)
  - Models: `gpt-4o`, `gpt-4o-mini`, `o1`, etc.
- ❌ Ollama - **NOT SUPPORTED**

**Provider Detection** (lines 72-88):
```python
if ":" in model:
    provider, model_name = model.split(":", 1)
    # Explicit provider prefix (e.g., "anthropic:claude-sonnet-4.5")
else:
    # Infer from model name
    if model_name.startswith("claude"):
        provider = "anthropic"
    elif model_name.startswith("gpt") or model_name.startswith("o1"):
        provider = "openai"
    else:
        raise ValueError("Cannot infer provider from model name")
```

### 5. Missing Configuration Cascade

**Current**: No environment variable or config file support

**Needed**: Configuration cascade
```
CLI flag (--llm-provider, --llm-model)
    ↓ (if not provided)
Environment variables (STIGMER_LLM_PROVIDER, STIGMER_LLM_MODEL)
    ↓ (if not provided)
Worker config defaults (mode-aware: local → Ollama, cloud → Anthropic)
```

### 6. Worker Config Integration

**File**: `backend/services/agent-runner/worker/config.py`

**Current**: No LLM configuration fields

**Needed**:
- LLM provider (anthropic, ollama, openai)
- Model name
- Base URL (for Ollama local endpoint)
- API key handling (optional for Ollama)
- Mode-aware defaults

## Files Requiring Changes

### 1. Graphton Core (Add Ollama Support)

**`backend/libs/python/graphton/src/graphton/core/models.py`**
- Add `ChatOllama` import from `langchain_ollama`
- Add Ollama provider case in `parse_model_string()`
- Add Ollama model mapping (friendly names)
- Add Ollama defaults (base_url, temperature, etc.)

### 2. Worker Configuration (Add LLM Config)

**`backend/services/agent-runner/worker/config.py`**
- Add `LLMConfig` class with provider, model, base_url
- Add environment variable reading (STIGMER_LLM_*)
- Add mode-aware defaults (local → Ollama, cloud → Anthropic)
- Add validation for Ollama base_url requirements

### 3. Agent Execution Activity (Use Worker Config)

**`backend/services/agent-runner/worker/activities/execute_graphton.py`**
- Replace hardcoded default with `worker_config.llm.model_name`
- Pass LLM config to graphton if needed
- Handle Ollama base_url configuration

## Architecture Insights

### Graphton Design
- Clean separation: Model string parsing is isolated in `models.py`
- Extensible: Adding new providers requires minimal changes
- Sensible defaults per provider

### Agent Runner Design
- Polyglot workflow: Python activity + Java persistence
- gRPC-based configuration: execution.spec.execution_config
- Worker config: Mode-aware (local vs cloud)

### Configuration Priorities

**Current** (implicit):
```
execution.spec.execution_config.model_name > hardcoded default
```

**Proposed** (explicit cascade):
```
execution.spec.execution_config.model_name 
  > worker_config.llm.model_name 
  > environment variables 
  > mode-aware default
```

## Recommendations for Task 2

### Design Configuration Schema

1. **Environment Variables**
   - `STIGMER_LLM_PROVIDER` (anthropic|ollama|openai)
   - `STIGMER_LLM_MODEL` (model name)
   - `STIGMER_LLM_BASE_URL` (for Ollama, e.g., http://localhost:11434)
   - `STIGMER_LLM_API_KEY` (optional for Anthropic/OpenAI)

2. **Worker Config Schema**
   ```python
   class LLMConfig:
       provider: str  # anthropic, ollama, openai
       model_name: str
       base_url: Optional[str]  # Required for Ollama
       api_key: Optional[str]  # Required for Anthropic/OpenAI
       max_tokens: Optional[int]
       temperature: Optional[float]
   ```

3. **Mode-Aware Defaults**
   - **Local mode**: Ollama with `qwen2.5-coder:7b` or `llama3.2:3b`
   - **Cloud mode**: Anthropic with `claude-sonnet-4.5`

4. **Validation Rules**
   - If provider=ollama, base_url is required
   - If provider=anthropic/openai, api_key is required
   - Model name must match provider

## Next Steps

Move to **Task 2: Design Configuration Schema**
- Define complete LLM configuration structure
- Specify environment variable names
- Design mode-aware default selection
- Define validation rules
- Create configuration loading priority
