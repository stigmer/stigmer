"""Configuration for context summarization.

This module provides the SummarizationConfig dataclass that configures
automatic context window management using LangMem's summarization capabilities.
Configuration is derived from the Model Registry to ensure model-appropriate
thresholds and economy-tier summarization models.

Design Principles:
    1. Model Registry Integration - All thresholds come from ModelRegistry
    2. Immutability - Config is frozen to prevent accidental modifications
    3. Factory Pattern - for_model() provides sensible defaults per model
    4. Fail-Safe Defaults - Works correctly even with unknown models

Example:
    >>> from graphton.core.summarization_config import SummarizationConfig
    >>> 
    >>> # Create config for a specific model
    >>> config = SummarizationConfig.for_model("claude-sonnet-4.5")
    >>> print(f"Trigger at: {config.trigger_threshold} tokens")
    Trigger at: 180000 tokens
    >>> 
    >>> # Create disabled config (for testing or opt-out)
    >>> config = SummarizationConfig.disabled()
    >>> print(config.enabled)
    False

"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from graphton.core.model_registry import TokenCounterMethod

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SummarizationConfig:
    """Configuration for automatic context summarization.
    
    This dataclass holds all configuration needed for the SummarizationMiddleware
    to manage context window size. It is frozen (immutable) to prevent accidental
    modifications during agent execution.
    
    The recommended way to create a config is via the for_model() factory method,
    which automatically derives appropriate thresholds from the Model Registry.
    
    Attributes:
        enabled: Whether summarization is active. When False, middleware is a no-op.
        context_window_tokens: Total context window size for the model in tokens.
            Used to derive the emergency overflow threshold.
        trigger_threshold: Token count at which summarization is triggered (~90% of context).
        target_tokens: Target token count after summarization (~80% of context).
        max_summary_tokens: Maximum tokens allocated for the summary itself.
        summarization_model: Model ID to use for summarization (economy-tier recommended).
        token_counter_method: Strategy for counting tokens (provider-specific).
    
    Properties:
        overflow_threshold: 95% of context_window_tokens. Emergency brake engages
            above this level when mid-execution compaction has failed.
    
    Example:
        >>> # Using the factory method (recommended)
        >>> config = SummarizationConfig.for_model("claude-sonnet-4.5")
        >>> print(config.overflow_threshold)
        190000
        >>> 
        >>> # Manual configuration (for advanced use cases)
        >>> from graphton.core.model_registry import TokenCounterMethod
        >>> config = SummarizationConfig(
        ...     enabled=True,
        ...     context_window_tokens=200000,
        ...     trigger_threshold=180000,
        ...     target_tokens=160000,
        ...     max_summary_tokens=2000,
        ...     summarization_model="claude-haiku-4.5",
        ...     token_counter_method=TokenCounterMethod.ANTHROPIC_NATIVE,
        ... )
    
    """
    
    enabled: bool
    context_window_tokens: int
    trigger_threshold: int
    target_tokens: int
    max_summary_tokens: int
    summarization_model: str
    token_counter_method: TokenCounterMethod
    
    @property
    def overflow_threshold(self) -> int:
        """Token count at which the emergency brake blocks tool execution.
        
        Computed as 95% of the model's context window. This threshold is only
        relevant when mid-execution compaction via ``awrap_model_call`` has
        failed — it prevents the model from receiving a prompt that exceeds
        the API limit.
        
        Returns:
            95% of context_window_tokens, or 0 if disabled/unknown.
        """
        return int(self.context_window_tokens * 0.95)
    
    @classmethod
    def for_model(
        cls,
        model_id: str,
        enabled: bool = True,
        *,
        trigger_threshold_override: int | None = None,
        target_tokens_override: int | None = None,
        max_summary_tokens_override: int | None = None,
        summarization_model_override: str | None = None,
    ) -> SummarizationConfig:
        """Create a SummarizationConfig with model-appropriate defaults.
        
        This factory method queries the Model Registry to determine optimal
        summarization thresholds for the given model. It selects an economy-tier
        model from the same provider for cost-effective summarization.
        
        Args:
            model_id: The primary model being used (e.g., "claude-sonnet-4.5").
                Used to determine context window size and token counting method.
            enabled: Whether summarization should be active. Default True.
            trigger_threshold_override: Override the trigger threshold from registry.
            target_tokens_override: Override the target tokens from registry.
            max_summary_tokens_override: Override the max summary tokens from registry.
            summarization_model_override: Override the summarization model selection.
        
        Returns:
            A SummarizationConfig configured for the specified model.
        
        Example:
            >>> # Standard usage - all defaults from registry
            >>> config = SummarizationConfig.for_model("claude-opus-4")
            >>> print(config.summarization_model)
            claude-haiku-4.5
            >>> 
            >>> # With overrides
            >>> config = SummarizationConfig.for_model(
            ...     "claude-sonnet-4.5",
            ...     trigger_threshold_override=150000,
            ... )
            >>> print(config.trigger_threshold)
            150000
            >>> 
            >>> # Unknown model - gets conservative defaults
            >>> config = SummarizationConfig.for_model("my-custom-model")
            >>> print(config.trigger_threshold)
            7000
        
        """
        # Import here to avoid circular dependency
        from graphton.core.model_registry import ModelRegistry
        
        # Get model metadata from registry (with fallback to defaults)
        metadata = ModelRegistry.get_or_default(model_id)
        
        # Get recommended summarization model
        summarization_model = (
            summarization_model_override
            or ModelRegistry.get_summarization_model(model_id)
        )
        
        # Compute final threshold values
        trigger_threshold = (
            trigger_threshold_override
            if trigger_threshold_override is not None
            else metadata.summarization_trigger_threshold
        )
        target_tokens = (
            target_tokens_override
            if target_tokens_override is not None
            else metadata.summarization_target_tokens
        )
        max_summary_tokens = (
            max_summary_tokens_override
            if max_summary_tokens_override is not None
            else metadata.max_summary_tokens
        )
        
        # Validate threshold relationships
        if enabled:
            if trigger_threshold <= target_tokens:
                raise ValueError(
                    f"trigger_threshold ({trigger_threshold}) must be greater than "
                    f"target_tokens ({target_tokens}). The trigger threshold is when "
                    f"summarization starts, and target_tokens is the goal after summarization."
                )
            if trigger_threshold > metadata.context_window_tokens:
                raise ValueError(
                    f"trigger_threshold ({trigger_threshold}) cannot exceed the model's "
                    f"context_window_tokens ({metadata.context_window_tokens}). "
                    f"Summarization would never be possible."
                )
            if target_tokens <= max_summary_tokens:
                raise ValueError(
                    f"target_tokens ({target_tokens}) must be greater than "
                    f"max_summary_tokens ({max_summary_tokens}). Otherwise the summary "
                    f"alone would exceed the target."
                )
        
        # Build config with validated values
        config = cls(
            enabled=enabled,
            context_window_tokens=metadata.context_window_tokens,
            trigger_threshold=trigger_threshold,
            target_tokens=target_tokens,
            max_summary_tokens=max_summary_tokens,
            summarization_model=summarization_model,
            token_counter_method=metadata.token_counter_method,
        )
        
        logger.info(
            "Created SummarizationConfig for model '%s': "
            "context_window=%d, trigger=%d, target=%d, overflow=%d, "
            "max_summary=%d, summarizer='%s'",
            model_id,
            config.context_window_tokens,
            config.trigger_threshold,
            config.target_tokens,
            config.overflow_threshold,
            config.max_summary_tokens,
            config.summarization_model,
        )
        
        return config
    
    @classmethod
    def disabled(cls) -> SummarizationConfig:
        """Create a disabled SummarizationConfig.
        
        Use this when you want to explicitly disable summarization.
        The middleware will be a no-op when given this config.
        
        Returns:
            A SummarizationConfig with enabled=False.
        
        Example:
            >>> config = SummarizationConfig.disabled()
            >>> print(config.enabled)
            False
        
        """
        # Import here to avoid circular dependency
        from graphton.core.model_registry import TokenCounterMethod
        
        return cls(
            enabled=False,
            context_window_tokens=0,
            trigger_threshold=0,
            target_tokens=0,
            max_summary_tokens=0,
            summarization_model="",
            token_counter_method=TokenCounterMethod.APPROXIMATE,
        )
    
    def should_summarize(self, current_token_count: int) -> bool:
        """Check if summarization should be triggered.
        
        Args:
            current_token_count: The current number of tokens in the conversation.
        
        Returns:
            True if summarization should be triggered, False otherwise.
        
        Example:
            >>> config = SummarizationConfig.for_model("claude-sonnet-4.5")
            >>> config.should_summarize(100000)  # Below threshold
            False
            >>> config.should_summarize(185000)  # Above threshold
            True
        
        """
        if not self.enabled:
            return False
        return current_token_count >= self.trigger_threshold
    
    def __repr__(self) -> str:
        """Return a detailed string representation."""
        return (
            f"SummarizationConfig("
            f"enabled={self.enabled}, "
            f"context_window={self.context_window_tokens}, "
            f"trigger={self.trigger_threshold}, "
            f"target={self.target_tokens}, "
            f"overflow={self.overflow_threshold}, "
            f"max_summary={self.max_summary_tokens}, "
            f"model='{self.summarization_model}'"
            f")"
        )


# Module-level exports
__all__ = ["SummarizationConfig"]
