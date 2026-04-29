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

import dataclasses
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from graphton.core.message_utils import (
    create_summary_system_message,
    deserialize_running_summary,
    ensure_message_ids,
    extract_summary_from_result,
    serialize_running_summary,
)
from graphton.core.model_registry import ModelRegistry
from graphton.core.summarization_callback import (
    SOURCE_GRAPH_START,
    SOURCE_MID_EXECUTION,
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


class _SummarizationUsageCapture:
    """Lightweight LangChain callback handler that captures token usage.

    Attached to the summarization model via ``with_config(callbacks=[...])``
    so that when LangMem internally invokes the model, we can intercept
    ``on_llm_end`` and extract ``usage_metadata``.
    """

    def __init__(self) -> None:
        self.input_tokens: int = 0
        self.output_tokens: int = 0

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ANN401
        for gen_list in getattr(response, "generations", []):
            for gen in gen_list:
                msg = getattr(gen, "message", None)
                if msg is None:
                    continue
                usage = getattr(msg, "usage_metadata", None)
                if usage is None:
                    continue
                self.input_tokens += getattr(usage, "input_tokens", 0) or 0
                self.output_tokens += getattr(usage, "output_tokens", 0) or 0


class ContextSummarizationMiddleware(AgentMiddleware):
    """Middleware for automatic context window management.
    
    Implements a two-layer context management strategy inspired by Claude Code:
    
    **Layer A -- Auto-compaction** (``awrap_model_call``):
        Before each model call, counts tokens in the request. When the token
        count exceeds ``trigger_threshold``, performs LLM-based summarization
        via LangMem and passes a compacted request to the model. The agent
        keeps working with a condensed view of the conversation; the raw
        graph state is untouched (preserving audit/debug capability).
    
    **Layer B -- Emergency brake** (``aafter_model`` + ``awrap_tool_call``):
        Safety net that fires *only* when auto-compaction fails. If compaction
        raised an exception AND the state token count exceeds
        ``overflow_threshold`` (95% of context window), injects a warning
        SystemMessage and blocks subsequent tool execution to prevent the
        model from receiving a prompt that would exceed the API limit.
    
    **Graph-start summarization** (``abefore_agent``):
        Handles persistent-state-level summarization between graph invocations
        (for checkpointing). Complementary to ``awrap_model_call`` which only
        modifies the transient model request.
    
    Note:
        This class is named ContextSummarizationMiddleware (not
        SummarizationMiddleware) to avoid name collision with DeepAgents'
        auto-injected SummarizationMiddleware.
    
    Attributes:
        config: SummarizationConfig with thresholds and model settings.
        _callback: Optional callback for reporting summarization events.
        _running_summary: LangMem RunningSummary, persisted in state.
        _summarization_count: Graph-start summarizations triggered.
        _compactions_performed: Mid-execution compactions via awrap_model_call.
        _compaction_failed: True when the latest compaction attempt raised.
        _overflow_imminent: True when emergency brake should block tools.
    
    Example:
        >>> from graphton.core.summarization_config import SummarizationConfig
        >>> 
        >>> config = SummarizationConfig.for_model("claude-opus-4")
        >>> middleware = ContextSummarizationMiddleware(config=config)
        >>> 
        >>> # Middleware is added to middleware_list in create_deep_agent()
    
    """
    
    def __init__(
        self,
        config: SummarizationConfig,
        callback: SummarizationCallback | None = None,
        llm_kwargs: dict[str, Any] | None = None,
    ) -> None:
        """Initialize the summarization middleware.
        
        Args:
            config: SummarizationConfig with thresholds and model settings.
            callback: Optional callback for reporting summarization events.
                If provided, on_summarization_complete() is called after
                each successful summarization, and on_token_count_updated()
                is called whenever the token count is recalculated.
            llm_kwargs: Provider-specific kwargs forwarded to
                ``parse_model_string`` when constructing the summarization
                model.  Typically contains ``base_url`` and ``api_key`` for
                proxy routing or direct provider auth.
        
        """
        self.config = config
        self._callback = callback
        self._llm_kwargs = llm_kwargs or {}
        
        # Per-invocation state (reset in abefore_agent)
        self._running_summary: RunningSummary | None = None
        self._summarization_count: int = 0
        self._last_summarization_time: float | None = None
        self._current_token_count: int = 0
        
        # Mid-execution compaction state (reset in abefore_agent)
        self._compaction_failed: bool = False
        self._compactions_performed: int = 0
        self._overflow_imminent: bool = False
        self._mid_execution_warning_issued: bool = False
        
        # Summarization LLM usage captured from the most recent call
        self._last_summarization_input_tokens: int = 0
        self._last_summarization_output_tokens: int = 0
        self._last_summarization_cost_usd: float = 0.0
        
        logger.info(
            "ContextSummarizationMiddleware initialized: enabled=%s, "
            "context_window=%d, trigger=%d, target=%d, overflow=%d, "
            "model='%s', callback=%s",
            config.enabled,
            config.context_window_tokens,
            config.trigger_threshold,
            config.target_tokens,
            config.overflow_threshold,
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
        1. Resets per-invocation tracking state
        2. Loads any existing running_summary from state
        3. Counts current tokens in the conversation
        4. Reports token count via callback (if configured)
        5. If over threshold, triggers graph-start summarization
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
        
        # Reset per-invocation state
        self._compaction_failed = False
        self._compactions_performed = 0
        self._overflow_imminent = False
        self._mid_execution_warning_issued = False
        
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
                        source=SOURCE_GRAPH_START,
                        summarization_input_tokens=self._last_summarization_input_tokens,
                        summarization_output_tokens=self._last_summarization_output_tokens,
                        summarization_cost_usd=self._last_summarization_cost_usd,
                    )
                    self._callback.on_summarization_complete(event)
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
    
    # ------------------------------------------------------------------
    # Layer A: awrap_model_call -- Mid-execution compaction
    # ------------------------------------------------------------------

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        """Compact the model's input when context grows too large.
        
        Before each model call, counts tokens in ``request.messages``.
        When the count exceeds ``trigger_threshold``, performs LLM-based
        summarization via LangMem, creates a compacted request via
        ``dataclasses.replace()``, and passes it to the handler so the
        model sees a manageable context.
        
        If summarization fails, the original request is forwarded
        unchanged and ``_compaction_failed`` is set so the emergency
        brake (Layer B) can activate.
        """
        if not self.config.enabled:
            return await handler(request)

        messages = list(request.messages)
        token_count = TokenCounter.count_messages(
            messages, self.config.token_counter_method,
        )
        self._current_token_count = token_count

        if self._callback is not None:
            try:
                self._callback.on_token_count_updated(token_count)
            except Exception as e:
                logger.warning(
                    "Callback on_token_count_updated failed (%s): %s",
                    type(e).__name__, e, exc_info=True,
                )

        if token_count < self.config.trigger_threshold:
            self._compaction_failed = False
            return await handler(request)

        logger.info(
            "awrap_model_call: token count %d >= trigger %d, compacting",
            token_count, self.config.trigger_threshold,
        )

        try:
            tokens_before = token_count
            start_time = time.time()

            compacted_messages = await self._perform_summarization(messages)

            new_token_count = TokenCounter.count_messages(
                compacted_messages, self.config.token_counter_method,
            )
            compression_ratio = (
                1 - (new_token_count / tokens_before) if tokens_before > 0 else 0.0
            )
            duration_ms = int((time.time() - start_time) * 1000)

            self._compactions_performed += 1
            self._compaction_failed = False
            self._current_token_count = new_token_count

            logger.info(
                "awrap_model_call: compacted %d -> %d tokens (%.1f%% reduction) in %dms",
                tokens_before, new_token_count, compression_ratio * 100, duration_ms,
            )

            if self._callback is not None:
                try:
                    event = SummarizationEventData(
                        tokens_before=tokens_before,
                        tokens_after=new_token_count,
                        compression_ratio=compression_ratio,
                        duration_ms=duration_ms,
                        summarization_model=self.config.summarization_model,
                        messages_before=len(messages),
                        messages_after=len(compacted_messages),
                        source=SOURCE_MID_EXECUTION,
                        summarization_input_tokens=self._last_summarization_input_tokens,
                        summarization_output_tokens=self._last_summarization_output_tokens,
                        summarization_cost_usd=self._last_summarization_cost_usd,
                    )
                    self._callback.on_summarization_complete(event)
                    self._callback.on_token_count_updated(new_token_count)
                except Exception as e:
                    logger.warning(
                        "Callback failed after compaction (%s): %s",
                        type(e).__name__, e, exc_info=True,
                    )

            new_request = dataclasses.replace(request, messages=compacted_messages)
            return await handler(new_request)

        except Exception as e:
            logger.error(
                "awrap_model_call: compaction failed (%s): %s — "
                "forwarding original request",
                type(e).__name__, e, exc_info=True,
            )
            self._compaction_failed = True
            return await handler(request)

    # ------------------------------------------------------------------
    # Layer B: aafter_model -- Monitoring + emergency warning
    # ------------------------------------------------------------------

    async def aafter_model(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Monitor token count and inject emergency warning when compaction fails.
        
        After each model response, counts tokens in the full graph state
        and reports them via the callback. If ``_compaction_failed`` is
        True and the state token count exceeds ``overflow_threshold``,
        injects a warning SystemMessage and sets ``_overflow_imminent``
        so that ``awrap_tool_call`` blocks execution.
        
        During normal operation (compaction succeeds), this hook only
        reports the token count and returns ``None``.
        """
        if not self.config.enabled:
            return None

        messages = state.get("messages", [])
        if not messages:
            return None

        state_token_count = TokenCounter.count_messages(
            messages, self.config.token_counter_method,
        )

        if self._callback is not None:
            try:
                self._callback.on_token_count_updated(state_token_count)
            except Exception as e:
                logger.warning(
                    "Callback on_token_count_updated failed (%s): %s",
                    type(e).__name__, e, exc_info=True,
                )

        if (
            self._compaction_failed
            and self.config.overflow_threshold > 0
            and state_token_count >= self.config.overflow_threshold
        ):
            logger.warning(
                "aafter_model: compaction failed AND state tokens %d >= overflow %d — "
                "injecting emergency warning",
                state_token_count, self.config.overflow_threshold,
            )
            self._overflow_imminent = True
            self._mid_execution_warning_issued = True
            warning = self._create_context_warning_message(state_token_count)
            return {"messages": [warning]}

        return None

    # ------------------------------------------------------------------
    # Layer B: awrap_tool_call -- Emergency brake
    # ------------------------------------------------------------------

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Block tool execution when context overflow is imminent.
        
        When ``_overflow_imminent`` is True (set by ``aafter_model``
        after compaction failure + critical token count), returns a
        ToolMessage without invoking the actual tool, preventing
        further context growth.
        """
        if self._overflow_imminent:
            tool_call = request.tool_call
            logger.info(
                "awrap_tool_call: blocking '%s' (id=%s) — overflow imminent",
                tool_call.get("name", "unknown"),
                tool_call.get("id", "?"),
            )
            return ToolMessage(
                content=(
                    "[Context limit reached: tool execution blocked to prevent "
                    "context overflow. Context compaction was unable to reduce "
                    "token count. Conclude your work with the information you have.]"
                ),
                tool_call_id=tool_call["id"],
                name=tool_call.get("name", "unknown"),
            )

        return await handler(request)

    # ------------------------------------------------------------------
    # aafter_agent -- Cleanup and summary persistence
    # ------------------------------------------------------------------

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
        
        logger.info(
            "Context management summary: "
            "graph_start_summarizations=%d, "
            "mid_execution_compactions=%d, "
            "compaction_failures=%s, "
            "overflow_warnings=%s, "
            "final_token_count=%d",
            self._summarization_count,
            self._compactions_performed,
            self._compaction_failed,
            self._mid_execution_warning_issued,
            self._current_token_count,
        )
        
        # Ensure running summary is saved to state
        if self._running_summary is not None:
            self._save_running_summary_to_state(state)
            return {RUNNING_SUMMARY_STATE_KEY: state.get(RUNNING_SUMMARY_STATE_KEY)}
        
        return None
    
    # ------------------------------------------------------------------
    # Private helpers -- intervention messages
    # ------------------------------------------------------------------

    def _create_context_warning_message(self, current_tokens: int) -> SystemMessage:
        """Create a SystemMessage warning the agent about critical context usage.
        
        Injected by ``aafter_model`` when compaction has failed and tokens
        are at or above the overflow threshold.
        """
        max_k = self.config.context_window_tokens // 1000
        current_k = current_tokens // 1000
        return SystemMessage(
            content=(
                f"CONTEXT WARNING: Context compaction failed and token count is "
                f"critically high ({current_k}K / {max_k}K tokens). "
                f"Conclude your work immediately: summarize findings and provide "
                f"your final answer. Further tool calls will be blocked."
            ),
        )

    # ------------------------------------------------------------------
    # Private helpers -- summarization
    # ------------------------------------------------------------------

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
        messages_with_ids = ensure_message_ids(messages)
        model = self._create_summarization_model()
        
        try:
            from langmem.short_term import summarize_messages
        except ImportError as e:
            raise ImportError(
                "langmem is required for context summarization. "
                "Install with: pip install langmem"
            ) from e
        
        # Wrap model with a usage-capturing callback so we can extract
        # the summarization LLM call's token consumption.
        usage_capture = _SummarizationUsageCapture()
        model_with_callback = model.with_config(callbacks=[usage_capture])
        
        result = summarize_messages(
            messages=messages_with_ids,
            running_summary=self._running_summary,
            model=model_with_callback,
            max_tokens=self.config.target_tokens,
            max_tokens_before_summary=self.config.trigger_threshold,
            max_summary_tokens=self.config.max_summary_tokens,
        )
        
        # Stash captured usage for the event builder to pick up
        self._last_summarization_input_tokens = usage_capture.input_tokens
        self._last_summarization_output_tokens = usage_capture.output_tokens
        self._last_summarization_cost_usd = self._compute_summarization_cost(
            usage_capture.input_tokens,
            usage_capture.output_tokens,
        )
        
        if hasattr(result, 'running_summary'):
            self._running_summary = result.running_summary
        
        summary_text = extract_summary_from_result(result)
        
        new_messages = self._build_summarized_messages(
            original_messages=messages,
            result_messages=getattr(result, 'messages', []),
            summary_text=summary_text,
        )
        
        self._summarization_count += 1
        self._last_summarization_time = time.time()
        
        logger.debug(
            "Summarization produced %d messages from %d original "
            "(llm_input=%d, llm_output=%d, cost=$%.6f)",
            len(new_messages),
            len(messages),
            usage_capture.input_tokens,
            usage_capture.output_tokens,
            self._last_summarization_cost_usd,
        )
        
        return new_messages
    
    def _compute_summarization_cost(
        self, input_tokens: int, output_tokens: int,
    ) -> float:
        """Compute USD cost for a summarization LLM call."""
        metadata = ModelRegistry.get_or_default(self.config.summarization_model)
        return (
            input_tokens * (metadata.input_price_per_million or 0.0)
            + output_tokens * (metadata.output_price_per_million or 0.0)
        ) / 1_000_000
    
    def _create_summarization_model(self) -> BaseChatModel:
        """Create the LangChain model instance for summarization.
        
        Delegates to ``parse_model_string`` so the summarization model
        inherits the same provider routing (proxy ``base_url``, ``api_key``)
        as the primary agent model.
        
        Returns:
            A LangChain BaseChatModel instance for the configured
            summarization model.
        
        Raises:
            ImportError: If the required LangChain provider package is
                not installed.
            ValueError: If the provider is unknown.
        
        """
        from graphton.core.models import parse_model_string

        return parse_model_string(
            self.config.summarization_model,
            max_tokens=self.config.max_summary_tokens,
            **self._llm_kwargs,
        )
    
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
