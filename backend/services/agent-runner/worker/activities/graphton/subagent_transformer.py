"""SubAgent transformation utilities.

This module transforms proto SubAgent definitions to graphton's subagent format,
including:
- Platform tool propagation (filesystem + execution tools from the parent sandbox)
- MCP access restriction (filtering parent's MCP servers based on McpAccess grants)
- Skill resolution and injection into system prompts
- Tool wrapper creation for each subagent

Design Decisions:
- Every subagent receives the full set of platform tools (read, write, ls, glob,
  grep, execute) from the parent's sandbox config.  Without these, subagents fall
  back to deepagents' in-memory file primitives and lose shell execution, making
  skill scripts (e.g. init_skill.py) unusable.
- Each subagent gets its own McpToolsLoader with filtered MCP config
- Skills are fetched in batch to minimize gRPC calls
- Invalid configurations are logged as warnings and skipped (fail gracefully)
- Empty subagent list returns None (no subagents configured)

Reference:
- Proto: apis/ai/stigmer/agentic/agent/v1/spec.proto (SubAgent, McpAccess)
- Graphton: backend/libs/python/graphton/src/graphton/core/agent.py (subagents parameter)
"""

import logging
from collections.abc import Callable
from typing import Any

from ai.stigmer.agentic.agent.v1.spec_pb2 import McpAccess, McpServerUsage, SubAgent
from ai.stigmer.agentic.skill.v1.api_pb2 import Skill
from ai.stigmer.commons.apiresource.io_pb2 import ApiResourceReference
from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)

# =========================================================================
# Built-in subagent type constants and prompts
# =========================================================================

BUILTIN_SUBAGENT_TYPES: frozenset[str] = frozenset({"explore", "shell"})
"""Reserved subagent names that trigger built-in type creation."""

_EXPLORE_SYSTEM_PROMPT = """\
You are an exploration specialist. Your ONLY job is to explore codebases \
and report findings back to the parent agent.

STRICT BOUNDARIES:
- Use ONLY the read-only tools provided (read, ls, glob, grep, search)
- Do NOT write files, create files, or modify anything
- Do NOT execute shell commands
- Do NOT follow skill activation instructions from any context
- Do NOT create deliverables, scaffolds, or run initialization scripts
- Report your findings concisely — the parent agent has direct file access

Your task: {description}
"""

_SHELL_SYSTEM_PROMPT = """\
You are a command execution specialist. Your ONLY job is to run shell \
commands and report the results back to the parent agent.

STRICT BOUNDARIES:
- Use ONLY the tools provided (execute, read, ls)
- Do NOT write or modify files directly — use shell commands if needed
- Do NOT search extensively or explore the codebase beyond what is needed
- Do NOT follow skill activation instructions from any context
- Do NOT create deliverables, scaffolds, or run initialization scripts
- Report command output concisely — the parent agent will interpret results

Your task: {description}
"""

_BUILTIN_DESCRIPTIONS: dict[str, str] = {
    "explore": (
        "Read-only codebase exploration specialist. Use for searching, "
        "reading files, finding patterns, and understanding code structure. "
        "Cannot write files or execute commands."
    ),
    "shell": (
        "Command execution specialist. Use for running shell commands, "
        "build operations, and system tasks. Has minimal file read access."
    ),
}

_BUILTIN_PROMPTS: dict[str, str] = {
    "explore": _EXPLORE_SYSTEM_PROMPT,
    "shell": _SHELL_SYSTEM_PROMPT,
}

_BUILTIN_RESPONSE_RULES = (
    "\n\n## Response rules\n\n"
    "- After using the read tool, NEVER reprint, echo, list, or "
    "summarize file contents in your response. Tool results are "
    "already in your context. Proceed directly to the task.\n"
    "- Your response is returned to the parent agent as a task "
    "result. Return concise findings and actionable results — not "
    "raw file contents. The parent agent has direct access to the "
    "same files.\n"
    "- Do not begin responses with phrases like "
    '"Below is the complete content", '
    '"Here are the contents of the files", or similar.\n'
)


