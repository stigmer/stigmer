"""Stateless content-extraction and display-formatting utilities.

Every function in this module is a pure transform with no dependency on
``StatusBuilder`` state.  They are leaf-level helpers imported by other
handler modules and by ``StatusBuilder`` itself.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from google.protobuf.struct_pb2 import Struct

_logger = logging.getLogger(__name__)


def block_attr(block: Any, key: str, default: str = "") -> str:
    """Read *key* from a content block regardless of whether it is a
    ``dict`` or an object with attributes (e.g. a LangChain dataclass)."""
    if isinstance(block, dict):
        return block.get(key, default)
    return getattr(block, key, default)


def extract_string_content(content_blocks: list) -> str:
    """Extract text from multimodal content blocks.

    Handles both dict blocks (``{"type": "text", "text": "..."}``) and
    attribute-based objects (``block.type == "text"``).
    """
    text_parts: list[str] = []
    for block in content_blocks:
        if block_attr(block, "type") == "text":
            text_parts.append(block_attr(block, "text"))
    return "".join(text_parts)


def extract_thinking_content(content_blocks: list) -> str:
    """Extract thinking text from Anthropic extended-thinking content blocks.

    Returns the concatenated thinking text from all blocks with
    ``type: "thinking"``.  Returns an empty string when no thinking
    blocks are present (non-Anthropic models, or text/tool_use chunks).

    Handles both dict blocks and attribute-based objects.
    """
    parts: list[str] = []
    for block in content_blocks:
        if block_attr(block, "type") == "thinking":
            parts.append(block_attr(block, "thinking"))
    return "".join(parts)


def unwrap_tool_args(args: dict[str, Any]) -> dict[str, Any]:
    """Unwrap LangGraph arg wrappers."""
    if "kwargs" in args and isinstance(args["kwargs"], dict):
        return args["kwargs"]
    if "input" in args and isinstance(args["input"], dict) and len(args) == 1:
        return args["input"]
    return args


def extract_command_content(update: dict[str, Any]) -> str:
    """Extract displayable content from a LangGraph Command.update dict.

    When a tool goes through the interrupt()/resume approval cycle,
    LangGraph may wrap the result in a Command object whose .update dict
    contains state channel mutations. The "messages" channel typically holds
    ToolMessage objects with the human-readable tool result.

    Extraction strategy:
    1. Look in update["messages"] for ToolMessage-like objects with .content
    2. Fall back to JSON-serializing the non-messages portion of the update

    Returns an empty string if no meaningful content can be extracted.
    """
    messages = update.get("messages", [])
    if isinstance(messages, list):
        for msg in messages:
            if hasattr(msg, "content"):
                content = msg.content
                if isinstance(content, str) and content:
                    return content
                if isinstance(content, list):
                    extracted = extract_string_content(content)
                    if extracted:
                        return extracted

    fallback = {k: v for k, v in update.items() if k != "messages"}
    if fallback:
        try:
            return json.dumps(fallback, indent=2, default=str)
        except (TypeError, ValueError):
            pass

    return ""


def extract_tool_result_content(result: Any) -> str:
    """Extract displayable content string from a tool result.

    Handles the five result shapes that flow through LangGraph astream_events:

    - str: Direct string results (most common for simple tools)
    - LangGraph message objects (ToolMessage, AIMessage): Extract .content
    - LangGraph Command objects: Extract ToolMessage content from .update
    - dict: Extract from 'output'/'content' keys, or JSON-serialize
    - list: Extract text from MCP content blocks, or JSON-serialize
    """
    if isinstance(result, str):
        return result
    if hasattr(result, "content"):
        content = result.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return extract_string_content(content)
    if hasattr(result, "update") and isinstance(getattr(result, "update", None), dict):
        return extract_command_content(result.update)
    if isinstance(result, dict):
        if "output" in result:
            return result.get("output", "")
        if "content" in result:
            return str(result["content"])
        return json.dumps(result, indent=2)
    if isinstance(result, list):
        extracted = extract_string_content(result)
        if extracted:
            return extracted
        try:
            return json.dumps(result, indent=2, default=str)
        except (TypeError, ValueError):
            pass
    _logger.warning(
        "[TOOL] Unknown result type %s for tool result extraction, "
        "falling back to str(). Preview: %s",
        type(result).__name__, str(result)[:200],
    )
    return str(result)


def format_tool_message_content(
    tool_name: str,
    args: Struct | None,
    result: str,
) -> str:
    """Format tool message content for CLI display.

    Creates a human-readable summary of the tool call for streaming display.

    Returns:
        Formatted string like ``"read(path='file.txt') -> 123 chars"``
    """
    args_summary = ""
    if args:
        try:
            args_dict = dict(args.fields)
            if args_dict:
                first_key = next(iter(args_dict))
                first_value = args_dict[first_key]
                if hasattr(first_value, 'string_value') and first_value.string_value:
                    value_str = first_value.string_value
                    if len(value_str) > 40:
                        value_str = value_str[:37] + "..."
                    args_summary = f"{first_key}='{value_str}'"
                elif hasattr(first_value, 'number_value'):
                    args_summary = f"{first_key}={first_value.number_value}"
                elif hasattr(first_value, 'bool_value'):
                    args_summary = f"{first_key}={first_value.bool_value}"

                if len(args_dict) > 1:
                    args_summary += f", +{len(args_dict) - 1} more"
        except Exception:
            pass

    result_summary = ""
    if result:
        if len(result) > 100:
            result_summary = f"{len(result)} chars"
        else:
            result_summary = result.replace('\n', ' ')[:80]

    if args_summary:
        call_str = f"{tool_name}({args_summary})"
    else:
        call_str = f"{tool_name}()"

    if result_summary:
        return f"{call_str} -> {result_summary}"
    else:
        return call_str
