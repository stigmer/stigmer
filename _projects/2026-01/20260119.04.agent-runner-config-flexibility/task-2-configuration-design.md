# Task 2: Configuration Design

**Status**: 🚧 In Progress  
**Started**: 2026-01-19

## Objective

Design a complete LLM configuration structure that:
- Supports multiple providers (Anthropic, Ollama, OpenAI)
- Uses configuration cascade (explicit > env > mode-aware default)
- Integrates cleanly with existing worker config
- Enables zero-config local development with Ollama

## Design Principles

1. **Mode-Aware Defaults**: Local mode defaults to Ollama, cloud mode defaults to Anthropic
2. **Explicit Over Implicit**: Users can override any default
3. **Validation at Load Time**: Catch misconfiguration early
4. **Provider-Specific Settings**: Support provider-specific parameters cleanly
5. **Backward Compatible**: Existing Anthropic usage continues to work

## Configuration Structure

### Python Data Classes

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class LLMConfig:
    """LLM configuration for agent execution.
    
    Supports multiple providers with provider-specific settings.
    Configuration cascade: explicit config > env vars > mode-aware defaults.
    """
    
    # Core configuration
    provider: str  # "anthropic" | "ollama" | "openai"
    model_name: str
    
    # Provider-specific settings
    base_url: Optional[str] = None  # Required for Ollama
    api_key: Optional[str] = None  # Required for Anthropic/OpenAI
    
    # Model parameters (optional)
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    
    @classmethod
    def load_from_env(cls, mode: str):
        """Load LLM configuration from environment variables.
        
        Args:
            mode: Execution mode ("local" or "cloud") for default selection
            
        Returns:
            LLMConfig instance with cascaded configuration
            
        Environment Variables:
            STIGMER_LLM_PROVIDER: LLM provider (anthropic|ollama|openai)
            STIGMER_LLM_MODEL: Model name (provider-specific)
            STIGMER_LLM_BASE_URL: Base URL for Ollama (http://localhost:11434)
            STIGMER_LLM_API_KEY: API key for Anthropic/OpenAI
            STIGMER_LLM_MAX_TOKENS: Override default max_tokens
            STIGMER_LLM_TEMPERATURE: Override default temperature
            
        Configuration Cascade:
            1. Environment variables (explicit user config)
            2. Mode-aware defaults:
               - local mode: Ollama with qwen2.5-coder:7b
               - cloud mode: Anthropic with claude-sonnet-4.5
        """
        # Implementation in next section
        pass
    
    def validate(self) -> None:
        """Validate configuration is complete and correct.
        
        Raises:
            ValueError: If configuration is invalid
        """
        # Validate provider
        valid_providers = {"anthropic", "ollama", "openai"}
        if self.provider not in valid_providers:
            raise ValueError(
                f"Invalid provider '{self.provider}'. "
                f"Must be one of: {', '.join(valid_providers)}"
            )
        
        # Validate provider-specific requirements
        if self.provider == "ollama":
            if not self.base_url:
                raise ValueError(
                    "base_url is required for Ollama provider. "
                    "Set STIGMER_LLM_BASE_URL (default: http://localhost:11434)"
                )
        
        if self.provider in {"anthropic", "openai"}:
            if not self.api_key:
                raise ValueError(
                    f"api_key is required for {self.provider} provider. "
                    f"Set STIGMER_LLM_API_KEY or ANTHROPIC_API_KEY"
                )
        
        # Validate model name is not empty
        if not self.model_name or not self.model_name.strip():
            raise ValueError("model_name cannot be empty")
```

### Updated Worker Config

```python
@dataclass
class Config:
    """Worker configuration loaded from environment variables."""
    
    # Existing fields...
    mode: str
    temporal_namespace: str
    temporal_service_address: str
    # ... (all existing fields)
    
    # NEW: LLM configuration
    llm: LLMConfig
    
    @classmethod
    def load_from_env(cls):
        """Load configuration from environment variables."""
        # Detect execution mode
        mode = os.getenv("MODE", "cloud")
        
        # Load LLM configuration (mode-aware)
        llm_config = LLMConfig.load_from_env(mode)
        
        # ... existing config loading ...
        
        return cls(
            mode=mode,
            # ... existing fields ...
            llm=llm_config,
        )
```

## Environment Variables

### Variable Naming Convention

All LLM-related variables use the `STIGMER_LLM_*` prefix for consistency.

### Variable Definitions

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `STIGMER_LLM_PROVIDER` | string | No | mode-aware | Provider: `anthropic`, `ollama`, or `openai` |
| `STIGMER_LLM_MODEL` | string | No | provider-default | Model name (provider-specific) |
| `STIGMER_LLM_BASE_URL` | string | Ollama only | `http://localhost:11434` | Ollama server URL |
| `STIGMER_LLM_API_KEY` | string | Anthropic/OpenAI | from `ANTHROPIC_API_KEY` | API key for cloud providers |
| `STIGMER_LLM_MAX_TOKENS` | int | No | provider-default | Override max_tokens |
| `STIGMER_LLM_TEMPERATURE` | float | No | provider-default | Override temperature |