def create_builtin_subagents(
    sandbox_config: dict[str, Any] | None = None,
    approval_checker: Callable[[str, dict[str, Any]], Any] | None = None,
    activity_logger: logging.Logger | None = None,
) -> list[dict[str, Any]]:
    """Create built-in explore and shell subagent configurations.

    Built-in subagents receive:
    - Filtered platform tools (restricted to their type's allowed set)
    - Purpose-built system prompts with explicit scope boundaries
    - No skills, no MCP tools, no parent prompt inheritance

    Args:
        sandbox_config: Sandbox configuration for creating the backend.
            When None, no platform tools are created and an empty list
            is returned.
        approval_checker: Optional approval checker for HITL flow
        activity_logger: Logger for activity-level messages

    Returns:
        List of subagent dicts (one per built-in type) compatible with
        graphton's ``create_deep_agent(subagents=...)`` parameter.
        Empty list if no sandbox is configured.
    """
    log = activity_logger or logger

    if not sandbox_config:
        log.debug("No sandbox config — skipping built-in subagent creation")
        return []

    try:
        from graphton.core.sandbox_factory import create_sandbox_backend
        from graphton.core.tool_wrappers import (
            EXPLORE_TOOL_SET,
            SHELL_TOOL_SET,
            create_filtered_platform_tools,
        )

        sandbox_backend = create_sandbox_backend(sandbox_config)
    except Exception as e:
        log.error("Failed to create sandbox backend for built-in subagents: %s", e)
        return []

    tool_sets: dict[str, frozenset[str]] = {
        "explore": EXPLORE_TOOL_SET,
        "shell": SHELL_TOOL_SET,
    }

    result: list[dict[str, Any]] = []
    for subagent_type in ("explore", "shell"):
        try:
            tools = create_filtered_platform_tools(
                backend=sandbox_backend,
                allowed_tools=tool_sets[subagent_type],
                approval_checker=approval_checker,
                sub_agent_name=subagent_type,
            )

            system_prompt = _BUILTIN_PROMPTS[subagent_type] + _BUILTIN_RESPONSE_RULES

            subagent_dict: dict[str, Any] = {
                "name": subagent_type,
                "description": _BUILTIN_DESCRIPTIONS[subagent_type],
                "system_prompt": system_prompt,
                "tools": tools,
            }
            result.append(subagent_dict)
            log.info(
                "Created built-in '%s' subagent with %d tool(s)",
                subagent_type, len(tools),
            )
        except Exception as e:
            log.error("Failed to create built-in '%s' subagent: %s", subagent_type, e)

    return result


