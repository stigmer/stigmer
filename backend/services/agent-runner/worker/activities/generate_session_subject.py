"""Temporal activity for generating meaningful session subjects using LLM.

Auto-creates concise conversation titles (like ChatGPT/Claude) by analyzing
the user's first message and agent context. Runs fire-and-forget alongside
main agent execution — failures are logged but never propagate.
"""

from __future__ import annotations

import logging

import grpc
from graphton.core import ModelRegistry
from graphton.core.models import parse_model_string
from langchain_core.messages import HumanMessage, SystemMessage
from temporalio import activity

from grpc_client.agent_client import AgentClient
from grpc_client.agent_execution_client import AgentExecutionClient
from grpc_client.agent_instance_client import AgentInstanceClient
from grpc_client.channel import ChannelProvider
from grpc_client.session_client import SessionClient
from worker.auth import get_token
from worker.config import Config

_AUTO_CREATED_SUBJECT = "Auto-created session"
_MAX_SUBJECT_LENGTH = 50

_SYSTEM_PROMPT = """\
You are a session title generator. Given a user's message and agent context, \
produce a concise conversation title.

Rules:
- 3 to 7 words, maximum 50 characters
- Capture the user's core intent or topic
- Be specific (e.g. "PostgreSQL Multi-AZ Setup" not "Database Help")
- No filler words ("help with", "question about", "I need")
- No quotes, no punctuation at the end
- Output ONLY the title, nothing else"""

activity_logger = logging.getLogger(__name__)


@activity.defn(name="GenerateSessionSubject")
async def generate_session_subject(
    execution_id: str,
    invoker_identity_account_id: str | None = None,
) -> None:
    """Generate and update session subject from the user's first message.

    Follows the slim-payload pattern: receives only ``execution_id`` and
    hydrates the full execution, session, and agent via gRPC.

    Uses an economy-tier LLM (e.g. claude-haiku-4, gpt-4o-mini, or the
    configured local model) to keep costs negligible.

    Args:
        execution_id: The agent execution ID to derive context from.
        invoker_identity_account_id: Retained in signature for Temporal
            contract compatibility. No longer used for OBO impersonation —
            the runner authenticates as the user directly.
    """
    activity_logger.info(
        "GenerateSessionSubject started for execution: %s", execution_id
    )

    try:
        await _generate_and_update_subject(execution_id)
    except Exception:
        activity_logger.exception(
            "Failed to generate session subject for execution %s", execution_id
        )


async def _generate_and_update_subject(execution_id: str) -> None:
    """Core implementation, separated for clean exception boundary."""
    token = get_token()
    if not token:
        activity_logger.warning(
            "Auth token not available, skipping subject generation"
        )
        return

    grpc_provider = ChannelProvider(token)
    ch = grpc_provider.channel

    try:
        execution_client = AgentExecutionClient(token, channel=ch)
        execution = await execution_client.get(execution_id)

        session_id = execution.spec.session_id
        agent_id: str | None = execution.spec.agent_id or None
        user_message = execution.spec.message

        if not session_id:
            activity_logger.info(
                "No session_id on execution, skipping subject generation"
            )
            return

        if not user_message:
            activity_logger.info(
                "No user message on execution, skipping subject generation"
            )
            return

        # Step 2: Check if subject still has the auto-created sentinel value
        session_client = SessionClient(token, channel=ch)
        session = await session_client.get(session_id)

        if session.spec.subject != _AUTO_CREATED_SUBJECT:
            activity_logger.info(
                "Session subject is '%s' (not auto-created), skipping generation",
                session.spec.subject,
            )
            return

        # Step 3: Resolve agent_id -- prefer execution spec, fall back to session chain
        if not agent_id:
            agent_id = await _resolve_agent_id_from_session(
                token, session, channel=ch
            )
        if not agent_id:
            activity_logger.warning(
                "Cannot resolve agent_id for execution %s, skipping subject generation",
                execution_id,
            )
            return

        # Step 4: Fetch agent metadata for prompt context
        agent_client = AgentClient(token, channel=ch)
        agent = await agent_client.get(agent_id)
        agent_name = agent.metadata.name
        agent_description = agent.spec.description or ""

        # Step 5: Generate title with economy-tier model
        generated_subject = await _generate_title(
            user_message, agent_name, agent_description
        )

        if not generated_subject:
            activity_logger.warning("LLM returned empty subject, skipping update")
            return

        # Step 6: Update subject via field-level RPC (race-safe).
        # This atomically sets only spec.subject on the server, avoiding
        # the lost-update race with sandbox_manager which concurrently
        # updates spec.sandbox_id on the same session.
        await session_client.update_subject(session_id, generated_subject)

        activity_logger.info(
            "Updated session %s subject to '%s'", session_id, generated_subject
        )
    finally:
        await grpc_provider.close()


async def _resolve_agent_id_from_session(
    token: str,
    session,
    *,
    channel: grpc.aio.Channel | None = None,
) -> str | None:
    """Resolve agent_id via the session chain: session -> agent_instance -> agent.

    This mirrors the chain resolution in execute_graphton.py and handles
    executions created with only session_id (e.g., follow-up messages or
    workspace-based runs where the CLI creates the session first).
    """
    agent_instance_id = session.spec.agent_instance_id
    if not agent_instance_id:
        activity_logger.warning(
            "Session %s has no agent_instance_id, cannot resolve agent",
            session.metadata.id,
        )
        return None

    agent_instance_client = AgentInstanceClient(token, channel=channel)
    agent_instance = await agent_instance_client.get(agent_instance_id)
    resolved = agent_instance.spec.agent_id

    if resolved:
        activity_logger.info(
            "Resolved agent_id=%s from session chain (instance=%s)",
            resolved,
            agent_instance_id,
        )
    return resolved or None


async def _generate_title(
    user_message: str,
    agent_name: str,
    agent_description: str,
) -> str | None:
    """Use an economy-tier LLM to generate a concise session title.

    Selects the cheapest model available for the configured provider
    via ``ModelRegistry.get_summarization_model()``, keeping costs
    negligible even at high session volume.

    Returns:
        The generated title (stripped and truncated), or None on failure.
    """
    worker_config = Config.load_from_env()
    economy_model = ModelRegistry.get_summarization_model(
        worker_config.llm.model_name
    )

    llm_kwargs = worker_config.llm.build_llm_kwargs(
        proxy_endpoint=worker_config.stigmer_proxy_endpoint,
        proxy_auth_token=worker_config.stigmer_token,
    )

    model = parse_model_string(
        economy_model,
        max_tokens=100,
        temperature=0.7,
        **llm_kwargs,
    )

    user_prompt = f'User\'s first message:\n"{user_message}"\n\nAgent: {agent_name}\n'
    if agent_description:
        user_prompt += f"Agent purpose: {agent_description}\n"
    user_prompt += "\nGenerate the title:"

    response = await model.ainvoke([
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])

    content = response.content
    if not isinstance(content, str):
        content = (
            "".join(str(part) for part in content)
            if isinstance(content, list)
            else str(content)
        )
    subject = content.strip().strip('"').strip("'")

    if subject and len(subject) > _MAX_SUBJECT_LENGTH:
        subject = subject[: _MAX_SUBJECT_LENGTH - 3] + "..."

    return subject or None
