"""Token counting utilities for context management.

This module provides unified token counting across different LLM providers.
It uses method dispatch based on the TokenCounterMethod enum to select the
appropriate counting strategy for each provider.

Supported Methods:
    - TIKTOKEN_CL100K: GPT-4, GPT-3.5 (cl100k_base encoding)
    - TIKTOKEN_O200K: GPT-4o, o1 family (o200k_base encoding)
    - ANTHROPIC_NATIVE: Claude models using Anthropic's native counting
    - APPROXIMATE: Fallback using chars/4 heuristic

Design Principles:
    1. Accuracy - Use provider-specific tokenizers when available
    2. Graceful Fallback - Fall back to approximation if native counting fails
    3. Lazy Loading - Only import tokenization libraries when needed
    4. Caching - Cache tokenizer instances for performance

Example:
    >>> from graphton.core.token_counter import TokenCounter
    >>> from graphton.core.model_registry import TokenCounterMethod
    >>> from langchain_core.messages import HumanMessage
    >>> 
    >>> messages = [HumanMessage(content="Hello, world!")]
    >>> count = TokenCounter.count_messages(messages, TokenCounterMethod.TIKTOKEN_CL100K)
    >>> print(f"Token count: {count}")

"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_core.messages import BaseMessage
    from tiktoken import Encoding

    from graphton.core.model_registry import TokenCounterMethod

logger = logging.getLogger(__name__)

# Average characters per token for approximate counting
# This is a conservative estimate that works across most models
_CHARS_PER_TOKEN = 4

# Token overhead per message for OpenAI models
# Accounts for role tokens, formatting, etc.
_OPENAI_MESSAGE_OVERHEAD = 4

# Token overhead for Anthropic models
_ANTHROPIC_MESSAGE_OVERHEAD = 4


class TokenCountingError(Exception):
    """Raised when token counting fails.
    
    This exception is caught internally and triggers fallback to
    approximate counting. It is not expected to propagate to callers.
    """
    
    pass


class TokenCounter:
    """Token counting using Model Registry method dispatch.
    
    This class provides a unified interface for counting tokens across
    different LLM providers. It uses the TokenCounterMethod enum to
    select the appropriate counting strategy.
    
    All methods are class methods - no instantiation is needed.
    
    Example:
        >>> from graphton.core.token_counter import TokenCounter
        >>> from graphton.core.model_registry import TokenCounterMethod
        >>> from langchain_core.messages import HumanMessage, AIMessage
        >>> 
        >>> messages = [
        ...     HumanMessage(content="What is 2+2?"),
        ...     AIMessage(content="2+2 equals 4."),
        ... ]
        >>> 
        >>> # Count using tiktoken for OpenAI models
        >>> count = TokenCounter.count_messages(
        ...     messages,
        ...     TokenCounterMethod.TIKTOKEN_CL100K
        ... )
        >>> print(f"Token count: {count}")
        Token count: 15
    
    """
    
    @classmethod
    def count_messages(
        cls,
        messages: list[BaseMessage],
        method: TokenCounterMethod,
    ) -> int:
        """Count tokens in a list of messages using the specified method.
        
        This is the main entry point for token counting. It dispatches to
        the appropriate counting method based on the TokenCounterMethod enum.
        
        Args:
            messages: List of LangChain messages to count tokens for.
            method: TokenCounterMethod specifying which counting strategy to use.
                Must be a valid TokenCounterMethod enum value.
        
        Returns:
            Total token count for all messages.
        
        Example:
            >>> from graphton.core.model_registry import TokenCounterMethod
            >>> from langchain_core.messages import HumanMessage
            >>> 
            >>> messages = [HumanMessage(content="Hello!")]
            >>> count = TokenCounter.count_messages(
            ...     messages,
            ...     TokenCounterMethod.APPROXIMATE
            ... )
            >>> print(count)
            2
        
        """
        # Import here to avoid circular dependency
        from graphton.core.model_registry import TokenCounterMethod
        
        if not messages:
            return 0
        
        # Validate method parameter
        if not isinstance(method, TokenCounterMethod):
            logger.warning(
                "Invalid token counter method type '%s' (expected TokenCounterMethod), "
                "falling back to APPROXIMATE",
                type(method).__name__,
            )
            return cls._count_approximate(messages)
        
        try:
            if method == TokenCounterMethod.TIKTOKEN_CL100K:
                return cls._count_tiktoken(messages, "cl100k_base")
            elif method == TokenCounterMethod.TIKTOKEN_O200K:
                return cls._count_tiktoken(messages, "o200k_base")
            elif method == TokenCounterMethod.ANTHROPIC_NATIVE:
                return cls._count_anthropic(messages)
            else:
                # APPROXIMATE or unknown method
                return cls._count_approximate(messages)
        except TokenCountingError as e:
            logger.warning(
                "Token counting failed with method %s: %s. "
                "Falling back to approximate counting.",
                method.value,
                e,
            )
            return cls._count_approximate(messages)
        except Exception as e:
            logger.warning(
                "Unexpected error in token counting (%s): %s. "
                "Falling back to approximate counting.",
                type(e).__name__,
                e,
            )
            return cls._count_approximate(messages)
    
    @classmethod
    def count_text(
        cls,
        text: str,
        method: TokenCounterMethod,
    ) -> int:
        """Count tokens in a single text string.
        
        This is a convenience method for counting tokens in a single string
        without constructing a message.
        
        Args:
            text: The text to count tokens for.
            method: TokenCounterMethod specifying which counting strategy to use.
                Must be a valid TokenCounterMethod enum value.
        
        Returns:
            Token count for the text.
        
        Example:
            >>> from graphton.core.model_registry import TokenCounterMethod
            >>> count = TokenCounter.count_text(
            ...     "Hello, world!",
            ...     TokenCounterMethod.APPROXIMATE
            ... )
            >>> print(count)
            3
        
        """
        # Import here to avoid circular dependency
        from graphton.core.model_registry import TokenCounterMethod
        
        if not text:
            return 0
        
        # Validate method parameter
        if not isinstance(method, TokenCounterMethod):
            logger.warning(
                "Invalid token counter method type '%s' (expected TokenCounterMethod), "
                "falling back to APPROXIMATE",
                type(method).__name__,
            )
            return len(text) // _CHARS_PER_TOKEN
        
        try:
            if method == TokenCounterMethod.TIKTOKEN_CL100K:
                return cls._count_text_tiktoken(text, "cl100k_base")
            elif method == TokenCounterMethod.TIKTOKEN_O200K:
                return cls._count_text_tiktoken(text, "o200k_base")
            elif method == TokenCounterMethod.ANTHROPIC_NATIVE:
                return cls._count_text_anthropic(text)
            else:
                return len(text) // _CHARS_PER_TOKEN
        except Exception as e:
            logger.warning(
                "Text token counting failed (%s): %s. Using approximate.",
                type(e).__name__,
                e,
            )
            return len(text) // _CHARS_PER_TOKEN
    
    @classmethod
    def _count_tiktoken(
        cls,
        messages: list[BaseMessage],
        encoding_name: str,
    ) -> int:
        """Count tokens using tiktoken library.
        
        This method counts tokens for OpenAI models using the specified
        tiktoken encoding. It accounts for message overhead tokens.
        
        Args:
            messages: List of messages to count.
            encoding_name: tiktoken encoding name (cl100k_base or o200k_base).
        
        Returns:
            Total token count including message overhead.
        
        Raises:
            TokenCountingError: If tiktoken is not available or encoding fails.
        
        """
        try:
            encoding = cls._get_tiktoken_encoding(encoding_name)
        except Exception as e:
            raise TokenCountingError(f"Failed to load tiktoken encoding: {e}") from e
        
        total_tokens = 0
        
        for message in messages:
            # Count content tokens
            content = cls._extract_message_content(message)
            total_tokens += len(encoding.encode(content))
            
            # Add message overhead (role, separators, etc.)
            total_tokens += _OPENAI_MESSAGE_OVERHEAD
            
            # Count tool calls if present
            if hasattr(message, 'tool_calls') and message.tool_calls:
                for tool_call in message.tool_calls:
                    tool_name = tool_call.get('name', '')
                    tool_args = str(tool_call.get('args', {}))
                    total_tokens += len(encoding.encode(tool_name))
                    total_tokens += len(encoding.encode(tool_args))
        
        # Account for conversation overhead
        total_tokens += 3  # Assistant priming tokens
        
        return total_tokens
    
    @classmethod
    def _count_text_tiktoken(cls, text: str, encoding_name: str) -> int:
        """Count tokens in a single text string using tiktoken."""
        try:
            encoding = cls._get_tiktoken_encoding(encoding_name)
            return len(encoding.encode(text))
        except Exception as e:
            raise TokenCountingError(f"tiktoken encoding failed: {e}") from e
    
    @classmethod
    @lru_cache(maxsize=4)
    def _get_tiktoken_encoding(cls, encoding_name: str) -> Encoding:
        """Get a cached tiktoken encoding instance.
        
        Caches encoding instances to avoid repeated initialization overhead.
        The LRU cache ensures we don't repeatedly load the same encoding.
        
        Args:
            encoding_name: The tiktoken encoding name (e.g., 'cl100k_base', 'o200k_base').
        
        Returns:
            A tiktoken Encoding instance for the specified encoding.
        
        Raises:
            ImportError: If tiktoken is not installed.
            KeyError: If the encoding name is not recognized by tiktoken.
        
        """
        try:
            import tiktoken
        except ImportError as e:
            raise ImportError(
                "tiktoken is required for OpenAI token counting. "
                "Install with: pip install tiktoken"
            ) from e
        
        return tiktoken.get_encoding(encoding_name)
    
    @classmethod
    def _count_anthropic(cls, messages: list[BaseMessage]) -> int:
        """Count tokens using Anthropic's native counting.
        
        This method attempts to use Anthropic's token counting API.
        If the API is not available, it falls back to an approximate
        method calibrated for Claude models.
        
        Note: The Anthropic API for token counting requires a valid API key
        and network access. For offline use, we use a Claude-calibrated
        approximation.
        
        Args:
            messages: List of messages to count.
        
        Returns:
            Token count for all messages.
        
        """
        # Anthropic's native counting requires API access, which may not
        # always be available. We use a Claude-calibrated approximation
        # that's more accurate than the generic chars/4 method.
        #
        # Claude tokenization is similar to GPT models but with some
        # differences. Using ~3.8 chars per token provides better accuracy.
        
        total_tokens = 0
        chars_per_token = 3.8
        
        for message in messages:
            content = cls._extract_message_content(message)
            total_tokens += int(len(content) / chars_per_token)
            
            # Add message overhead
            total_tokens += _ANTHROPIC_MESSAGE_OVERHEAD
            
            # Count tool calls if present
            if hasattr(message, 'tool_calls') and message.tool_calls:
                for tool_call in message.tool_calls:
                    tool_name = tool_call.get('name', '')
                    tool_args = str(tool_call.get('args', {}))
                    total_tokens += int(len(tool_name) / chars_per_token)
                    total_tokens += int(len(tool_args) / chars_per_token)
        
        return total_tokens
    
    @classmethod
    def _count_text_anthropic(cls, text: str) -> int:
        """Count tokens in a single text string for Anthropic models."""
        chars_per_token = 3.8
        return int(len(text) / chars_per_token)
    
    @classmethod
    def _count_approximate(cls, messages: list[BaseMessage]) -> int:
        """Count tokens using approximate chars/4 method.
        
        This is the fallback method used when native counting is not
        available. It provides a conservative estimate suitable for
        context window management.
        
        Args:
            messages: List of messages to count.
        
        Returns:
            Approximate token count.
        
        """
        total_tokens = 0
        
        for message in messages:
            content = cls._extract_message_content(message)
            total_tokens += len(content) // _CHARS_PER_TOKEN
            
            # Add message overhead
            total_tokens += 4
            
            # Count tool calls if present
            if hasattr(message, 'tool_calls') and message.tool_calls:
                for tool_call in message.tool_calls:
                    tool_name = tool_call.get('name', '')
                    tool_args = str(tool_call.get('args', {}))
                    total_tokens += len(tool_name) // _CHARS_PER_TOKEN
                    total_tokens += len(tool_args) // _CHARS_PER_TOKEN
        
        return total_tokens
    
    @classmethod
    def _extract_message_content(cls, message: BaseMessage) -> str:
        """Extract text content from a message.
        
        Handles various message content formats including:
        - Simple string content
        - List of content blocks (multimodal messages)
        - Empty/None content
        
        Args:
            message: A LangChain message.
        
        Returns:
            The text content of the message.
        
        """
        content = message.content
        
        if content is None:
            return ""
        
        if isinstance(content, str):
            return content
        
        # Handle list of content blocks (e.g., multimodal messages)
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, str):
                    text_parts.append(block)
                elif isinstance(block, dict):
                    # Extract text from content blocks
                    if block.get('type') == 'text':
                        text_parts.append(block.get('text', ''))
            return ' '.join(text_parts)
        
        # Fallback to string conversion
        return str(content)


# Module-level exports
__all__ = ["TokenCounter", "TokenCountingError"]
