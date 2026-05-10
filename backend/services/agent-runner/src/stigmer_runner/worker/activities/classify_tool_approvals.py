"""Temporal activity for classifying MCP tool approval policies via LLM.

Uses a lightweight structured-output LLM call to classify each tool
reported by an MCP server as safe (auto-approve) or sensitive (require
user approval before execution).  The classifier runs as part of the
connect workflow — after capability discovery, before results are stored.

This is the first ``with_structured_output`` usage in the agent-runner
codebase.  It replaces the agent-session-based policy generation that
was both expensive and slow.

The classifier output feeds ``McpServerStatus.tool_approvals`` — the
lowest-priority layer in the approval policy chain.  Manual overrides
(``pinned_tool_approvals``, ``tool_approval_overrides``) take precedence,
so false-positive classifications are easy to correct without touching
the classifier.

For MCP servers with large tool counts (>40), tools are classified in
batches to stay within LLM output token limits.  Each batch gets its own
structured-output call; results are merged.  If any batch fails, those
tools fall back to ``requires_approval: true`` (safe default).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, cast

from graphton.core import ModelRegistry
from graphton.core.models import parse_model_string
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from temporalio import activity

from stigmer_runner.worker import execution_tracker
from stigmer_runner.worker.config import Config

logger = logging.getLogger(__name__)

ACTIVITY_NAME = "ClassifyToolApprovals"

BATCH_SIZE = 40
MAX_TOKENS_PER_TOOL = 60
MIN_MAX_TOKENS = 4096

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Models (structured output schema)
# ─────────────────────────────────────────────────────────────────────────────


class ToolApprovalClassification(BaseModel):
    """Classification result for a single tool."""

    tool_name: str = Field(description="Exact tool name as reported by the MCP server")
    requires_approval: bool = Field(
        description="True if this tool performs mutations or has side effects"
    )
    message: str = Field(
        default="",
        description=(
            "Human-readable approval prompt shown to the user. "
            "Use {{args.field}} placeholders for dynamic values. "
            "Empty when requires_approval is false."
        ),
    )


class ClassifyToolApprovalsOutput(BaseModel):
    """Structured output from the tool approval classifier."""

    approvals: list[ToolApprovalClassification] = Field(
        description="One classification per tool, same order as input"
    )


# ─────────────────────────────────────────────────────────────────────────────
# System Prompt
# ─────────────────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a tool safety classifier for AI agent platforms.

Given a list of tools from an MCP server, classify each tool as either \
safe (auto-approve) or sensitive (requires human approval before execution).

Classification rules:

1. READ-ONLY operations → requires_approval: false
   Examples: search, list, get, query, read, fetch, describe, count
   These only retrieve data and have no side effects.

2. CREATE or MODIFY operations → requires_approval: true
   Examples: create, update, put, set, add, edit, modify, write, post, send
   These change state or create new resources.

3. DELETE or DESTRUCTIVE operations → requires_approval: true
   Examples: delete, remove, drop, purge, destroy, revoke, terminate
   These permanently remove or disable resources.

4. EXECUTE or INVOKE operations → requires_approval: true
   Examples: execute, run, invoke, call, trigger, deploy, apply
   These perform actions with external side effects.

For tools that require approval, write a concise message (under 80 chars) \
that describes the action using {{args.field}} placeholders to reference \
the tool's input parameters.  Choose the most relevant parameter names \
from the tool's input_schema.

Message guidelines:
- Start with an action verb: "Delete", "Create", "Send", "Execute"
- Include the most important identifier: {{args.repo}}, {{args.path}}, etc.
- Keep it specific: "Delete repository {{args.repo}}" not "Delete something"
- If unsure which field to use, use the tool name: "Execute tool_name"

For tools that do NOT require approval, leave message empty.

Output one classification per tool, maintaining the input order.\
"""


# ─────────────────────────────────────────────────────────────────────────────
# Core Function (no Temporal coupling)
# ─────────────────────────────────────────────────────────────────────────────


async def classify_tools(
    tools: list[dict[str, Any]],
    server_name: str,
    server_description: str,
    mcp_server_id: str | None = None,
) -> ClassifyToolApprovalsOutput:
    """Classify tool approval policies using a structured-output LLM call.

    Pure async function with no Temporal dependency — can be called from
    the connect workflow (via the Temporal activity wrapper) or directly
    from Graphton backfill.

    For large tool sets (>BATCH_SIZE), tools are split into batches and
    each batch is classified independently.  If any batch fails, those
    tools fall back to ``requires_approval: true`` so the connect
    workflow can still complete.

    Args:
        tools: List of tool dicts with ``name``, ``description``, and
            optional ``input_schema``.
        server_name: MCP server name (provides context for classification).
        server_description: MCP server description.
        mcp_server_id: MCP server ID passed as ``X-Stigmer-Mcp-Server-Id``
            proxy scope header.  When set, the proxy authorizes via FGA
            ``can_connect`` instead of requiring an agent execution scope.

    Returns:
        ClassifyToolApprovalsOutput with one classification per tool.
    """
    if not tools:
        return ClassifyToolApprovalsOutput(approvals=[])

    worker_config = Config.load_from_env()
    economy_model = ModelRegistry.get_summarization_model(
        worker_config.llm.model_name
    )

    llm_kwargs = worker_config.llm.build_llm_kwargs(
        proxy_endpoint=worker_config.stigmer_proxy_endpoint,
        proxy_auth_token=worker_config.stigmer_token,
        mcp_server_id=mcp_server_id,
    )

    batches = [
        tools[i : i + BATCH_SIZE] for i in range(0, len(tools), BATCH_SIZE)
    ]

    logger.info(
        "Classifying %d tools for MCP server '%s' using model '%s' "
        "(%d batch(es) of up to %d)",
        len(tools), server_name, economy_model, len(batches), BATCH_SIZE,
    )

    all_approvals: list[ToolApprovalClassification] = []

    for batch_idx, batch in enumerate(batches):
        try:
            batch_result = await _classify_batch(
                batch=batch,
                server_name=server_name,
                server_description=server_description,
                economy_model=economy_model,
                llm_kwargs=llm_kwargs,
                batch_idx=batch_idx,
                total_batches=len(batches),
            )
            all_approvals.extend(batch_result.approvals)
        except Exception:
            logger.exception(
                "Batch %d/%d failed for '%s' (%d tools) — falling back "
                "to requires_approval=true for this batch",
                batch_idx + 1, len(batches), server_name, len(batch),
            )
            all_approvals.extend(_fallback_approvals(batch))

    result = ClassifyToolApprovalsOutput(approvals=all_approvals)

    approval_count = sum(1 for a in result.approvals if a.requires_approval)
    logger.info(
        "Classification complete for '%s': %d/%d tools require approval",
        server_name, approval_count, len(result.approvals),
    )

    return result


