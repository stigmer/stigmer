"""Session context merge utilities.

Merges session-level MCP server usages and skill refs with agent-level
equivalents, implementing the composition model defined in the proto:

    Agent blueprint (what the agent IS)
      + Session context (what the user BRINGS)
      = Merged context (what actually runs)

Merge semantics are specified in the proto comments on SessionSpec:
- MCP server usages: union by slug; session-level entry takes full precedence
  on slug collision (replaces the entire McpServerUsage, including enabled_tools
  and tool_approval_overrides).
- Skill refs: union by slug; deduplicated (no override concept — skills are
  pure content injection).

Reference:
- Proto: apis/ai/stigmer/agentic/session/v1/spec.proto (SessionSpec fields 7-8)
- Proto: apis/ai/stigmer/agentic/agent/v1/spec.proto (McpServerUsage)
"""

import logging
from collections.abc import Iterable

from ai.stigmer.agentic.agent.v1.spec_pb2 import McpServerUsage
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference

logger = logging.getLogger(__name__)


def merge_mcp_server_usages(
    agent_usages: Iterable[McpServerUsage],
    session_usages: Iterable[McpServerUsage],
) -> list[McpServerUsage]:
    """Merge agent-level and session-level MCP server usages.

    Produces a union keyed by ``mcp_server_ref.slug``.  When both sources
    reference the same slug, the session-level entry wins entirely (the
    agent-level entry is replaced, not field-merged).  This allows a user
    to restrict or expand ``enabled_tools`` and ``tool_approval_overrides``
    for a specific conversation without modifying the agent blueprint.

    Args:
        agent_usages: MCP server usages from the agent blueprint
            (``agent.spec.mcp_server_usages``).
        session_usages: MCP server usages attached at session creation
            (``session.spec.mcp_server_usages``).

    Returns:
        Merged list of McpServerUsage protos ready for downstream
        consumption (MCP server fetching, config transformation,
        approval policy construction).
    """
    merged: dict[str, McpServerUsage] = {}

    for usage in agent_usages:
        slug = usage.mcp_server_ref.slug
        if slug:
            merged[slug] = usage

    agent_slugs = set(merged.keys())

    for usage in session_usages:
        slug = usage.mcp_server_ref.slug
        if slug:
            merged[slug] = usage

    session_slugs = {
        u.mcp_server_ref.slug for u in session_usages if u.mcp_server_ref.slug
    }
    overridden = agent_slugs & session_slugs
    added = session_slugs - agent_slugs

    if overridden or added:
        parts: list[str] = []
        if added:
            parts.append(f"added={sorted(added)}")
        if overridden:
            parts.append(f"overridden={sorted(overridden)}")
        logger.info("Session-level MCP server merge: %s", ", ".join(parts))

    return list(merged.values())


def merge_skill_refs(
    agent_refs: Iterable[ApiResourceReference],
    session_refs: Iterable[ApiResourceReference],
) -> list[ApiResourceReference]:
    """Merge agent-level and session-level skill refs.

    Produces a union keyed by ``slug``.  Agent-level refs are collected
    first; session-level refs that introduce new slugs are appended.
    Duplicate slugs are silently deduplicated (both reference the same
    Skill resource, so order is irrelevant).

    Args:
        agent_refs: Skill references from the agent blueprint
            (``agent.spec.skill_refs``).
        session_refs: Skill references attached at session creation
            (``session.spec.skill_refs``).

    Returns:
        Deduplicated list of ApiResourceReference protos ready for
        skill fetching.
    """
    seen_slugs: set[str] = set()
    unique_refs: list[ApiResourceReference] = []

    for ref in agent_refs:
        if ref.slug and ref.slug not in seen_slugs:
            seen_slugs.add(ref.slug)
            unique_refs.append(ref)

    session_added: list[str] = []
    for ref in session_refs:
        if ref.slug and ref.slug not in seen_slugs:
            seen_slugs.add(ref.slug)
            unique_refs.append(ref)
            session_added.append(ref.slug)

    if session_added:
        logger.info(
            "Session-level skill merge: added=%s", sorted(session_added)
        )

    return unique_refs