async def transform_sub_agents(
    sub_agents: list[SubAgent],
    parent_mcp_servers: dict[str, dict[str, Any]],
    parent_mcp_tools: dict[str, list[str]],
    parent_mcp_usages: list[McpServerUsage],
    skill_client: Any,  # SkillClient instance
    skill_writer_class: Any,  # SkillWriter class (typed as Any to avoid circular import)
    skill_writer_kwargs: dict[str, Any],  # kwargs for SkillWriter constructor
    sandbox_config: dict[str, Any] | None = None,
    approval_checker: Callable[[str, dict[str, Any]], Any] | None = None,
    activity_logger: logging.Logger | None = None,
    parent_has_native_thinking: bool = True,
) -> list[dict[str, Any]] | None:
    """Transform proto SubAgents to graphton format.
    
    This function converts proto SubAgent definitions to the format expected by
    graphton's create_deep_agent(subagents=...) parameter. Each subagent dict
    includes:
    - name, description, system_prompt (from proto)
    - tools: platform tools (filesystem + execute) plus MCP tool wrappers
      filtered based on McpAccess grants
    
    Args:
        sub_agents: List of SubAgent proto messages from AgentSpec.sub_agents
        parent_mcp_servers: Already-transformed parent MCP server configs
            (server_name → config dict)
        parent_mcp_tools: Parent's enabled tools per server
            (server_name → list of tool names)
        parent_mcp_usages: Parent's MCP server usage protos (for slug validation)
        skill_client: SkillClient instance for fetching skills
        skill_writer_class: SkillWriter class for generating prompt sections
        skill_writer_kwargs: Keyword arguments for SkillWriter constructor
        sandbox_config: Sandbox configuration dict for the agent (same config
            used by the parent agent).  When provided, every subagent receives
            platform tools (read, write, ls, glob, grep, execute) backed by
            this sandbox.
        approval_checker: Optional approval checker for HITL tool approval flow
        activity_logger: Logger for activity-level messages
        parent_has_native_thinking: Whether the parent's model supports native
            extended thinking.  When False and the sub-agent doesn't override
            the model, an explicit think tool is injected for structured
            reasoning.  Defaults to True (most current Anthropic models).
        
    Returns:
        List of subagent dicts compatible with graphton's subagents parameter,
        or None if no valid subagents after transformation.
        
    Example:
        >>> transformed = await transform_sub_agents(
        ...     sub_agents=list(agent.spec.sub_agents),
        ...     parent_mcp_servers=mcp_servers_config,
        ...     parent_mcp_tools=mcp_tools_config,
        ...     parent_mcp_usages=list(agent.spec.mcp_server_usages),
        ...     skill_client=skill_client,
        ...     skill_writer_class=SkillWriter,
        ...     skill_writer_kwargs={"local_root": "/tmp/sandbox"},
        ...     sandbox_config=sandbox_config_for_agent,
        ...     approval_checker=approval_checker,
        ...     activity_logger=logger,
        ... )
    """
    log = activity_logger or logger
    
    if not sub_agents:
        log.debug("No sub-agents to transform")
        return None
    
    log.info(f"Transforming {len(sub_agents)} sub-agent(s)")
    
    # Build slug → usage mapping for validation
    usage_by_slug = _build_usage_slug_map(parent_mcp_usages)
    
    # Collect all unique skill refs across all subagents for batch fetching
    all_skill_refs = _collect_all_skill_refs(sub_agents)
    
    # Batch fetch all skills
    skills_by_id: dict[str, Any] = {}
    skill_paths: dict[str, str] = {}
    if all_skill_refs:
        try:
            skills_by_id, skill_paths = await _fetch_skills_batch(
                skill_refs=all_skill_refs,
                skill_client=skill_client,
                skill_writer_class=skill_writer_class,
                skill_writer_kwargs=skill_writer_kwargs,
                log=log,
            )
        except Exception as e:
            log.error(f"Failed to fetch skills for subagents: {e}")
            # Continue without skills - graceful degradation
    
    # Create sandbox backend once (shared across sub-agents).  Platform tool
    # wrappers are created per-subagent inside _transform_single_subagent so
    # that each wrapper's interrupt payload carries the correct sub_agent_name,
    # enabling Phase 2 interrupt matching to work for sub-agent tools.
    sandbox_backend: Any = None
    if sandbox_config:
        try:
            from graphton.core.sandbox_factory import create_sandbox_backend

            sandbox_backend = create_sandbox_backend(sandbox_config)
            log.info("Created sandbox backend for sub-agent platform tools")
        except Exception as e:
            log.error(f"Failed to create sandbox backend for sub-agents: {e}")

    # Transform each subagent
    transformed_subagents = []
    
    for sub_agent in sub_agents:
        try:
            subagent_dict = await _transform_single_subagent(
                sub_agent=sub_agent,
                parent_mcp_servers=parent_mcp_servers,
                parent_mcp_tools=parent_mcp_tools,
                usage_by_slug=usage_by_slug,
                skills_by_id=skills_by_id,
                skill_paths=skill_paths,
                skill_writer_class=skill_writer_class,
                sandbox_backend=sandbox_backend,
                approval_checker=approval_checker,
                log=log,
                parent_has_native_thinking=parent_has_native_thinking,
            )
            
            if subagent_dict:
                transformed_subagents.append(subagent_dict)
                log.info(
                    f"Transformed sub-agent '{sub_agent.name}' with "
                    f"{len(subagent_dict.get('tools', []))} tool(s)"
                )
            else:
                log.warning(f"Sub-agent '{sub_agent.name}' transformation failed, skipping")
                
        except Exception as e:
            log.error(f"Failed to transform sub-agent '{sub_agent.name}': {e}")
            # Continue with other subagents - graceful degradation
    
    if not transformed_subagents:
        log.warning("No valid subagents after transformation")
        return None
    
    log.info(f"Successfully transformed {len(transformed_subagents)} sub-agent(s)")
    return transformed_subagents


