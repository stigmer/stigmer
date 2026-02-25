"""Context summarization middleware for autonomous agents.

This middleware implements automatic context window management using LangMem's
summarization capabilities. It monitors token counts and triggers summarization
when the context approaches the model's limit.

Key Features:
    - Automatic summarization at configurable thresholds
    - Running summary persistence across invocations
    - Cost-effective summarization using economy-tier models
    - Message ID generation for LangMem compatibility
    - Graceful fallback when summarization fails
    - Callback support for external observability (StatusBuilder integration)

Design Principles:
    1. Non-Blocking - Summarization runs before agent execution
    2. State Persistence - Running summary stored in checkpointer state
    3. Fail-Safe - Agent continues even if summarization fails
    4. Observable - Comprehensive logging and callback support

Example:
    >>> from graphton.core.summarization_middleware import ContextSummarizationMiddleware
    >>> from graphton.core.summarization_config import SummarizationConfig
    >>> 
    >>> config = SummarizationConfig.for_model("claude-sonnet-4.5")
    >>> middleware = ContextSummarizationMiddleware(config=config)
    >>> # Middleware is typically injected by create_deep_agent()

Example with callback:
    >>> from graphton.core.summarization_callback import SummarizationCallback
    >>>
    >>> class MyCallback:
    ...     def on_summarization_complete(self, event):
    ...         print(f"Summarized: {event.tokens_before} -> {event.tokens_after}")
    ...     def on_token_count_updated(self, token_count):
    ...         print(f"Token count: {token_count}")
    >>>
    >>> middleware = ContextSummarizationMiddleware(config=config, callback=MyCallback())

"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.runtime import Runtime

from graphton.core.message_utils import (
    create_summary_system_message,
    deserialize_running_summary,
    ensure_message_ids,
    extract_summary_from_result,
    serialize_running_summary,
)
from graphton.core.summarization_callback import (
    SummarizationCallback,
    SummarizationEventData,
)
from graphton.core.token_counter import TokenCounter

if TYPE_CHECKING:
    from langchain_core.language_models import BaseChatModel
    from langmem.short_term import RunningSummary

    from graphton.core.summarization_config import SummarizationConfig

logger = logging.getLogger(__name__)

# Key for storing running summary in checkpointer state
RUNNING_SUMMARY_STATE_KEY = "_context_running_summary"


class ContextSummarizationMiddleware(AgentMiddleware):
    """Middleware for automatic context summarization.
    
    This middleware monitors the token count of the conversation and triggers
    summarization when it exceeds the configured threshold. It follows the
    same lifecycle pattern as LoopDetectionMiddleware:
    
    - abefore_agent: Check token count, summarize if needed
    - aafter_step: (Not used currently, reserved for mid-execution summarization)
    - aafter_agent: Store updated running_summary in state
    
    The middleware uses LangMem's summarize_messages() function with a
    running summary to avoid re-summarizing already summarized content.
    
    Note:
        This class is named ContextSummarizationMiddleware (not SummarizationMiddleware)
        to avoid name collision with DeepAgents' auto-injected SummarizationMiddleware.
        Both can coexist in the middleware stack without conflict.
    
    Attributes:
        config: SummarizationConfig with thresholds and model settings
        callback: Optional callback for reporting summarization events
        _running_summary: LangMem RunningSummary object (persisted in state), or None
        _summarization_count: Number of times summarization was triggered
        _last_summarization_time: Timestamp of last summarization
    
    Example:
        >>> from graphton.core.summarization_config import SummarizationConfig
        >>> 
        >>> config = SummarizationConfig.for_model("claude-opus-4")
        >>> middleware = ContextSummarizationMiddleware(config=config)
        >>> 
        >>> # Middleware is added to middleware_list in create_deep_agent()
    
    Example with callback:
        >>> class StatusBuilder:
        ...     def on_summarization_complete(self, event):
        ...         self._events.append(event)
        ...     def on_token_count_updated(self, count):
        ...         self._token_count = count
        >>>
        >>> middleware = ContextSummarizationMiddleware(
        ...     config=config,
        ...     callback=StatusBuilder(),
        ... )
    
    """
    
    def __init__(
        self,
        config: SummarizationConfig,
        callback: SummarizationCallback | None = None,
    ) -> None:
        """Initialize the summarization middleware.
        
        Args:
            config: SummarizationConfig with thresholds and model settings.
            callback: Optional callback for reporting summarization events.
                If provided, on_summarization_complete() is called after
                each successful summarization, and on_token_count_updated()
                is called whenever the token count is recalculated.
        
        """
        self.config = config
        self._callback = callback
        
        # Per-invocation state
        self._running_summary: RunningSummary | None = None
        self._summarization_count: int = 0
        self._last_summarization_time: float | None = None
        self._current_token_count: int = 0
        
        logger.info(
            "ContextSummarizationMiddleware initialized: enabled=%s, trigger=%d, "
            "target=%d, model='%s', callback=%s",
            config.enabled,
            config.trigger_threshold,
            config.target_tokens,
            config.summarization_model,
            "present" if callback is not None else "none",
        )
    
    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Check token count and summarize if needed before agent execution.
        
        This is called at the start of each agent invocation. It:
        1. Loads any existing running_summary from state
        2. Counts current tokens in the conversation
        3. Reports token count via callback (if configured)
        4. If over threshold, triggers summarization
        5. Reports summarization event via callback (if configured)
        6. Injects summary into messages if summarization occurred
        
        Args:
            state: Current agent state with messages
            runtime: Runtime context
        
        Returns:
            Modified state with summarized messages, or None if no change
        
        """
        if not self.config.enabled:
            logger.debug("Summarization disabled, skipping")
            return None
        
        # Load running summary from state if available
        self._load_running_summary_from_state(state)
        
        # Get messages from state
        messages = state.get("messages", [])
        if not messages:
            logger.debug("No messages in state, skipping summarization check")
            return None
        
        # Count current tokens
        self._current_token_count = TokenCounter.count_messages(
            messages,
            self.config.token_counter_method,
        )
        
        # Report token count via callback
        if self._callback is not None:
            try:
                self._callback.on_token_count_updated(self._current_token_count)
            except Exception as e:
                logger.warning(
                    "Callback on_token_count_updated failed (%s): %s",
                    type(e).__name__,
                    e,
                    exc_info=True,
                )
        
        logger.debug(
            "Token count: %d / %d (trigger threshold)",
            self._current_token_count,
            self.config.trigger_threshold,
        )
        
        # Check if summarization is needed
        if not self.config.should_summarize(self._current_token_count):
            return None
        
        logger.info(
            "Token count %d exceeds threshold %d, triggering summarization",
            self._current_token_count,
            self.config.trigger_threshold,
        )
        
        # Perform summarization
        try:
            messages_before = len(messages)
            tokens_before = self._current_token_count
            start_time = time.time()
            
            summarized_messages = await self._perform_summarization(messages)
            
            # Update state with summarized messages
            state["messages"] = summarized_messages
            
            # Store updated running summary
            self._save_running_summary_to_state(state)
            
            # Calculate summarization stats
            new_token_count = TokenCounter.count_messages(
                summarized_messages,
                self.config.token_counter_method,
            )
            compression_ratio = (
                1 - (new_token_count / tokens_before)
                if tokens_before > 0 else 0.0
            )
            duration_ms = int((time.time() - start_time) * 1000)
            
            logger.info(
                "Summarization complete: %d -> %d tokens (%.1f%% reduction)",
                tokens_before,
                new_token_count,
                compression_ratio * 100,
            )
            
            # Report summarization event via callback
            if self._callback is not None:
                try:
                    event = SummarizationEventData(
                        tokens_before=tokens_before,
                        tokens_after=new_token_count,
                        compression_ratio=compression_ratio,
                        duration_ms=duration_ms,
                        summarization_model=self.config.summarization_model,
                        messages_before=messages_before,
                        messages_after=len(summarized_messages),
                    )
                    self._callback.on_summarization_complete(event)
                    # Also report the updated token count
                    self._callback.on_token_count_updated(new_token_count)
                except Exception as e:
                    logger.warning(
                        "Callback on_summarization_complete failed (%s): %s",
                        type(e).__name__,
                        e,
                        exc_info=True,
                    )
            
            # Update internal token count tracking
            self._current_token_count = new_token_count
            
            return {"messages": summarized_messages}
            
        except Exception as e:
            logger.error(
                "Summarization failed (%s): %s. "
                "Continuing without summarization. "
                "Context: model='%s', token_count=%d, message_count=%d",
                type(e).__name__,
                e,
                self.config.summarization_model,
                self._current_token_count,
                len(messages),
                exc_info=True,
            )
            return None
    
    async def aafter_step(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Called after each agent step.
        
        Currently not used, but reserved for potential mid-execution
        summarization in future versions.
        
        Args:
            state: Current agent state
            runtime: Runtime context
        
        Returns:
            None (no modifications)
        
        """
        # Reserved for future mid-execution summarization
        return None
    
    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Cleanup and persist running summary after agent execution.
        
        This is called after each agent invocation completes. It ensures
        the running summary is stored in state for the next invocation.
        
        Args:
            state: Final agent state
            runtime: Runtime context
        
        Returns:
            Modified state with running summary, or None
        
        """
        if not self.config.enabled:
            return None
        
        # Log final statistics
        if self._summarization_count > 0:
            logger.info(
                "Summarization middleware summary: %d summarizations, "
                "last at %s",
                self._summarization_count,
                (
                    time.strftime("%H:%M:%S", time.localtime(self._last_summarization_time))
                    if self._last_summarization_time else "N/A"
                ),
            )
        
        # Ensure running summary is saved to state
        if self._running_summary is not None:
            self._save_running_summary_to_state(state)
            return {RUNNING_SUMMARY_STATE_KEY: state.get(RUNNING_SUMMARY_STATE_KEY)}
        
        return None
    
    async def _perform_summarization(
        self,
        messages: list[BaseMessage],
    ) -> list[BaseMessage]:
        """Perform the actual summarization using LangMem.
        
        Args:
            messages: Current conversation messages.
        
        Returns:
            Modified message list with summary injected.
        
        Raises:
            Exception: If summarization fails completely.
        
        """
        # Ensure all messages have IDs (LangMem requirement)
        messages_with_ids = ensure_message_ids(messages)
        
        # Get summarization model
        model = self._create_summarization_model()
        
        # Import langmem here to allow graceful failure if not installed
        try:
            from langmem.short_term import summarize_messages
        except ImportError as e:
            raise ImportError(
                "langmem is required for context summarization. "
                "Install with: pip install langmem"
            ) from e
        
        # Call LangMem summarization
        result = summarize_messages(
            messages=messages_with_ids,
            running_summary=self._running_summary,
            model=model,
            max_tokens=self.config.target_tokens,
            max_tokens_before_summary=self.config.trigger_threshold,
            max_summary_tokens=self.config.max_summary_tokens,
        )
        
        # Update running summary
        if hasattr(result, 'running_summary'):
            self._running_summary = result.running_summary
        
        # Extract summary text
        summary_text = extract_summary_from_result(result)
        
        # Build the new message list
        new_messages = self._build_summarized_messages(
            original_messages=messages,
            result_messages=getattr(result, 'messages', []),
            summary_text=summary_text,
        )
        
        # Update internal stats
        self._summarization_count += 1
        self._last_summarization_time = time.time()
        
        logger.debug(
            "Summarization produced %d messages from %d original",
            len(new_messages),
            len(messages),
        )
        
        return new_messages
    
    def _create_summarization_model(self) -> BaseChatModel:
        """Create the LangChain model instance for summarization.
        
        Uses the economy-tier model specified in config for cost efficiency.
        Provider detection uses the ModelRegistry for robust identification.
        
        Returns:
            A LangChain BaseChatModel instance for the configured summarization model.
        
        Raises:
            ImportError: If the required LangChain provider package is not installed.
            ValueError: If the provider is unknown and cannot create a model.
        
        """
        from graphton.core.model_registry import ModelRegistry

        model_id = self.config.summarization_model
        
        # Use ModelRegistry for robust provider detection
        metadata = ModelRegistry.get_or_default(model_id)
        provider = metadata.provider
        
        if provider == "anthropic":
            return self._create_anthropic_model(model_id)
        elif provider == "openai":
            return self._create_openai_model(model_id)
        elif provider == "ollama":
            return self._create_ollama_model(model_id)
        else:
            # Unknown provider - log warning and attempt Ollama as fallback
            logger.warning(
                "Unknown provider '%s' for model '%s', attempting Ollama as fallback",
                provider,
                model_id,
            )
            return self._create_ollama_model(model_id)
    
    def _create_anthropic_model(self, model_id: str) -> BaseChatModel:
        """Create an Anthropic ChatAnthropic model instance.
        
        Args:
            model_id: The Anthropic model identifier (e.g., 'claude-haiku-4').
        
        Returns:
            A ChatAnthropic instance configured for summarization.
        
        Raises:
            ImportError: If langchain-anthropic is not installed.
        
        """
        try:
            from langchain_anthropic import ChatAnthropic
        except ImportError as e:
            raise ImportError(
                "langchain-anthropic is required for Anthropic models. "
                "Install with: pip install langchain-anthropic"
            ) from e
        
        return ChatAnthropic(
            model=model_id,
            max_tokens=self.config.max_summary_tokens,
        )
    
    def _create_openai_model(self, model_id: str) -> BaseChatModel:
        """Create an OpenAI ChatOpenAI model instance.
        
        Args:
            model_id: The OpenAI model identifier (e.g., 'gpt-4o-mini').
        
        Returns:
            A ChatOpenAI instance configured for summarization.
        
        Raises:
            ImportError: If langchain-openai is not installed.
        
        """
        try:
            from langchain_openai import ChatOpenAI
        except ImportError as e:
            raise ImportError(
                "langchain-openai is required for OpenAI models. "
                "Install with: pip install langchain-openai"
            ) from e
        
        return ChatOpenAI(
            model=model_id,
            max_tokens=self.config.max_summary_tokens,
        )
    
    def _create_ollama_model(self, model_id: str) -> BaseChatModel:
        """Create an Ollama ChatOllama model instance.
        
        Args:
            model_id: The Ollama model identifier (e.g., 'qwen2.5-coder:7b').
        
        Returns:
            A ChatOllama instance for local model inference.
        
        Raises:
            ImportError: If langchain-ollama is not installed.
        
        """
        try:
            from langchain_ollama import ChatOllama
        except ImportError as e:
            raise ImportError(
                "langchain-ollama is required for Ollama models. "
                "Install with: pip install langchain-ollama"
            ) from e
        
        return ChatOllama(model=model_id)
    
    def _build_summarized_messages(
        self,
        original_messages: list[BaseMessage],
        result_messages: list[BaseMessage],
        summary_text: str,
    ) -> list[BaseMessage]:
        """Build the final message list after summarization.
        
        The strategy is:
        1. Keep the original system prompt (if any)
        2. Inject the summary as a SystemMessage
        3. Keep only recent messages that weren't summarized
        
        Args:
            original_messages: The original conversation messages.
            result_messages: Messages returned by LangMem (may be modified).
            summary_text: The extracted summary text.
        
        Returns:
            The new message list with summary injected.
        
        """
        # If LangMem returned messages, use those (they handle the injection)
        if result_messages:
            return list(result_messages)
        
        # Fallback: Manual injection
        new_messages = []
        
        # Find and keep the system prompt
        system_prompt = None
        other_messages = []
        
        for msg in original_messages:
            if isinstance(msg, SystemMessage) and system_prompt is None:
                system_prompt = msg
            else:
                other_messages.append(msg)
        
        # Add system prompt if exists
        if system_prompt:
            new_messages.append(system_prompt)
        
        # Add summary message
        if summary_text:
            summary_message = create_summary_system_message(summary_text)
            new_messages.append(summary_message)
        
        # Add recent messages (last few turns)
        # Keep messages that fit within target_tokens
        recent_messages = self._select_recent_messages(other_messages)
        new_messages.extend(recent_messages)
        
        return new_messages
    
    def _select_recent_messages(
        self,
        messages: list[BaseMessage],
    ) -> list[BaseMessage]:
        """Select recent messages to keep after summarization.
        
        Keeps the most recent messages that fit within the target token count,
        ensuring we always keep the last user message and any pending tool calls.
        
        Args:
            messages: Non-system messages from the conversation.
        
        Returns:
            Subset of messages to keep.
        
        """
        if not messages:
            return []
        
        # Always keep at least the last message
        result = []
        total_tokens = 0
        target = self.config.target_tokens // 2  # Leave room for summary
        
        # Work backwards from most recent
        for msg in reversed(messages):
            msg_tokens = TokenCounter.count_messages(
                [msg],
                self.config.token_counter_method,
            )
            
            if total_tokens + msg_tokens <= target or not result:
                result.insert(0, msg)
                total_tokens += msg_tokens
            else:
                break
        
        return result
    
    def _load_running_summary_from_state(self, state: AgentState[Any]) -> None:
        """Load the running summary from checkpointer state.
        
        Args:
            state: Agent state that may contain stored running summary.
        
        """
        stored_data = state.get(RUNNING_SUMMARY_STATE_KEY)
        if stored_data:
            self._running_summary = deserialize_running_summary(stored_data)
            if self._running_summary:
                logger.debug(
                    "Loaded running summary from state: %d chars",
                    len(self._running_summary.summary or ""),
                )
    
    def _save_running_summary_to_state(self, state: AgentState[Any]) -> None:
        """Save the running summary to checkpointer state.
        
        Args:
            state: Agent state to store the running summary in.
        
        """
        if self._running_summary is not None:
            serialized = serialize_running_summary(self._running_summary)
            serialized['token_count_at_summarization'] = self._current_token_count
            state[RUNNING_SUMMARY_STATE_KEY] = serialized
            
            logger.debug(
                "Saved running summary to state: %d chars",
                len(serialized.get('summary', '')),
            )


# Module-level exports
__all__ = [
    "ContextSummarizationMiddleware",
    "RUNNING_SUMMARY_STATE_KEY",
]