async def _classify_batch(
    *,
    batch: list[dict[str, Any]],
    server_name: str,
    server_description: str,
    economy_model: str,
    llm_kwargs: dict[str, Any],
    batch_idx: int,
    total_batches: int,
) -> ClassifyToolApprovalsOutput:
    """Classify a single batch of tools via structured-output LLM call."""
    max_tokens = max(MIN_MAX_TOKENS, len(batch) * MAX_TOKENS_PER_TOOL)

    model = parse_model_string(
        economy_model,
        max_tokens=max_tokens,
        temperature=0.0,
        **llm_kwargs,
    )

    structured_model = model.with_structured_output(ClassifyToolApprovalsOutput)

    tools_payload = _build_tools_payload(batch)

    user_prompt = (
        f"MCP Server: {server_name}\n"
        f"Description: {server_description or 'No description provided'}\n\n"
        f"Tools to classify ({len(batch)}):\n\n"
        f"{tools_payload}"
    )

    logger.info(
        "Classifying batch %d/%d (%d tools, max_tokens=%d) for '%s'",
        batch_idx + 1, total_batches, len(batch), max_tokens, server_name,
    )

    raw_result = await structured_model.ainvoke([
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])
    result = cast(ClassifyToolApprovalsOutput, raw_result)

    logger.info(
        "Batch %d/%d complete for '%s': %d classification(s) returned",
        batch_idx + 1, total_batches, server_name, len(result.approvals),
    )

    return result


def _fallback_approvals(
    tools: list[dict[str, Any]],
) -> list[ToolApprovalClassification]:
    """Generate safe-default approvals when LLM classification fails.

    Marks every tool as requiring approval so the connect workflow can
    complete.  Users can override individual tools via pinned approvals.
    """
    return [
        ToolApprovalClassification(
            tool_name=tool.get("name", ""),
            requires_approval=True,
            message=f"Execute {tool.get('name', 'unknown tool')}",
        )
        for tool in tools
    ]


def _build_tools_payload(tools: list[dict[str, Any]]) -> str:
    """Format tool list as a compact JSON string for the LLM prompt.

    Each tool is a JSON object with name, description, and the relevant
    parts of input_schema (properties only — title/type/required are noise
    for classification purposes).
    """
    formatted: list[dict[str, Any]] = []
    for tool in tools:
        entry: dict[str, Any] = {
            "name": tool.get("name", ""),
            "description": tool.get("description", ""),
        }
        schema = tool.get("input_schema")
        if schema and isinstance(schema, dict):
            props = schema.get("properties")
            if props:
                entry["parameters"] = list(props.keys())
        formatted.append(entry)

    return json.dumps(formatted, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# Temporal Activity
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ClassifyToolApprovalsInput:
    """Temporal-serializable input for the classify activity.

    Uses plain dicts rather than proto messages so the input serializes
    cleanly in Temporal's JSON-based payload codec.
    """

    tools: list[dict[str, Any]]
    server_name: str
    server_description: str
    mcp_server_id: str | None = None


@activity.defn(name=ACTIVITY_NAME)
async def classify_tool_approvals(
    input: ClassifyToolApprovalsInput,
) -> list[dict[str, Any]]:
    """Temporal activity wrapper around :func:`classify_tools`.

    Returns a list of dicts (not a Pydantic model) for Temporal
    serialization compatibility.  Each dict has ``tool_name``,
    ``requires_approval``, and ``message``.
    """
    logger.info(
        "ClassifyToolApprovals activity started: %d tools for '%s'",
        len(input.tools), input.server_name,
    )

    execution_tracker.increment()
    try:
        result = await classify_tools(
            tools=input.tools,
            server_name=input.server_name,
            server_description=input.server_description,
            mcp_server_id=input.mcp_server_id,
        )

        approved = [a for a in result.approvals if a.requires_approval]
        logger.info(
            "Returning %d/%d tools that require approval for '%s'",
            len(approved), len(result.approvals), input.server_name,
        )

        return [a.model_dump() for a in approved]
    finally:
        execution_tracker.decrement()