def _build_usage_slug_map(
    parent_mcp_usages: list[McpServerUsage],
) -> dict[str, McpServerUsage]:
    """Build mapping from MCP server slug to usage proto.
    
    Args:
        parent_mcp_usages: List of parent's McpServerUsage protos
        
    Returns:
        Dictionary mapping slug → McpServerUsage
    """
    usage_by_slug = {}
    for usage in parent_mcp_usages:
        slug = usage.mcp_server_ref.slug
        if slug:
            usage_by_slug[slug] = usage
    return usage_by_slug


def _collect_all_skill_refs(
    sub_agents: list[SubAgent],
) -> list[ApiResourceReference]:
    """Collect all unique skill refs across all subagents.
    
    Args:
        sub_agents: List of SubAgent protos
        
    Returns:
        Deduplicated list of skill references
    """
    seen_slugs = set()
    unique_refs = []
    
    for sub_agent in sub_agents:
        for ref in sub_agent.skill_refs:
            # Use slug as dedup key (most reliable identifier)
            if ref.slug and ref.slug not in seen_slugs:
                seen_slugs.add(ref.slug)
                unique_refs.append(ref)
    
    return unique_refs


async def _fetch_skills_batch(
    skill_refs: list[ApiResourceReference],
    skill_client: Any,
    skill_writer_class: Any,  # SkillWriter class (typed as Any to avoid circular import)
    skill_writer_kwargs: dict[str, Any],
    log: logging.Logger,
) -> tuple[dict[str, Skill], dict[str, str]]:
    """Fetch skills in batch and write to sandbox.
    
    Args:
        skill_refs: List of skill references to fetch
        skill_client: SkillClient instance
        skill_writer_class: SkillWriter class
        skill_writer_kwargs: kwargs for SkillWriter constructor
        log: Logger instance
        
    Returns:
        Tuple of (skills_by_id, skill_paths) where:
        - skills_by_id: dict mapping skill ID → Skill proto
        - skill_paths: dict mapping skill ID → sandbox path
    """
    log.info(f"Fetching {len(skill_refs)} skill(s) for subagents")
    
    # Fetch skills via gRPC
    skills = await skill_client.list_by_refs(skill_refs)
    
    if not skills:
        log.warning("No skills returned from fetch")
        return {}, {}
    
    # Download artifacts for skills that have storage keys
    artifacts = {}
    for skill in skills:
        if skill.status.artifact_storage_key:
            try:
                artifact_bytes = await skill_client.get_artifact(
                    skill.status.artifact_storage_key
                )
                artifacts[skill.metadata.id] = artifact_bytes
                log.debug(
                    f"Downloaded artifact for skill {skill.metadata.name}: "
                    f"{len(artifact_bytes)} bytes"
                )
            except Exception as e:
                log.warning(
                    f"Failed to download artifact for skill {skill.metadata.name}: {e}. "
                    "Using SKILL.md only."
                )
    
    # Write skills to sandbox
    skill_writer = skill_writer_class(**skill_writer_kwargs)
    skill_paths = skill_writer.write_skills(skills, artifacts=artifacts)
    
    # Build ID → Skill mapping
    skills_by_id = {skill.metadata.id: skill for skill in skills}
    
    log.info(f"Successfully fetched and wrote {len(skills)} skill(s) for subagents")
    
    return skills_by_id, skill_paths


