"""Model Registry — runtime configuration for all native-harness LLM models.

Model data is fetched from the authenticated model registry API at
``{STIGMER_CLOUD_API_URL}/v1/proxy/model-registry`` and cached
in memory with a 1-hour TTL. Authentication is via the
``STIGMER_TOKEN`` environment variable (Bearer token). Falls back to
``STIGMER_AUTH_TOKEN`` for backward compatibility.

Fallback chain (in order):
    1. ``STIGMER_MODEL_REGISTRY_PATH`` env var (explicit file override)
    2. Authenticated model registry API fetch with TTL cache
    3. Conservative defaults for unknown models (8K context)

Design Principles:
    1. Single Source of Truth - All model data served by the cloud API
    2. Fail-Safe Defaults - Unknown models get conservative defaults (8K context)
    3. Cost-Aware - Summarization uses economy-tier models by default
    4. Extensible - Adding new models = updating the cloud JSON, auto-propagates
    5. Immutable - ModelMetadata is frozen to prevent accidental mutations

Example:
    >>> from graphton.core.model_registry import ModelRegistry
    >>> metadata = ModelRegistry.get("claude-sonnet-4.5")
    >>> print(f"Context window: {metadata.context_window_tokens}")
    Context window: 200000
    
    >>> # For unknown models, get conservative defaults
    >>> metadata = ModelRegistry.get_or_default("my-custom-model")
    >>> print(f"Default context: {metadata.context_window_tokens}")
    Default context: 8192

"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import ClassVar

logger = logging.getLogger(__name__)


class CostTier(Enum):
    """Cost tier classification for model selection.
    
    Cost tiers help select appropriate models for different use cases:
    - ECONOMY: Cheapest option, preferred for summarization and bulk operations
    - STANDARD: Balanced cost/quality for general use
    - PREMIUM: Highest quality, reserved for complex reasoning tasks
    
    Example:
        >>> from graphton.core.model_registry import CostTier
        >>> tier = CostTier.ECONOMY
        >>> if tier == CostTier.ECONOMY:
        ...     print("Using budget-friendly model")
        Using budget-friendly model
    
    """
    
    ECONOMY = "economy"
    STANDARD = "standard"
    PREMIUM = "premium"


class TokenCounterMethod(Enum):
    """Strategy for counting tokens in messages.
    
    Different models use different tokenization schemes. Using the correct
    token counter ensures accurate context window management and prevents
    truncation or API errors.
    
    Attributes:
        TIKTOKEN_CL100K: Used by GPT-4, GPT-3.5-turbo (cl100k_base encoding)
        TIKTOKEN_O200K: Used by GPT-4o, o1 family (o200k_base encoding)
        ANTHROPIC_NATIVE: Claude models - use Anthropic's native counting API
        APPROXIMATE: Fallback method using chars/4 heuristic
    
    Example:
        >>> from graphton.core.model_registry import TokenCounterMethod
        >>> method = TokenCounterMethod.TIKTOKEN_CL100K
        >>> if method == TokenCounterMethod.APPROXIMATE:
        ...     token_count = len(text) // 4
    
    """
    
    TIKTOKEN_CL100K = "tiktoken_cl100k"
    TIKTOKEN_O200K = "tiktoken_o200k"
    ANTHROPIC_NATIVE = "anthropic_native"
    APPROXIMATE = "approximate"


@dataclass(frozen=True, slots=True)
class ModelMetadata:
    """Immutable metadata for a supported model.
    
    This dataclass serves as the single source of truth for all model
    capabilities and configurations. The frozen=True ensures immutability,
    preventing accidental modifications after creation.
    
    Attributes:
        model_id: Platform canonical identifier (e.g., "claude-sonnet-4.5")
        api_model_id: Actual API model identifier sent to provider
            (e.g., "claude-sonnet-4-5-20250929"). If None, model_id is used.
        provider: Provider name (anthropic, openai, ollama)
        display_name: Human-readable name for UI display
        context_window_tokens: Total context window size in tokens
        max_output_tokens: Maximum tokens in a single completion
        summarization_trigger_threshold: Token count to trigger summarization (~90%)
        summarization_target_tokens: Target token count after summarization (~80%)
        max_summary_tokens: Maximum tokens allocated for the summary itself
        token_counter_method: Strategy for counting tokens
        cost_tier: Economic classification (economy/standard/premium)
        input_price_per_million: USD per 1,000,000 input tokens (None for free/local).
            Matches ``ModelUsage.input_price_per_million`` proto field.
        output_price_per_million: USD per 1,000,000 output tokens (None for free/local).
            Matches ``ModelUsage.output_price_per_million`` proto field.
        cache_creation_price_per_million: USD per 1,000,000 cache-write tokens
            (None for free/local or models without provider caching).
            Anthropic: 1.25x input price (5-minute ephemeral TTL).
            OpenAI: same as input price (automatic caching, no write premium).
            Matches ``ModelUsage.cache_creation_price_per_million`` proto field.
        cache_read_price_per_million: USD per 1,000,000 cache-read tokens
            (None for free/local or models without provider caching).
            Anthropic: 0.1x input price (90% discount).
            OpenAI: 0.5x input price (50% discount).
            Matches ``ModelUsage.cache_read_price_per_million`` proto field.
        supports_tool_use: Whether the model supports function/tool calling
        supports_vision: Whether the model can process images
        supports_streaming: Whether the model supports streaming responses
        supports_thinking: Whether the model supports Anthropic's manual extended
            thinking (``type: "enabled"`` with ``budget_tokens``).
        supports_adaptive_thinking: Whether the model supports Anthropic's
            adaptive extended thinking (``type: "adaptive"`` with ``effort``).
            Mutually exclusive with ``supports_thinking``; Opus 4.6 uses
            adaptive thinking while earlier models use manual thinking.
    
    Example:
        >>> metadata = ModelMetadata(
        ...     model_id="claude-sonnet-4.5",
        ...     api_model_id="claude-sonnet-4-5-20250929",
        ...     provider="anthropic",
        ...     display_name="Claude Sonnet 4.5",
        ...     context_window_tokens=200000,
        ...     max_output_tokens=65536,
        ...     summarization_trigger_threshold=180000,
        ...     summarization_target_tokens=160000,
        ...     max_summary_tokens=2000,
        ...     token_counter_method=TokenCounterMethod.ANTHROPIC_NATIVE,
        ...     cost_tier=CostTier.STANDARD,
        ...     input_price_per_million=3.0,
        ...     output_price_per_million=15.0,
        ...     cache_creation_price_per_million=3.75,
        ...     cache_read_price_per_million=0.30,
        ... )
        >>> metadata.context_window_tokens
        200000
        >>> metadata.get_api_model_id()
        'claude-sonnet-4-5-20250929'
    
    """
    
    # Identity
    model_id: str
    provider: str
    display_name: str
    
    # Context Window
    context_window_tokens: int
    max_output_tokens: int
    
    # Summarization Thresholds
    summarization_trigger_threshold: int
    summarization_target_tokens: int
    max_summary_tokens: int
    
    # Token Counting
    token_counter_method: TokenCounterMethod
    
    # Economics
    cost_tier: CostTier
    
    # API Model ID - actual identifier sent to provider API
    # If None, model_id is used as the API identifier
    # Example: model_id="claude-sonnet-4.5" -> api_model_id="claude-sonnet-4-5-20250929"
    api_model_id: str | None = None
    
    input_price_per_million: float | None = None
    output_price_per_million: float | None = None
    cache_creation_price_per_million: float | None = None
    cache_read_price_per_million: float | None = None
    
    # Capabilities
    supports_tool_use: bool = True
    supports_vision: bool = False
    supports_streaming: bool = True
    supports_thinking: bool = False
    supports_adaptive_thinking: bool = False
    
    def get_api_model_id(self) -> str:
        """Get the API model identifier to use when calling the provider.
        
        Returns the api_model_id if set, otherwise falls back to model_id.
        This allows platform-friendly names while sending correct IDs to APIs.
        
        Returns:
            The model identifier to send to the provider API.
        
        Example:
            >>> metadata = ModelRegistry.get("claude-sonnet-4.5")
            >>> metadata.get_api_model_id()
            'claude-sonnet-4-5-20250929'
            >>> 
            >>> # For models without mapping, returns model_id
            >>> metadata = ModelRegistry.get("gpt-4o")
            >>> metadata.get_api_model_id()
            'gpt-4o'
        
        """
        return self.api_model_id if self.api_model_id is not None else self.model_id


# Default metadata for unknown models - conservative 8K context
_DEFAULT_METADATA = ModelMetadata(
    model_id="unknown",
    provider="unknown",
    display_name="Unknown Model",
    context_window_tokens=8192,
    max_output_tokens=4096,
    summarization_trigger_threshold=7000,
    summarization_target_tokens=6000,
    max_summary_tokens=500,
    token_counter_method=TokenCounterMethod.APPROXIMATE,
    cost_tier=CostTier.ECONOMY,
)


class ModelRegistry:
    """Central registry for all supported model metadata.
    
    This class provides a singleton-like interface (via class methods) for
    accessing model metadata. All methods are class methods - no instantiation
    is needed or recommended.
    
    Design Principles:
        1. Single Source of Truth - All model metadata lives here
        2. Fail-Safe Defaults - Unknown models get conservative defaults
        3. Cost-Aware - Summarization uses economy-tier models by default
        4. Extensible - Adding new models = adding one entry to _MODELS
    
    Example:
        >>> from graphton.core.model_registry import ModelRegistry
        >>> 
        >>> # Get metadata for a known model
        >>> metadata = ModelRegistry.get("claude-sonnet-4.5")
        >>> print(metadata.context_window_tokens)
        200000
        >>> 
        >>> # Get metadata with fallback for unknown models
        >>> metadata = ModelRegistry.get_or_default("custom-model", provider="anthropic")
        >>> print(metadata.context_window_tokens)
        8192
        >>> 
        >>> # Get the recommended summarization model
        >>> summarizer = ModelRegistry.get_summarization_model("claude-opus-4")
        >>> print(summarizer)
        claude-haiku-4.5
    
    """
    
    # Mapping from provider to default economy-tier summarization model
    _DEFAULT_SUMMARIZATION_MODELS: ClassVar[dict[str, str | None]] = {
        "anthropic": "claude-haiku-4.5",
        "openai": "gpt-4o-mini",
        "ollama": None,  # Use same model - local models have no cost
    }
    
    _TOKEN_COUNTER_MAP: ClassVar[dict[str, TokenCounterMethod]] = {
        "anthropic_native": TokenCounterMethod.ANTHROPIC_NATIVE,
        "tiktoken_cl100k": TokenCounterMethod.TIKTOKEN_CL100K,
        "tiktoken_o200k": TokenCounterMethod.TIKTOKEN_O200K,
        "approximate": TokenCounterMethod.APPROXIMATE,
    }

    _COST_TIER_MAP: ClassVar[dict[str, CostTier]] = {
        "economy": CostTier.ECONOMY,
        "standard": CostTier.STANDARD,
        "premium": CostTier.PREMIUM,
    }

    _MODELS: ClassVar[dict[str, ModelMetadata]] = {}
    _MODELS_LOADED: ClassVar[bool] = False

    _DEFAULT_API_URL: ClassVar[str] = "https://api.stigmer.ai"
    _CACHE_TTL: ClassVar[float] = 3600.0  # 1 hour
    _cache_text: ClassVar[str | None] = None
    _cache_expires_at: ClassVar[float] = 0.0

    @classmethod
    def _load_registry_text(cls) -> str | None:
        """Fetch model-registry.json with TTL caching.

        Priority:
        1. STIGMER_MODEL_REGISTRY_PATH env var (offline/air-gapped override)
        2. In-memory cache (if still fresh)
        3. Public model registry API fetch
        """
        env_path = os.environ.get("STIGMER_MODEL_REGISTRY_PATH")
        if env_path:
            path = Path(env_path)
            if path.is_file():
                logger.info("Loading model-registry.json from STIGMER_MODEL_REGISTRY_PATH: %s", path)
                return path.read_text(encoding="utf-8")

        if cls._cache_text is not None and time.monotonic() < cls._cache_expires_at:
            return cls._cache_text

        api_url = os.environ.get("STIGMER_CLOUD_API_URL", cls._DEFAULT_API_URL)
        url = f"{api_url}/v1/proxy/model-registry"
        try:
            headers = {"Accept": "application/json"}
            auth_token = os.environ.get("STIGMER_TOKEN") or os.environ.get("STIGMER_AUTH_TOKEN")
            if auth_token:
                headers["Authorization"] = f"Bearer {auth_token}"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                text = resp.read().decode("utf-8")
                cls._cache_text = text
                cls._cache_expires_at = time.monotonic() + cls._CACHE_TTL
                logger.info("Fetched model registry from API (%d bytes)", len(text))
                return text
        except Exception as exc:
            if cls._cache_text is not None:
                logger.warning(
                    "API fetch failed (%s), using stale cache", exc,
                )
                return cls._cache_text
            logger.warning(
                "Failed to fetch model registry from %s: %s", url, exc,
            )
            return None

    @classmethod
    def _ensure_loaded(cls) -> None:
        """Build _MODELS from the registry (native harness entries only).

        Re-fetches when the API cache TTL has expired so long-running
        processes pick up model changes without a restart.
        """
        cache_fresh = cls._cache_text is not None and time.monotonic() < cls._cache_expires_at
        if cls._MODELS_LOADED and cache_fresh:
            return

        registry_text = cls._load_registry_text()
        if registry_text is None:
            cls._MODELS_LOADED = True
            return

        try:
            registry = json.loads(registry_text)
        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse model-registry.json: %s", exc)
            cls._MODELS_LOADED = True
            return

        new_models: dict[str, ModelMetadata] = {}
        for entry in registry.get("models", []):
            model_id = entry.get("id")
            if not model_id or entry.get("harness") != "native":
                continue

            pricing = entry.get("pricing", {})
            summarization = entry.get("summarization", {})
            capabilities = entry.get("capabilities", {})

            new_models[model_id] = ModelMetadata(
                model_id=model_id,
                provider=entry.get("provider", "unknown"),
                display_name=entry.get("displayName", model_id),
                context_window_tokens=entry.get("contextWindowTokens", 8192),
                max_output_tokens=entry.get("maxOutputTokens", 4096),
                summarization_trigger_threshold=summarization.get("triggerThreshold", 7000),
                summarization_target_tokens=summarization.get("targetTokens", 6000),
                max_summary_tokens=summarization.get("maxSummaryTokens", 500),
                token_counter_method=cls._TOKEN_COUNTER_MAP.get(
                    entry.get("tokenCounterMethod", "approximate"),
                    TokenCounterMethod.APPROXIMATE,
                ),
                cost_tier=cls._COST_TIER_MAP.get(
                    entry.get("costTier", "economy"), CostTier.ECONOMY,
                ),
                api_model_id=entry.get("apiModelId"),
                input_price_per_million=pricing.get("inputPricePerMillion"),
                output_price_per_million=pricing.get("outputPricePerMillion"),
                cache_creation_price_per_million=pricing.get("cacheWritePricePerMillion"),
                cache_read_price_per_million=pricing.get("cacheReadPricePerMillion"),
                supports_tool_use=capabilities.get("toolUse", True),
                supports_vision=capabilities.get("vision", False),
                supports_streaming=capabilities.get("streaming", True),
                supports_thinking=capabilities.get("thinking", False),
                supports_adaptive_thinking=capabilities.get("adaptiveThinking", False),
            )

        cls._MODELS = new_models
        cls._API_MODEL_ID_INDEX = None  # invalidate reverse index
        cls._MODELS_LOADED = True
    
    _API_MODEL_ID_INDEX: ClassVar[dict[str, ModelMetadata] | None] = None
    
    @classmethod
    def _ensure_api_model_id_index(cls) -> dict[str, ModelMetadata]:
        cls._ensure_loaded()
        """Build (once) and return the reverse index from API model IDs to metadata.
        
        The index maps every identifier a provider might return at runtime
        back to the canonical ``ModelMetadata``.  Three sources are merged:
        
        1. Explicit ``api_model_id`` values (e.g. ``claude-sonnet-4-6``).
        2. Platform ``model_id`` keys (e.g. ``claude-sonnet-4.6``).
        3. For entries where ``api_model_id is None`` the ``model_id``
           doubles as the API identifier (Ollama, some OpenAI models).
        
        When a platform ``model_id`` collides with an ``api_model_id`` the
        explicit ``api_model_id`` wins so the fast-path ``get(model_id)``
        remains authoritative for platform lookups.
        """
        if cls._API_MODEL_ID_INDEX is not None:
            return cls._API_MODEL_ID_INDEX
        
        index: dict[str, ModelMetadata] = {}
        for metadata in cls._MODELS.values():
            # Every model_id is also a valid lookup key
            index[metadata.model_id] = metadata
            if metadata.api_model_id is not None:
                # Explicit API ID overrides any collision with model_id
                index[metadata.api_model_id] = metadata
        
        cls._API_MODEL_ID_INDEX = index
        return index
    
    @classmethod
    def get_by_api_model_id(cls, api_model_id: str) -> ModelMetadata | None:
        """Look up metadata by the model identifier a provider returns at runtime.
        
        Provider responses contain API-level model IDs (e.g.
        ``claude-sonnet-4-6``, ``gpt-4o-2024-08-06``) rather than
        platform-canonical IDs (``claude-sonnet-4.6``, ``gpt-4o``).
        This method resolves either form to the registry entry in O(1)
        via a lazily-built reverse index.
        
        Args:
            api_model_id: Model identifier from a provider response or
                a platform-canonical model ID.
        
        Returns:
            The matching ``ModelMetadata``, or ``None`` if no entry
            matches.
        
        Example:
            >>> # By API model ID
            >>> m = ModelRegistry.get_by_api_model_id("claude-sonnet-4-6")
            >>> m.model_id
            'claude-sonnet-4.6'
            >>> 
            >>> # By platform model ID (also works)
            >>> m = ModelRegistry.get_by_api_model_id("gpt-4o")
            >>> m.provider
            'openai'
            >>> 
            >>> # Unknown returns None
            >>> ModelRegistry.get_by_api_model_id("unknown-model-xyz") is None
            True
        
        """
        return cls._ensure_api_model_id_index().get(api_model_id)
    
    @classmethod
    def get(cls, model_id: str) -> ModelMetadata:
        """Get metadata for a registered model.
        
        Args:
            model_id: The canonical model identifier (e.g., "claude-sonnet-4.5")
        
        Returns:
            ModelMetadata for the requested model
        
        Raises:
            KeyError: If the model is not registered. Use get_or_default()
                for graceful fallback behavior.
        
        Example:
            >>> metadata = ModelRegistry.get("claude-sonnet-4.5")
            >>> print(metadata.context_window_tokens)
            200000
            >>> 
            >>> # Unknown models raise KeyError
            >>> try:
            ...     ModelRegistry.get("unknown-model")
            ... except KeyError as e:
            ...     print("Model not found")
            Model not found
        
        """
        cls._ensure_loaded()
        if model_id not in cls._MODELS:
            available = ", ".join(sorted(cls._MODELS.keys()))
            raise KeyError(
                f"Model '{model_id}' not found in registry. "
                f"Available models: {available}. "
                f"Use get_or_default() for graceful fallback to defaults."
            )
        return cls._MODELS[model_id]
    
    @classmethod
    def get_or_default(
        cls,
        model_id: str,
        provider: str = "unknown",
    ) -> ModelMetadata:
        """Get metadata for a model, with fallback to conservative defaults.
        
        This method provides graceful degradation for unknown or custom models.
        When a model is not in the registry, it returns conservative defaults
        (8K context window, economy tier, approximate token counting).
        
        Args:
            model_id: The model identifier to look up
            provider: Provider hint for unknown models (used in returned metadata)
        
        Returns:
            ModelMetadata for the model, or defaults if not registered
        
        Example:
            >>> # Known model returns actual metadata
            >>> metadata = ModelRegistry.get_or_default("claude-sonnet-4.5")
            >>> print(metadata.context_window_tokens)
            200000
            >>> 
            >>> # Unknown model returns conservative defaults
            >>> metadata = ModelRegistry.get_or_default("my-custom-model", provider="anthropic")
            >>> print(metadata.context_window_tokens)
            8192
            >>> print(metadata.provider)
            anthropic
        
        """
        cls._ensure_loaded()
        if model_id in cls._MODELS:
            return cls._MODELS[model_id]
        
        logger.warning(
            "Model '%s' not found in registry, using conservative defaults "
            "(8K context window, economy tier)",
            model_id,
        )
        
        # Return defaults with the provided model_id and provider
        return ModelMetadata(
            model_id=model_id,
            provider=provider,
            display_name=f"Unknown Model ({model_id})",
            context_window_tokens=_DEFAULT_METADATA.context_window_tokens,
            max_output_tokens=_DEFAULT_METADATA.max_output_tokens,
            summarization_trigger_threshold=_DEFAULT_METADATA.summarization_trigger_threshold,
            summarization_target_tokens=_DEFAULT_METADATA.summarization_target_tokens,
            max_summary_tokens=_DEFAULT_METADATA.max_summary_tokens,
            token_counter_method=_DEFAULT_METADATA.token_counter_method,
            cost_tier=_DEFAULT_METADATA.cost_tier,
        )
    
    @classmethod
    def resolve(cls, user_input: str) -> tuple[str, ModelMetadata]:
        """Resolve user input to an API model ID and metadata.
        
        This method accepts various forms of model identifiers and resolves them
        to the canonical API model ID that should be sent to the provider.
        
        Resolution priority:
            1. Exact match on model_id (e.g., "claude-sonnet-4.5")
            2. Exact match on api_model_id (e.g., "claude-sonnet-4-5-20250929")
            3. Case-insensitive match on model_id with normalization
        
        Args:
            user_input: The model identifier provided by the user. Can be:
                - Platform canonical ID: "claude-sonnet-4.5"
                - Full API model ID: "claude-sonnet-4-5-20250929"
                - Case variations: "Claude-Sonnet-4.5", "CLAUDE-SONNET-4.5"
        
        Returns:
            A tuple of (api_model_id, ModelMetadata) where api_model_id is the
            identifier to send to the provider API.
        
        Raises:
            KeyError: If no matching model is found in the registry.
        
        Example:
            >>> api_id, metadata = ModelRegistry.resolve("claude-sonnet-4.5")
            >>> print(api_id)
            claude-sonnet-4-5-20250929
            >>> print(metadata.display_name)
            Claude Sonnet 4.5
            >>> 
            >>> # Also accepts full API IDs
            >>> api_id, metadata = ModelRegistry.resolve("claude-sonnet-4-5-20250929")
            >>> print(api_id)
            claude-sonnet-4-5-20250929
            >>> 
            >>> # Case-insensitive matching
            >>> api_id, _ = ModelRegistry.resolve("Claude-Sonnet-4.5")
            >>> print(api_id)
            claude-sonnet-4-5-20250929
        
        """
        if not user_input or not user_input.strip():
            raise KeyError("Model identifier cannot be empty")
        
        user_input = user_input.strip()
        cls._ensure_loaded()
        
        # Priority 1: Exact match on model_id
        if user_input in cls._MODELS:
            metadata = cls._MODELS[user_input]
            return (metadata.get_api_model_id(), metadata)
        
        # Priority 2: Exact match on api_model_id
        for metadata in cls._MODELS.values():
            if metadata.api_model_id is not None and metadata.api_model_id == user_input:
                return (metadata.get_api_model_id(), metadata)
        
        # Priority 3: Case-insensitive match on model_id
        user_input_lower = user_input.lower()
        for model_id, metadata in cls._MODELS.items():
            if model_id.lower() == user_input_lower:
                logger.debug(
                    "Resolved '%s' to '%s' via case-insensitive match",
                    user_input,
                    model_id,
                )
                return (metadata.get_api_model_id(), metadata)
        
        # No match found
        available = ", ".join(sorted(cls._MODELS.keys()))
        raise KeyError(
            f"Model '{user_input}' not found in registry. "
            f"Available models: {available}. "
            f"Use a registered model_id or api_model_id."
        )
    
    @classmethod
    def resolve_or_passthrough(
        cls,
        user_input: str,
        provider: str = "unknown",
    ) -> tuple[str, ModelMetadata]:
        """Resolve user input, or pass through unknown models.
        
        Like resolve(), but for unknown models returns the input as-is
        along with default metadata. This allows using custom/unlisted models
        while still benefiting from resolution for known models.
        
        Args:
            user_input: The model identifier provided by the user.
            provider: Provider hint for unknown models.
        
        Returns:
            A tuple of (api_model_id, ModelMetadata). For unknown models,
            api_model_id equals user_input.
        
        Example:
            >>> # Known model gets resolved
            >>> api_id, _ = ModelRegistry.resolve_or_passthrough("claude-sonnet-4.5")
            >>> print(api_id)
            claude-sonnet-4-5-20250929
            >>> 
            >>> # Unknown model passes through
            >>> api_id, metadata = ModelRegistry.resolve_or_passthrough("my-custom-model")
            >>> print(api_id)
            my-custom-model
            >>> print(metadata.context_window_tokens)
            8192
        
        """
        try:
            return cls.resolve(user_input)
        except KeyError:
            logger.warning(
                "Model '%s' not found in registry, passing through as-is",
                user_input,
            )
            metadata = cls.get_or_default(user_input, provider=provider)
            return (user_input, metadata)
    
    @classmethod
    def get_summarization_model(cls, primary_model: str) -> str:
        """Get the recommended summarization model for a primary model.
        
        Summarization should use a cost-effective model to minimize expenses.
        This method selects an economy-tier model from the same provider:
        - Anthropic models → claude-haiku-4.5
        - OpenAI models → gpt-4o-mini
        - Ollama models → same model (local, no cost)
        
        Args:
            primary_model: The primary model being used for the agent
        
        Returns:
            Model ID of the recommended summarization model
        
        Example:
            >>> summarizer = ModelRegistry.get_summarization_model("claude-opus-4")
            >>> print(summarizer)
            claude-haiku-4.5
            >>> 
            >>> summarizer = ModelRegistry.get_summarization_model("gpt-4")
            >>> print(summarizer)
            gpt-4o-mini
            >>> 
            >>> # Ollama models use themselves (no cost)
            >>> summarizer = ModelRegistry.get_summarization_model("qwen2.5-coder:7b")
            >>> print(summarizer)
            qwen2.5-coder:7b
        
        """
        # Get metadata for the primary model
        metadata = cls.get_or_default(primary_model)
        provider = metadata.provider
        
        # Look up the default summarization model for this provider
        default_summarizer = cls._DEFAULT_SUMMARIZATION_MODELS.get(provider)
        
        if default_summarizer is None:
            # No default summarizer (e.g., Ollama) - use same model
            logger.debug(
                "No default summarization model for provider '%s', using primary model '%s'",
                provider,
                primary_model,
            )
            return primary_model
        
        logger.debug(
            "Selected summarization model '%s' for primary model '%s' (provider: %s)",
            default_summarizer,
            primary_model,
            provider,
        )
        return default_summarizer
    
    @classmethod
    def list_by_provider(cls, provider: str) -> list[ModelMetadata]:
        """List all models for a specific provider.
        
        Args:
            provider: Provider name (anthropic, openai, ollama)
        
        Returns:
            List of ModelMetadata for all models from the provider,
            sorted by model_id for consistent ordering
        
        Example:
            >>> anthropic_models = ModelRegistry.list_by_provider("anthropic")
            >>> for m in anthropic_models:
            ...     print(f"{m.model_id}: {m.cost_tier.value}")
            claude-haiku-3.5: economy
            claude-haiku-4.5: economy
            claude-opus-4: premium
            claude-sonnet-3.5: standard
            claude-sonnet-4.5: standard
        
        """
        cls._ensure_loaded()
        models = [
            metadata
            for metadata in cls._MODELS.values()
            if metadata.provider == provider
        ]
        return sorted(models, key=lambda m: m.model_id)
    
    @classmethod
    def list_all(cls) -> list[ModelMetadata]:
        """List all registered models.
        
        Returns:
            List of all ModelMetadata, sorted by provider then model_id
        
        Example:
            >>> all_models = ModelRegistry.list_all()
            >>> print(f"Total models: {len(all_models)}")
            Total models: 22
        
        """
        cls._ensure_loaded()
        return sorted(
            cls._MODELS.values(),
            key=lambda m: (m.provider, m.model_id),
        )
    
    @classmethod
    def is_registered(cls, model_id: str) -> bool:
        """Check if a model is registered in the registry.
        
        Args:
            model_id: The model identifier to check
        
        Returns:
            True if the model is registered, False otherwise
        
        Example:
            >>> ModelRegistry.is_registered("claude-sonnet-4.5")
            True
            >>> ModelRegistry.is_registered("unknown-model")
            False
        
        """
        cls._ensure_loaded()
        return model_id in cls._MODELS
    
    @classmethod
    def list_providers(cls) -> list[str]:
        """List all unique providers in the registry.
        
        Returns:
            Sorted list of provider names
        
        Example:
            >>> providers = ModelRegistry.list_providers()
            >>> print(providers)
            ['anthropic', 'ollama', 'openai']
        
        """
        cls._ensure_loaded()
        providers = {metadata.provider for metadata in cls._MODELS.values()}
        return sorted(providers)
    
    @classmethod
    def get_economy_models(cls) -> list[ModelMetadata]:
        """Get all economy-tier models, useful for cost-conscious operations.
        
        Returns:
            List of economy-tier models, sorted by provider then model_id
        
        Example:
            >>> economy = ModelRegistry.get_economy_models()
            >>> for m in economy:
            ...     print(f"{m.model_id} ({m.provider})")
            claude-haiku-3.5 (anthropic)
            claude-haiku-4.5 (anthropic)
            ...
        
        """
        cls._ensure_loaded()
        models = [
            metadata
            for metadata in cls._MODELS.values()
            if metadata.cost_tier == CostTier.ECONOMY
        ]
        return sorted(models, key=lambda m: (m.provider, m.model_id))


# Module-level exports
__all__ = [
    "CostTier",
    "TokenCounterMethod",
    "ModelMetadata",
    "ModelRegistry",
]
