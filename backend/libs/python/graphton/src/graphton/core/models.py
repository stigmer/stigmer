"""Model string parser for Graphton.

This module provides utilities to parse model name strings into LangChain model instances,
eliminating boilerplate for model instantiation and providing sensible defaults.
"""

from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

# Model name mapping for Anthropic models (friendly name -> full model ID)
ANTHROPIC_MODEL_MAP = {
    "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
    "claude-opus-4": "claude-opus-4-20250514",
    "claude-haiku-4": "claude-haiku-4-20250313",
}

# Default parameters for different providers
ANTHROPIC_DEFAULTS = {
    "max_tokens": 20000,  # Deep Agents need high token limits for reasoning
}


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
    
    Args:
        model: Model name string (e.g., "claude-sonnet-4.5", "gpt-4o")
        max_tokens: Override default max_tokens for the model
        temperature: Override default temperature for the model
        **model_kwargs: Additional model-specific parameters
    
    Returns:
        LangChain model instance (ChatAnthropic or ChatOpenAI)
    
    Raises:
        ValueError: If model string format is invalid or unsupported
    
    Examples:
        >>> model = parse_model_string("claude-sonnet-4.5")
        >>> model = parse_model_string("gpt-4o", temperature=0.7)
        >>> model = parse_model_string("claude-opus-4", max_tokens=10000)
    
    """
    if not model or not model.strip():
        raise ValueError("Model name cannot be empty")
    
    model = model.strip()
    
    # Handle provider-prefixed format (e.g., "anthropic:claude-sonnet-4.5")
    if ":" in model:
        provider, model_name = model.split(":", 1)
        provider = provider.lower()
        model_name = model_name.strip()
    else:
        model_name = model
        # Infer provider from model name
        if model_name.startswith("claude"):
            provider = "anthropic"
        elif model_name.startswith("gpt") or model_name.startswith("o1"):
            provider = "openai"
        else:
            raise ValueError(
                f"Cannot infer provider from model name '{model}'. "
                "Use provider prefix (e.g., 'anthropic:model-name' or 'openai:model-name') "
                "or use a standard model name (claude-*, gpt-*, o1-*)"
            )
    
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
    
    else:
        raise ValueError(
            f"Unsupported provider '{provider}'. "
            "Supported providers: anthropic, openai"
        )

