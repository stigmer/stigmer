"""Model string parser for Graphton.

This module provides utilities to parse model name strings into LangChain model instances,
eliminating boilerplate for model instantiation and providing sensible defaults.

Model name resolution is handled by ModelRegistry, which provides the single source of
truth for mapping platform-friendly names to actual API model IDs.
"""

from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from graphton.core.model_registry import ModelRegistry

# Short alias mapping for Ollama models (convenience aliases -> model_id in registry)
# These allow users to omit the size suffix (e.g., "qwen2.5-coder" instead of "qwen2.5-coder:7b")
# Note: These are NOT api_model_id mappings - they map to model_id which equals api_model_id for Ollama
_OLLAMA_SHORT_ALIASES = {
    "qwen2.5-coder": "qwen2.5-coder:7b",
    "llama3.2": "llama3.2:3b",
    "deepseek-coder": "deepseek-coder-v2:16b",
    "codellama": "codellama:13b",
}

# Default parameters for different providers
ANTHROPIC_DEFAULTS = {
    "max_tokens": 20000,  # Deep Agents need high token limits for reasoning
}

OLLAMA_DEFAULTS = {
    "base_url": "http://localhost:11434",
    "temperature": 0.0,
}


def _infer_provider(model_name: str) -> str:
    """Infer the LLM provider from the model name.
    
    Args:
        model_name: The model name to infer the provider from
    
    Returns:
        The inferred provider name (anthropic, openai, or ollama)
    
    Raises:
        ValueError: If provider cannot be inferred from model name
    
    """
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
    
    # If no provider can be inferred, raise an error
    raise ValueError(
        f"Cannot infer provider from model name '{model_name}'. "
        "Use provider prefix (e.g., 'anthropic:model-name', 'openai:model-name', or 'ollama:model-name') "
        "or use a standard model name (claude-*, gpt-*, o1-*, qwen*, llama*, etc.)"
    )


def parse_model_string(
    model: str,
    max_tokens: int | None = None,
    temperature: float | None = None,
    **model_kwargs: Any,  # noqa: ANN401
) -> BaseChatModel:
    """Parse a model name string into a LangChain model instance.
    
    Supports platform-friendly model names with automatic resolution to API model IDs
    via ModelRegistry, plus sensible defaults for each provider.
    
    Model Resolution:
        Uses ModelRegistry.resolve_or_passthrough() to map platform names to API IDs:
        - Anthropic: "claude-sonnet-4.5" -> "claude-sonnet-4-5-20250929"
        - OpenAI: Passed through as-is (API IDs match platform names)
        - Ollama: Short aliases expanded, then passed through
        
        For Ollama, short convenience aliases are also supported:
        - "qwen2.5-coder" -> "qwen2.5-coder:7b"
        - "llama3.2" -> "llama3.2:3b"
        - "deepseek-coder" -> "deepseek-coder-v2:16b"
        - "codellama" -> "codellama:13b"
    
    Args:
        model: Model name string (e.g., "claude-sonnet-4.5", "gpt-4o", "qwen2.5-coder")
        max_tokens: Override default max_tokens for the model
        temperature: Override default temperature for the model
        **model_kwargs: Additional model-specific parameters
    
    Returns:
        LangChain model instance (ChatAnthropic, ChatOpenAI, or ChatOllama)
    
    Raises:
        ValueError: If model string format is invalid or unsupported
    
    Examples:
        >>> model = parse_model_string("claude-sonnet-4.5")
        >>> model = parse_model_string("gpt-4o", temperature=0.7)
        >>> model = parse_model_string("claude-opus-4", max_tokens=10000)
        >>> model = parse_model_string("qwen2.5-coder")
        >>> model = parse_model_string("ollama:llama3.2:3b")
    
    """
    if not model or not model.strip():
        raise ValueError("Model name cannot be empty")
    
    model = model.strip()
    
    # Handle provider-prefixed format (e.g., "anthropic:claude-sonnet-4.5", "ollama:qwen2.5-coder:7b")
    if ":" in model:
        parts = model.split(":", 1)
        potential_provider = parts[0].lower()
        
        # Check if first part is a known provider
        if potential_provider in ["anthropic", "openai", "ollama"]:
            provider = potential_provider
            model_name = parts[1].strip()
        else:
            # Not a provider prefix, treat whole string as model name and infer provider
            model_name = model
            provider = _infer_provider(model_name)
    else:
        model_name = model
        provider = _infer_provider(model_name)
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Resolve model name to API model ID using ModelRegistry
    #
    # For Ollama, first check short aliases (e.g., "qwen2.5-coder" -> "qwen2.5-coder:7b")
    # Then use ModelRegistry.resolve_or_passthrough() for API ID resolution.
    # ─────────────────────────────────────────────────────────────────────────────
    
    # Expand Ollama short aliases before registry resolution
    if provider == "ollama":
        model_name = _OLLAMA_SHORT_ALIASES.get(model_name, model_name)
    
    # Use ModelRegistry to resolve to API model ID
    api_model_id, _metadata = ModelRegistry.resolve_or_passthrough(
        model_name,
        provider=provider,
    )
    
    # Parse Anthropic models
    if provider == "anthropic":
        # Build model parameters with defaults
        model_params: dict[str, Any] = {**ANTHROPIC_DEFAULTS}
        
        # Apply user overrides
        if max_tokens is not None:
            model_params["max_tokens"] = max_tokens
        if temperature is not None:
            model_params["temperature"] = temperature
        
        # Merge additional kwargs
        model_params.update(model_kwargs)
        
        return ChatAnthropic(
            model=api_model_id,  # type: ignore[call-arg]
            **model_params,
        )
    
    # Parse OpenAI models
    elif provider == "openai":
        # OpenAI uses different parameter names and patterns
        openai_params: dict[str, Any] = {}
        
        # Apply user overrides
        if max_tokens is not None:
            openai_params["max_tokens"] = max_tokens
        if temperature is not None:
            openai_params["temperature"] = temperature
        
        # Merge additional kwargs
        openai_params.update(model_kwargs)
        
        return ChatOpenAI(
            model=api_model_id,
            **openai_params,
        )
    
    # Parse Ollama models
    elif provider == "ollama":
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
            model=api_model_id,
            **ollama_params,
        )
    
    else:
        raise ValueError(
            f"Unsupported provider '{provider}'. "
            "Supported providers: anthropic, openai, ollama"
        )

