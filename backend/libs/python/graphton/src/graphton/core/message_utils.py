"""Message utilities for context summarization.

This module provides helper functions for working with LangChain messages
in the context of LangMem summarization. Key functions include:

- ensure_message_ids: Add unique IDs to messages (required by LangMem)
- extract_summary_from_result: Extract summary text from SummarizationResult
- serialize_running_summary: Convert RunningSummary to JSON-serializable dict
- deserialize_running_summary: Restore RunningSummary from stored dict

Design Principles:
    1. Non-Destructive - Original messages are preserved; new instances created
    2. Type Preservation - Message types (Human, AI, System, Tool) are maintained
    3. Tool Call Handling - Tool calls and results are preserved correctly
    4. Robust Extraction - Multiple fallback paths for summary extraction

Example:
    >>> from graphton.core.message_utils import ensure_message_ids
    >>> from langchain_core.messages import HumanMessage
    >>> 
    >>> messages = [HumanMessage(content="Hello!")]
    >>> messages_with_ids = ensure_message_ids(messages)
    >>> print(messages_with_ids[0].id)
    msg_a1b2c3d4e5f6

"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

if TYPE_CHECKING:
    from langmem.short_term import RunningSummary, SummarizationResult

logger = logging.getLogger(__name__)


def ensure_message_ids(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Ensure all messages have unique IDs.
    
    LangMem's summarize_messages() requires all messages to have an 'id' field.
    This function creates new message instances with IDs for any messages that
    don't have them, preserving all other message attributes.
    
    Messages that already have IDs are passed through unchanged.
    
    Args:
        messages: List of LangChain messages, some of which may lack IDs.
    
    Returns:
        List of messages where all messages have unique IDs.
        Original messages with IDs are returned as-is.
        Messages without IDs are replaced with new instances containing IDs.
    
    Example:
        >>> from langchain_core.messages import HumanMessage, AIMessage
        >>> 
        >>> messages = [
        ...     HumanMessage(content="Hello"),
        ...     AIMessage(content="Hi there!", id="existing_id"),
        ... ]
        >>> result = ensure_message_ids(messages)
        >>> print(result[0].id)  # Generated ID
        msg_...
        >>> print(result[1].id)  # Preserved ID
        existing_id
    
    """
    if not messages:
        return []
    
    result = []
    ids_generated = 0
    
    for msg in messages:
        if _has_valid_id(msg):
            result.append(msg)
        else:
            new_msg = _create_message_with_id(msg)
            result.append(new_msg)
            ids_generated += 1
    
    if ids_generated > 0:
        logger.debug(
            "Generated IDs for %d/%d messages",
            ids_generated,
            len(messages),
        )
    
    return result


def _has_valid_id(message: BaseMessage) -> bool:
    """Check if a message has a valid, non-empty ID."""
    return hasattr(message, 'id') and message.id is not None and message.id != ""


def _generate_message_id() -> str:
    """Generate a unique message ID.
    
    Format: msg_{12 hex characters} for compact, readable IDs.
    """
    return f"msg_{uuid.uuid4().hex[:12]}"


def _create_message_with_id(message: BaseMessage) -> BaseMessage:
    """Create a new message instance with a generated ID.
    
    Preserves all attributes of the original message while adding an ID.
    
    Args:
        message: The original message without an ID.
    
    Returns:
        A new message instance of the same type with a generated ID.
    
    """
    msg_id = _generate_message_id()
    
    if isinstance(message, SystemMessage):
        return SystemMessage(
            content=message.content,
            id=msg_id,
            additional_kwargs=getattr(message, 'additional_kwargs', {}),
        )
    
    elif isinstance(message, HumanMessage):
        return HumanMessage(
            content=message.content,
            id=msg_id,
            additional_kwargs=getattr(message, 'additional_kwargs', {}),
        )
    
    elif isinstance(message, AIMessage):
        # AIMessage may have tool_calls that need to be preserved
        tool_calls = getattr(message, 'tool_calls', None) or []
        return AIMessage(
            content=message.content,
            id=msg_id,
            tool_calls=tool_calls,
            additional_kwargs=getattr(message, 'additional_kwargs', {}),
        )
    
    elif isinstance(message, ToolMessage):
        # ToolMessage requires tool_call_id
        return ToolMessage(
            content=message.content,
            id=msg_id,
            tool_call_id=message.tool_call_id,
            name=getattr(message, 'name', None),
            additional_kwargs=getattr(message, 'additional_kwargs', {}),
        )
    
    else:
        # Generic fallback for other message types
        logger.warning(
            "Unknown message type %s, creating with basic attributes",
            type(message).__name__,
        )
        # Try to preserve the message by just setting id
        # This may not work for all custom message types
        try:
            new_msg = type(message)(
                content=message.content,
                id=msg_id,
            )
            return new_msg
        except Exception:
            # If we can't create a new instance, return original with warning
            logger.warning(
                "Could not add ID to message of type %s",
                type(message).__name__,
            )
            return message