async def _transform_single_subagent(
    sub_agent: SubAgent,
    parent_mcp_servers: dict[str, dict[str, Any]],
    parent_mcp_tools: dict[str, list[str]],
    usage_by_slug: dict[str, McpServerUsage],
    skills_by_id: dict[str, Any],
    skill_paths: dict[str, str],
    skill_writer_class: Any,  # SkillWriter class (typed as Any to avoid circular import)
    sandbox_backend: Any,  # noqa: ANN401
    approval_checker: Callable[[str, dict[str, Any]], Any] | None,
    log: logging.Logger,
    parent_has_native_thinking: bool = True,
) -> dict[str, Any] | None:
    """Transform a single SubAgent proto to graphton dict format.
    
    Args:
        sub_agent: SubAgent proto message
        parent_mcp_servers: Parent's transformed MCP server configs
        parent_mcp_tools: Parent's enabled tools per server
        usage_by_slug: Mapping from slug → parent McpServerUsage
        skills_by_id: Pre-fetched skills by ID
        skill_paths: Skill paths in sandbox
        skill_writer_class: SkillWriter class for prompt generation
        sandbox_backend: Pre-created sandbox backend instance (shared) used
            to create per-subagent platform tools.  May be None when no
            sandbox is configured.
        approval_checker: Optional approval checker for HITL
        log: Logger instance
        
    Returns:
        Subagent dict with name, description, system_prompt, tools
        or None if transformation fails
    """
    name = sub_agent.name
    description = sub_agent.description or f"Sub-agent: {name}"
    
    # Build system prompt: instructions + skills
    system_prompt = sub_agent.instructions
    
    # Resolve skills for this subagent
    if sub_agent.skill_refs:
        subagent_skills = []
        subagent_skill_paths = {}
        
        for ref in sub_agent.skill_refs:
            # Find skill by slug matching
            for skill_id, skill in skills_by_id.items():
                if skill.metadata.slug == ref.slug:
                    subagent_skills.append(skill)
                    if skill_id in skill_paths:
                        subagent_skill_paths[skill_id] = skill_paths[skill_id]
                    break
        
        if subagent_skills:
            skills_prompt_section = skill_writer_class.generate_prompt_section(
                subagent_skills, subagent_skill_paths
            )
            system_prompt += skills_prompt_section
            log.debug(
                f"Sub-agent '{name}' has {len(subagent_skills)} skill(s): "
                f"{[s.metadata.name for s in subagent_skills]}"
            )
    
    # Build the combined tool set: platform tools first, then MCP tools.
    # Platform tools are created per-subagent so each wrapper's interrupt
    # payload carries the correct sub_agent_name (required for Phase 2
    # interrupt matching).  MCP tools are added on top based on the
    # subagent's McpAccess grants.
    tools: list[BaseTool] = []
    if sandbox_backend is not None:
        from graphton.core.tool_wrappers import create_platform_tool_wrappers

        tools = list(create_platform_tool_wrappers(  # type: ignore[arg-type]
            backend=sandbox_backend,
            approval_checker=approval_checker,
            sub_agent_name=name,
        ))

    mcp_middleware = None
    if sub_agent.mcp_access:
        filtered_servers, filtered_tools = _filter_mcp_for_subagent(
            mcp_access_list=list(sub_agent.mcp_access),
            parent_mcp_servers=parent_mcp_servers,
            parent_mcp_tools=parent_mcp_tools,
            usage_by_slug=usage_by_slug,
            log=log,
        )
        
        if filtered_servers and filtered_tools:
            try:
                mcp_tool_wrappers, mcp_middleware = await _create_subagent_mcp_tools(
                    mcp_servers=filtered_servers,
                    mcp_tools=filtered_tools,
                    approval_checker=approval_checker,
                    log=log,
                    sub_agent_name=name,
                )
                tools.extend(mcp_tool_wrappers)
                log.debug(
                    f"Sub-agent '{name}' has {len(mcp_tool_wrappers)} MCP tool(s) from "
                    f"{len(filtered_servers)} server(s)"
                )
            except Exception as e:
                mcp_middleware = None
                log.error(f"Failed to create MCP tools for sub-agent '{name}': {e}")
    
    # Append response rules so sub-agents don't echo raw file contents.
    # The sub-agent's final message becomes the parent's tool result — if it
    # dumps file contents verbatim, it wastes tokens on both sides (sub-agent
    # output + parent input) and the parent already has direct file access.
    system_prompt += (
        "\n\n## Response rules\n\n"
        "- After using the read tool, NEVER reprint, echo, list, or "
        "summarize file contents in your response. Tool results are "
        "already in your context. Proceed directly to the task.\n"
        "- Your response is returned to the parent agent as a task "
        "result. Return concise findings and actionable results — not "
        "raw file contents. The parent agent has direct access to the "
        "same files.\n"
        "- Do not begin responses with phrases like "
        '"Below is the complete content", '
        '"Here are the contents of the files", or similar.\n'
    )

    # Validate model_override against the ModelRegistry when set.
    # Fail-fast: if the override names a model that doesn't exist in the
    # registry, the sub-agent is skipped entirely rather than silently
    # falling back to the parent's model.  This forces operators to fix
    # their agent config instead of running on an unintended model.
    model_override: str | None = None
    if sub_agent.model_override:
        from graphton.core.model_registry import ModelRegistry

        candidate = sub_agent.model_override
        is_known = (
            ModelRegistry.is_registered(candidate)
            or ModelRegistry.get_by_api_model_id(candidate) is not None
        )
        if not is_known:
            log.error(
                "Sub-agent '%s' specifies model_override='%s' which is not "
                "recognised by the ModelRegistry. Skipping this sub-agent. "
                "Use a registered model name (e.g. 'claude-haiku-4.5') or "
                "a valid API model ID.",
                name,
                candidate,
            )
            return None
        model_override = candidate
        log.info("Sub-agent '%s' will use model override: %s", name, model_override)

    # Inject think tool when the resolved model lacks native extended thinking.
    # When model_override is set, check ModelRegistry for that model's thinking
    # capability.  When no override, use the parent's thinking state.
    sa_has_native_thinking = parent_has_native_thinking
    if model_override is not None:
        override_meta = ModelRegistry.get_or_default(model_override)
        sa_has_native_thinking = (
            override_meta.supports_thinking
            or override_meta.supports_adaptive_thinking
        )

    if not sa_has_native_thinking:
        from graphton.core.think_tool import create_think_tool

        tools.append(create_think_tool())
        log.info(
            "Injected think tool into sub-agent '%s' "
            "(model lacks native extended thinking)",
            name,
        )

    # Build the subagent dict in graphton format.
    # Always set ``tools`` so deepagents uses this explicit list rather
    # than falling back to the parent's tools (which would duplicate
    # platform tools while losing the MCP filtering).
    subagent_dict: dict[str, Any] = {
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "tools": tools,
    }

    # Include MCP middleware so its aafter_agent hook fires and closes
    # the AsyncExitStack holding stdio sessions.  Without this the exit
    # stack leaks until GC, triggering anyio cancel-scope errors during
    # event-loop shutdown.  See MCP SDK #577.
    if mcp_middleware is not None:
        subagent_dict["middleware"] = [mcp_middleware]

    if model_override is not None:
        subagent_dict["model"] = model_override
    
    return subagent_dict


