"""Model string parser for Graphton.

This module provides utilities to parse model name strings into LangChain model instances,
eliminating boilerplate for model instantiation and providing sensible defaults.

Model name resolution is handled by ModelRegistry, which provides the single source of
truth for mapping platform-friendly names to actual API model IDs.
"""

import logging
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from pydantic import PrivateAttr

from graphton.core.model_registry import ModelRegistry

logger = logging.getLogger(__name__)

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

# Token budget for Anthropic's native extended thinking (manual mode).
# Used by models that support ``supports_thinking`` (e.g. Sonnet 4.6).
# Must be less than max_tokens (20,000 > 16,000 ✓).
# Claude may use fewer tokens than the budget for simpler tasks.
DEFAULT_THINKING_BUDGET = 16_000

# Effort level for Anthropic's adaptive thinking (Opus 4.6, Sonnet 4.6).
# Passed via ``output_config.effort`` in the API request.
# Valid values: "low", "medium", "high", "max" (max is Opus 4.6 only).
# "high" produces thorough, multi-step reasoning comparable to Cursor-class
# coding agents.  Use "medium" only if cost is a primary constraint.
DEFAULT_THINKING_EFFORT = "high"

OLLAMA_DEFAULTS = {
    "base_url": "http://localhost:11434",
    "temperature": 0.0,
}


_CACHE_CONTROL_EPHEMERAL: dict[str, str] = {"type": "ephemeral"}


class _EagerToolStreamingChatAnthropic(ChatAnthropic):  # type: ignore[override]
    """ChatAnthropic subclass that patches the API payload for features not yet
    exposed by langchain-anthropic (as of 1.3.3).

    Injected patches:
        1. ``eager_input_streaming: true`` on each tool definition — disables
           Anthropic's argument-buffering so tool-argument tokens stream in
           real-time.
        2. ``output_config.effort`` — controls how aggressively Claude spends
           tokens (required for adaptive thinking on Opus 4.6 / Sonnet 4.6).
        3. Prompt caching — explicit ``cache_control`` breakpoints on the system
           prompt and last tool definition cache the static prefix; a top-level
           ``cache_control`` enables automatic conversation caching so the
           growing message history is incrementally cached across turns.
           Cache reads cost 0.1x; break-even at 2 calls.

    See:
        - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/fine-grained-tool-streaming
        - https://docs.anthropic.com/en/docs/build-with-claude/effort
        - https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
    """

    _effort: str | None = PrivateAttr(default=None)
    _prompt_caching: bool = PrivateAttr(default=True)

    def _get_request_payload(
        self,
        input_: Any,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        for tool in payload.get("tools", ()):
            if isinstance(tool, dict) and "input_schema" in tool:
                tool["eager_input_streaming"] = True
        if self._effort is not None:
            payload["output_config"] = {"effort": self._effort}
        if self._prompt_caching:
            _inject_cache_control(payload)
        return payload


def _inject_cache_control(payload: dict) -> None:
    """Add prompt-caching directives to an Anthropic API payload.

    Three layers of caching, each independent:

    Layer 1 — **system prompt** (explicit breakpoint): converts a string
    system prompt to a content-block list and marks the last block.

    Layer 2 — **tool definitions** (explicit breakpoint): marks the last
    tool definition so the full tool schema prefix is cached.

    Layer 3 — **conversation history** (automatic): sets ``cache_control``
    via ``extra_body`` so Anthropic automatically caches the growing
    message history and advances the breakpoint each turn.  Using
    ``extra_body`` ensures compatibility with SDK versions that don't
    expose ``cache_control`` as a first-class kwarg.

    Layers 1 and 2 create stable, independent cache entries for content
    that rarely changes within an execution.  Layer 3 handles the
    dynamic conversation, where the prefix grows with each model call.

    The function mutates *payload* in place.  It is idempotent — explicit
    breakpoints are not overwritten, and the top-level key is set only
    once.
    """
    # --- Layer 1: system prompt ---
    system = payload.get("system")
    if isinstance(system, str) and system:
        payload["system"] = [
            {"type": "text", "text": system, "cache_control": _CACHE_CONTROL_EPHEMERAL},
        ]
    elif isinstance(system, list) and system:
        last_block = system[-1]
        if isinstance(last_block, dict) and "cache_control" not in last_block:
            last_block["cache_control"] = _CACHE_CONTROL_EPHEMERAL

    # --- Layer 2: tool definitions ---
    tools = payload.get("tools")
    if isinstance(tools, list) and tools:
        last_tool = tools[-1]
        if isinstance(last_tool, dict) and "cache_control" not in last_tool:
            last_tool["cache_control"] = _CACHE_CONTROL_EPHEMERAL

    # --- Layer 3: automatic conversation caching ---
    # Use extra_body so this works with anthropic SDK versions that don't yet
    # expose cache_control as a first-class kwarg on messages.create().
    extra = payload.setdefault("extra_body", {})
    if isinstance(extra, dict) and "cache_control" not in extra:
        extra["cache_control"] = _CACHE_CONTROL_EPHEMERAL


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
    api_model_id, metadata = ModelRegistry.resolve_or_passthrough(
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
        
        # Enable native extended thinking for models that support manual mode.
        # Anthropic's API rejects temperature and top_k when thinking is active,
        # so we strip those parameters.  If the caller already supplied an
        # explicit ``thinking`` config via model_kwargs, we respect it.
        effort: str | None = None
        if metadata.supports_thinking and "thinking" not in model_params:
            model_params["thinking"] = {
                "type": "enabled",
                "budget_tokens": DEFAULT_THINKING_BUDGET,
            }
            if "temperature" in model_params:
                logger.warning(
                    "Removing temperature=%s (incompatible with extended thinking)",
                    model_params["temperature"],
                )
                del model_params["temperature"]
            model_params.pop("top_k", None)
        elif metadata.supports_adaptive_thinking and "thinking" not in model_params:
            model_params["thinking"] = {"type": "adaptive"}
            effort = DEFAULT_THINKING_EFFORT
            if "temperature" in model_params:
                logger.warning(
                    "Removing temperature=%s (incompatible with extended thinking)",
                    model_params["temperature"],
                )
                del model_params["temperature"]
            model_params.pop("top_k", None)
        
        instance = _EagerToolStreamingChatAnthropic(
            model=api_model_id,  # type: ignore[call-arg]
            **model_params,
        )
        if effort is not None:
            instance._effort = effort
        return instance
    
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