def extract_summary_from_result(result: SummarizationResult | Any | None) -> str:
    """Extract summary text from LangMem SummarizationResult.
    
    LangMem's summarize_messages() returns a SummarizationResult containing:
    - running_summary.summary: The actual summary text (primary source)
    - messages: Modified message list with summary injected
    
    This function extracts the summary text using multiple fallback strategies.
    
    Args:
        result: The SummarizationResult from summarize_messages(), or any
            compatible object with running_summary or messages attributes.
    
    Returns:
        The extracted summary text, or empty string if extraction fails.
    
    Example:
        >>> from langmem.short_term import summarize_messages
        >>> result = summarize_messages(messages=messages, ...)
        >>> summary = extract_summary_from_result(result)
        >>> print(summary[:50])
        "The conversation covered database configuration..."
    
    """
    if result is None:
        return ""
    
    # Primary source: running_summary.summary
    if hasattr(result, 'running_summary') and result.running_summary:
        running_summary = result.running_summary
        if hasattr(running_summary, 'summary') and running_summary.summary:
            logger.debug("Extracted summary from running_summary.summary")
            return running_summary.summary
    
    # Fallback: Look for summary SystemMessage in messages
    # LangMem injects summary as a SystemMessage after the original system prompt
    if hasattr(result, 'messages') and result.messages:
        messages = result.messages
        
        # Skip first message (original system prompt) and look for summary
        for i, msg in enumerate(messages[1:], start=1):
            if isinstance(msg, SystemMessage):
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                # Check if this looks like a summary message
                if _looks_like_summary(content):
                    logger.debug(
                        "Extracted summary from messages[%d] (SystemMessage)",
                        i,
                    )
                    return content
    
    logger.warning("Could not extract summary from result")
    return ""


def _looks_like_summary(content: str) -> bool:
    """Heuristic check if content appears to be a conversation summary.
    
    Summaries typically:
    - Are reasonably long (>100 chars)
    - May contain keywords like "summary", "discussed", "covered"
    - Are written in past tense or present perfect
    """
    if len(content) < 100:
        return False
    
    # Check for summary-like keywords
    summary_indicators = [
        'summary',
        'discussed',
        'covered',
        'conversation',
        'mentioned',
        'established',
        'agreed',
        'decided',
        'configured',
        'set up',
    ]
    
    content_lower = content.lower()
    return any(indicator in content_lower for indicator in summary_indicators)


def serialize_running_summary(running_summary: RunningSummary | Any | None) -> dict[str, Any]:
    """Convert a LangMem RunningSummary to a JSON-serializable dictionary.
    
    This is used to store the running summary in checkpointer state,
    which requires JSON-serializable data.
    
    Args:
        running_summary: A LangMem RunningSummary object, or any compatible
            object with summary, summarized_message_ids, and
            last_summarized_message_id attributes.
    
    Returns:
        A dictionary with the summary data that can be stored in state.
        Returns empty dict if running_summary is None.
    
    Example:
        >>> from langmem.short_term import RunningSummary
        >>> rs = RunningSummary(summary="...", summarized_message_ids={"msg_1"})
        >>> data = serialize_running_summary(rs)
        >>> print(data.keys())
        dict_keys(['summary', 'summarized_message_ids', 'last_summarized_message_id', ...])
    
    """
    if running_summary is None:
        return {}
    
    return {
        'summary': getattr(running_summary, 'summary', ''),
        'summarized_message_ids': list(
            getattr(running_summary, 'summarized_message_ids', set())
        ),
        'last_summarized_message_id': getattr(
            running_summary, 'last_summarized_message_id', None
        ),
        'serialized_at': datetime.now(UTC).isoformat(),
    }


def deserialize_running_summary(data: dict[str, Any]) -> RunningSummary | None:
    """Restore a LangMem RunningSummary from stored dictionary.
    
    This is used to restore the running summary from checkpointer state.
    
    Args:
        data: Dictionary previously created by serialize_running_summary().
            Must contain at least a 'summary' key with non-empty value.
    
    Returns:
        A RunningSummary object, or None if data is empty, invalid, or
        if langmem is not installed.
    
    Example:
        >>> data = {'summary': '...', 'summarized_message_ids': ['msg_1']}
        >>> rs = deserialize_running_summary(data)
        >>> print(rs.summary)
        ...
    
    """
    if not data or not data.get('summary'):
        return None
    
    try:
        # Import here to avoid requiring langmem when not using summarization
        from langmem.short_term import RunningSummary
        
        return RunningSummary(
            summary=data['summary'],
            summarized_message_ids=set(data.get('summarized_message_ids', [])),
            last_summarized_message_id=data.get('last_summarized_message_id'),
        )
    except ImportError:
        logger.warning(
            "langmem not available, cannot deserialize RunningSummary. "
            "Install with: pip install langmem"
        )
        return None
    except (TypeError, KeyError, ValueError) as e:
        logger.warning(
            "Failed to deserialize RunningSummary due to invalid data (%s): %s",
            type(e).__name__,
            e,
        )
        return None
    except Exception as e:
        logger.warning(
            "Unexpected error deserializing RunningSummary (%s): %s",
            type(e).__name__,
            e,
            exc_info=True,
        )
        return None


def create_summary_system_message(summary: str) -> SystemMessage:
    """Create a SystemMessage containing the conversation summary.
    
    This message is injected into the conversation to provide context
    from previous turns that have been summarized.
    
    Args:
        summary: The conversation summary text.
    
    Returns:
        A SystemMessage with the summary and a generated ID.
    
    Example:
        >>> msg = create_summary_system_message("The user discussed...")
        >>> print(msg.content[:20])
        [Previous Context]
    
    """
    # Format the summary with clear markers
    formatted_content = (
        "[Previous Context Summary]\n"
        f"{summary}\n"
        "[End of Summary - Continue from here]"
    )
    
    return SystemMessage(
        content=formatted_content,
        id=f"summary_{uuid.uuid4().hex[:8]}",
    )


# Module-level exports
__all__ = [
    "ensure_message_ids",
    "extract_summary_from_result",
    "serialize_running_summary",
    "deserialize_running_summary",
    "create_summary_system_message",
]