### Backward Compatibility

For Anthropic users, we support reading from `ANTHROPIC_API_KEY` if `STIGMER_LLM_API_KEY` is not set:

```python
# Fallback chain for API key
api_key = (
    os.getenv("STIGMER_LLM_API_KEY") or 
    os.getenv("ANTHROPIC_API_KEY")
)
```

## Mode-Aware Defaults

### Local Mode Defaults

**Philosophy**: Zero-dependency local development with good out-of-box performance.

```python
LOCAL_MODE_DEFAULTS = {
    "provider": "ollama",
    "model_name": "qwen2.5-coder:7b",  # Fast, capable, code-focused
    "base_url": "http://localhost:11434",
    "max_tokens": 8192,
    "temperature": 0.0,  # Deterministic for dev
}
```

**Alternative Models** (user can override):
- `qwen2.5-coder:7b` - Recommended (fast, good at code)
- `llama3.2:3b` - Faster, smaller, more limited
- `deepseek-coder-v2:16b` - Slower, more capable
- `codellama:13b` - Code-focused, medium size

### Cloud Mode Defaults

**Philosophy**: Production-quality reasoning with Anthropic.

```python
CLOUD_MODE_DEFAULTS = {
    "provider": "anthropic",
    "model_name": "claude-sonnet-4.5",
    "max_tokens": 20000,  # Deep reasoning needs high limits
    "temperature": None,  # Use Anthropic's defaults
}
```

**API Key Requirement**: Cloud mode fails if no Anthropic API key is found.

## Configuration Loading Implementation

### Complete Load Logic

```python
import os
from typing import Optional

@dataclass
class LLMConfig:
    # ... (fields from above)
    
    @classmethod
    def load_from_env(cls, mode: str) -> "LLMConfig":
        """Load LLM configuration with cascaded defaults."""
        
        # Determine mode-aware defaults
        if mode == "local":
            defaults = {
                "provider": "ollama",
                "model_name": "qwen2.5-coder:7b",
                "base_url": "http://localhost:11434",
                "max_tokens": 8192,
                "temperature": 0.0,
            }
        else:  # cloud mode
            defaults = {
                "provider": "anthropic",
                "model_name": "claude-sonnet-4.5",
                "max_tokens": 20000,
                "temperature": None,
            }
        
        # Read from environment (overrides defaults)
        provider = os.getenv("STIGMER_LLM_PROVIDER", defaults["provider"])
        model_name = os.getenv("STIGMER_LLM_MODEL", defaults["model_name"])
        
        # Provider-specific settings
        base_url = os.getenv("STIGMER_LLM_BASE_URL", defaults.get("base_url"))
        
        # API key with backward compatibility
        api_key = (
            os.getenv("STIGMER_LLM_API_KEY") or 
            os.getenv("ANTHROPIC_API_KEY")
        )
        
        # Optional overrides
        max_tokens_str = os.getenv("STIGMER_LLM_MAX_TOKENS")
        max_tokens = int(max_tokens_str) if max_tokens_str else defaults.get("max_tokens")
        
        temperature_str = os.getenv("STIGMER_LLM_TEMPERATURE")
        temperature = float(temperature_str) if temperature_str else defaults.get("temperature")
        
        # Create config
        config = cls(
            provider=provider,
            model_name=model_name,
            base_url=base_url,
            api_key=api_key,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        
        # Validate before returning
        config.validate()
        
        return config
```

## Validation Rules

### Provider Validation Matrix

| Provider | Requires `base_url` | Requires `api_key` | Model Format |
|----------|---------------------|---------------------|--------------|
| `ollama` | ✅ Yes | ❌ No | `model-name:tag` (e.g., `qwen2.5-coder:7b`) |
| `anthropic` | ❌ No | ✅ Yes | `claude-*` (e.g., `claude-sonnet-4.5`) |
| `openai` | ❌ No (uses default) | ✅ Yes | `gpt-*` or `o1-*` |

### Validation Error Examples

```python
# Missing base_url for Ollama
LLMConfig(provider="ollama", model_name="llama3.2:3b", base_url=None)
# Raises: ValueError("base_url is required for Ollama provider...")

# Missing API key for Anthropic
LLMConfig(provider="anthropic", model_name="claude-sonnet-4.5", api_key=None)
# Raises: ValueError("api_key is required for anthropic provider...")

# Invalid provider
LLMConfig(provider="gemini", model_name="gemini-pro")
# Raises: ValueError("Invalid provider 'gemini'. Must be one of: anthropic, ollama, openai")
```

## Integration with execute_graphton.py

### Current Code (Lines 156-161)

```python
# BEFORE: Hardcoded default
model_name = (
    execution.spec.execution_config.model_name 
    if execution.spec.execution_config and execution.spec.execution_config.model_name
    else "claude-sonnet-4.5"  # ❌ Hardcoded
)
```

### Updated Code