def _filter_mcp_for_subagent(
    mcp_access_list: list[McpAccess],
    parent_mcp_servers: dict[str, dict[str, Any]],
    parent_mcp_tools: dict[str, list[str]],
    usage_by_slug: dict[str, McpServerUsage],
    log: logging.Logger,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    """Filter parent MCP configs based on SubAgent's McpAccess grants.
    
    Permission model:
    - SubAgent can only access MCP servers explicitly listed in mcp_access
    - SubAgent tools must be a subset of parent's enabled tools
    - Empty enabled_tools in McpAccess = all parent tools (no additional restriction)
    
    Args:
        mcp_access_list: List of McpAccess grants for this subagent
        parent_mcp_servers: Parent's transformed MCP server configs
        parent_mcp_tools: Parent's enabled tools per server
        usage_by_slug: Mapping from slug → parent McpServerUsage
        log: Logger instance
        
    Returns:
        Tuple of (filtered_servers, filtered_tools) for this subagent
    """
    filtered_servers = {}
    filtered_tools = {}
    
    for access in mcp_access_list:
        slug = access.mcp_server
        
        if not slug:
            log.warning("McpAccess has empty mcp_server slug, skipping")
            continue
        
        # Validate: slug must exist in parent's usages
        if slug not in usage_by_slug:
            log.warning(
                f"SubAgent references unknown MCP server '{slug}' "
                "(not in parent's mcp_server_usages), skipping"
            )
            continue
        
        # Validate: server must be in transformed parent configs
        if slug not in parent_mcp_servers:
            log.warning(
                f"MCP server '{slug}' not in parent's transformed configs "
                "(may have failed to transform), skipping"
            )
            continue
        
        # Copy server config (subagent uses same server connection as parent)
        filtered_servers[slug] = parent_mcp_servers[slug]
        
        # Intersect tools: subagent tools ∩ parent tools
        parent_tools_for_server = parent_mcp_tools.get(slug, [])
        
        if access.enabled_tools:
            # Explicit restriction - intersect with parent
            # Only include tools that exist in both parent AND subagent access
            subagent_tools = []
            for tool_name in access.enabled_tools:
                if tool_name in parent_tools_for_server:
                    subagent_tools.append(tool_name)
                else:
                    log.warning(
                        f"SubAgent requests tool '{tool_name}' from server '{slug}' "
                        f"but it's not in parent's enabled tools, skipping tool"
                    )
            filtered_tools[slug] = subagent_tools
        else:
            # No restriction - inherit all parent tools for this server
            filtered_tools[slug] = list(parent_tools_for_server)
        
        if filtered_tools[slug]:
            log.debug(
                f"SubAgent granted access to server '{slug}' with tools: "
                f"{filtered_tools[slug]}"
            )
        else:
            # No valid tools after filtering - remove server
            log.warning(
                f"No valid tools for server '{slug}' after filtering, "
                "removing server from subagent"
            )
            del filtered_servers[slug]
            del filtered_tools[slug]
    
    return filtered_servers, filtered_tools


async def _create_subagent_mcp_tools(
    mcp_servers: dict[str, dict[str, Any]],
    mcp_tools: dict[str, list[str]],
    approval_checker: Callable[[str, dict[str, Any]], Any] | None,
    log: logging.Logger,
    sub_agent_name: str = "",
) -> tuple[list[BaseTool], Any]:
    """Create MCP tool wrappers for a subagent.
    
    This creates a separate McpToolsLoader for the subagent's filtered MCP config
    and generates tool wrappers that the subagent can use.
    
    Args:
        mcp_servers: Filtered MCP server configs for this subagent
        mcp_tools: Filtered tool names per server for this subagent
        approval_checker: Optional approval checker for HITL
        log: Logger instance
        sub_agent_name: Name of the owning sub-agent. Threaded into
            ``create_approval_aware_tool_wrapper`` so the interrupt
            payload carries ``from_sub_agent=True``.
        
    Returns:
        Tuple of (tool wrappers, McpToolsLoader middleware).  The caller
        must add the middleware to the subagent's ``middleware`` list so
        its ``aafter_agent`` hook runs and closes the MCP sessions.
        
    Raises:
        RuntimeError: If MCP tool loading fails
    """
    # Import graphton utilities for tool creation
    from graphton.core.middleware import McpToolsLoader
    from graphton.core.tool_wrappers import (
        create_approval_aware_tool_wrapper,
        create_tool_wrapper,
    )
    
    # Create McpToolsLoader for subagent's filtered config
    # Note: This creates a new MCP session for the subagent's tools
    mcp_middleware = McpToolsLoader(
        servers=mcp_servers,
        tool_filter=mcp_tools,
    )
    
    # Handle deferred loading (async context)
    if mcp_middleware._deferred_loading:
        await mcp_middleware._load_tools_async()
        mcp_middleware._deferred_loading = False
    
    # Create tool wrappers
    tools: list[BaseTool] = []
    
    for server_name, tool_names in mcp_tools.items():
        for tool_name in tool_names:
            try:
                if approval_checker is not None:
                    wrapper = create_approval_aware_tool_wrapper(
                        tool_name=tool_name,
                        middleware_instance=mcp_middleware,
                        approval_checker=approval_checker,
                        mcp_server_name=server_name,
                        sub_agent_name=sub_agent_name,
                    )
                else:
                    # Standard flow: use regular wrappers
                    wrapper = create_tool_wrapper(tool_name, mcp_middleware)
                
                tools.append(wrapper)  # type: ignore[arg-type]
                
            except Exception as e:
                log.error(
                    f"Failed to create wrapper for tool '{tool_name}' "
                    f"from server '{server_name}': {e}"
                )
                # Continue with other tools - graceful degradation
    
    log.debug(f"Created {len(tools)} MCP tool wrapper(s) for subagent")
    
    return tools, mcp_middleware
