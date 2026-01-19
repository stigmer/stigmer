"""Model string parser for Graphton.

This module provides utilities to parse model name strings into LangChain model instances,
eliminating boilerplate for model instantiation and providing sensible defaults.
"""

from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

# Model name mapping for Anthropic models (friendly name -> full model ID)
ANTHROPIC_MODEL_MAP = {
    "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
    "claude-opus-4": "claude-opus-4-20250514",
    "claude-haiku-4": "claude-haiku-4-20250313",
}

# Model name mapping for Ollama models (friendly name -> full model ID)
OLLAMA_MODEL_MAP = {
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
    
    Supports friendly model names with automatic mapping to full model IDs
    and sensible defaults for each provider.
    
    Supported Models:
        Anthropic:
            - "claude-sonnet-4.5" -> claude-sonnet-4-5-20250929
            - "claude-opus-4" -> claude-opus-4-20250514
            - "claude-haiku-4" -> claude-haiku-4-20250313
        
        OpenAI:
            - "gpt-4o", "gpt-4o-mini", "gpt-4-turbo"
            - "o1", "o1-mini"
            - Any other OpenAI model name (passed through)
        
        Ollama:
            - "qwen2.5-coder" -> qwen2.5-coder:7b
            - "llama3.2" -> llama3.2:3b
            - "deepseek-coder" -> deepseek-coder-v2:16b
            - "codellama" -> codellama:13b
            - Any other Ollama model name (passed through)
    
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
    
    # Parse Anthropic models
    if provider == "anthropic":
        # Map friendly name to full model ID
        full_model_name = ANTHROPIC_MODEL_MAP.get(model_name, model_name)
        
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
            model=full_model_name,  # type: ignore[call-arg]
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
            model=model_name,
            **openai_params,
        )
    
    # Parse Ollama models
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
    
    else:
        raise ValueError(
            f"Unsupported provider '{provider}'. "
            "Supported providers: anthropic, openai, ollama"
        )