```python
# AFTER: Use worker config
from worker.config import Config

worker_config = Config.load_from_env()

# Priority: execution config > worker config (from env vars + mode-aware defaults)
model_name = (
    execution.spec.execution_config.model_name 
    if execution.spec.execution_config and execution.spec.execution_config.model_name
    else worker_config.llm.model_name  # ✅ Mode-aware default
)

# For Ollama, we may need to pass base_url to graphton
# (Graphton's parse_model_string will need updating)
```

## Usage Examples

### Example 1: Default Local Mode (Zero Config)

```bash
# No environment variables set
MODE=local python main.py
```

**Result**:
- Provider: `ollama`
- Model: `qwen2.5-coder:7b`
- Base URL: `http://localhost:11434`
- No API key needed

### Example 2: Anthropic in Local Mode

```bash
export MODE=local
export STIGMER_LLM_PROVIDER=anthropic
export STIGMER_LLM_API_KEY=sk-ant-...
python main.py
```

**Result**:
- Provider: `anthropic`
- Model: `claude-sonnet-4.5` (default for Anthropic)
- Uses Anthropic API

### Example 3: Cloud Mode with Custom Model

```bash
export MODE=cloud
export ANTHROPIC_API_KEY=sk-ant-...
export STIGMER_LLM_MODEL=claude-opus-4
python main.py
```

**Result**:
- Provider: `anthropic` (cloud default)
- Model: `claude-opus-4` (user override)
- Uses Anthropic API

### Example 4: Ollama with Custom Model

```bash
export MODE=local
export STIGMER_LLM_MODEL=deepseek-coder-v2:16b
python main.py
```

**Result**:
- Provider: `ollama` (local default)
- Model: `deepseek-coder-v2:16b` (user override)
- Base URL: `http://localhost:11434` (default)

### Example 5: Remote Ollama Instance

```bash
export MODE=local
export STIGMER_LLM_BASE_URL=http://ollama-server:11434
export STIGMER_LLM_MODEL=llama3.2:3b
python main.py
```

**Result**:
- Provider: `ollama` (local default)
- Model: `llama3.2:3b`
- Base URL: `http://ollama-server:11434` (custom)

## Startup Logging

### Log Messages

```python
def log_llm_config(config: LLMConfig, mode: str):
    """Log LLM configuration at startup."""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info("=" * 60)
    logger.info("LLM Configuration")
    logger.info("=" * 60)
    logger.info(f"  Mode: {mode}")
    logger.info(f"  Provider: {config.provider}")
    logger.info(f"  Model: {config.model_name}")
    
    if config.provider == "ollama":
        logger.info(f"  Base URL: {config.base_url}")
    elif config.provider in {"anthropic", "openai"}:
        logger.info(f"  API Key: {'✓ Set' if config.api_key else '✗ Missing'}")
    
    if config.max_tokens:
        logger.info(f"  Max Tokens: {config.max_tokens}")
    if config.temperature is not None:
        logger.info(f"  Temperature: {config.temperature}")
    
    logger.info("=" * 60)
```

### Example Output

```
============================================================
LLM Configuration
============================================================
  Mode: local
  Provider: ollama
  Model: qwen2.5-coder:7b
  Base URL: http://localhost:11434
  Max Tokens: 8192
  Temperature: 0.0
============================================================
```

## Next Steps

After this design is approved:

1. **Task 3**: Implement `LLMConfig` class in `worker/config.py`
2. **Task 4**: Update graphton to support Ollama in `parse_model_string()`
3. **Task 5**: Update `execute_graphton.py` to use worker config
4. **Task 6**: Add startup logging
5. **Task 7**: Test with all providers

## Open Questions

1. **Model Recommendations**: Should we document recommended Ollama models by use case?
   - Fast dev: `qwen2.5-coder:7b`
   - Resource-constrained: `llama3.2:3b`
   - High quality: `deepseek-coder-v2:16b`

2. **Ollama Auto-Detection**: Should we ping Ollama endpoint on startup and warn if unreachable?

3. **Model Aliases**: Should we support friendly aliases like `fast`, `balanced`, `powerful`?
   - `fast` → `llama3.2:3b` (Ollama) or `claude-haiku-4` (Anthropic)
   - `balanced` → `qwen2.5-coder:7b` (Ollama) or `claude-sonnet-4.5` (Anthropic)
   - `powerful` → `deepseek-coder-v2:16b` (Ollama) or `claude-opus-4` (Anthropic)

4. **Config File Support**: Should we support `.stigmer/config.yaml` in addition to env vars?

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Use `STIGMER_LLM_*` prefix | Consistent namespace, avoids conflicts |
| Mode-aware defaults | Local = Ollama, Cloud = Anthropic makes sense for typical usage |
| Support `ANTHROPIC_API_KEY` fallback | Backward compatibility for existing users |
| Validate at load time | Fail fast with helpful error messages |
| `qwen2.5-coder:7b` as default | Fast, capable, code-focused, good balance |
| Dataclass over dict | Type safety, IDE autocomplete, validation |

---

**Status**: Ready for Review  
**Next**: Implement `LLMConfig` in Task 3
