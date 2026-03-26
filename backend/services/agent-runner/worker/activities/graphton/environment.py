"""Environment variable resolution for Graphton agent execution.

Handles the two-path environment merge:
  1. ExecutionContext path — pre-merged by the workflow, single source of truth.
  2. Legacy 3-layer fallback — agent env_spec + environment_refs + runtime_env.

Extracted from ``execute_graphton.py``.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any


@dataclasses.dataclass(frozen=True)
class EnvironmentResult:
    """Output of :func:`resolve_environment`."""

    merged_env_vars: dict[str, str]
    secret_keys: set[str]
    used_legacy_merge: bool


async def resolve_environment(
    *,
    execution_context_client: Any,
    execution_id: str,
    agent: Any,
    agent_instance: Any,
    execution: Any,
    environment_client_factory: Any,
    api_key: str,
    obo_channel: Any,
    logger: logging.Logger,
) -> EnvironmentResult:
    """Resolve merged environment variables for an agent execution.

    Tries the ExecutionContext path first; falls back to the legacy
    3-layer merge when no ExecutionContext is available.

    Args:
        execution_context_client: ``ExecutionContextClient`` instance.
        execution_id: Current execution ID.
        agent: Agent proto with ``spec.env_spec``.
        agent_instance: AgentInstance proto with ``spec.environment_refs``.
        execution: AgentExecution proto with ``spec.runtime_env``.
        environment_client_factory: Callable that creates an ``EnvironmentClient``.
        api_key: API key for gRPC authentication.
        obo_channel: gRPC channel (on-behalf-of).
        logger: Activity logger.

    Returns:
        ``EnvironmentResult`` with merged vars, secret key set, and
        which path was used.
    """
    merged_env_vars: dict[str, str] = {}
    secret_keys: set[str] = set()
    use_legacy = True

    try:
        exec_ctx = await execution_context_client.try_get_by_execution_id(execution_id)

        if exec_ctx and exec_ctx.spec.data:
            logger.info(
                f"Using merged environment from ExecutionContext: "
                f"context_id={exec_ctx.metadata.id}, env_count={len(exec_ctx.spec.data)}"
            )
            for key, exec_value in exec_ctx.spec.data.items():
                merged_env_vars[key] = exec_value.value
                if exec_value.is_secret:
                    secret_keys.add(key)
            use_legacy = False
            logger.info(f"ExecutionContext environment: {len(merged_env_vars)} total vars")
        else:
            logger.debug(
                f"No ExecutionContext found for execution {execution_id} - "
                "using legacy environment merge"
            )
    except Exception as e:
        logger.warning(
            f"Failed to get ExecutionContext, falling back to legacy merge: {e}"
        )

    if use_legacy:
        # Layer 1: agent env_spec defaults
        if agent.spec.env_spec and agent.spec.env_spec.data:
            for key, env_value in agent.spec.env_spec.data.items():
                merged_env_vars[key] = env_value.value
                if env_value.is_secret:
                    secret_keys.add(key)
            logger.info(f"[Legacy] Base env vars from agent: {len(agent.spec.env_spec.data)}")

        # Layer 2: environment_refs
        environment_refs = agent_instance.spec.environment_refs
        if environment_refs:
            logger.info(
                f"[Legacy] Merging {len(environment_refs)} environments: "
                f"{[ref.slug for ref in environment_refs]}"
            )
            try:
                environment_client = environment_client_factory(api_key, channel=obo_channel)
                environments = await environment_client.list_by_refs(list(environment_refs))

                for idx, env in enumerate(environments):
                    if env.spec.data:
                        for key, env_value in env.spec.data.items():
                            merged_env_vars[key] = env_value.value
                            if env_value.is_secret:
                                secret_keys.add(key)
                        logger.info(
                            f"[Legacy] Merged env {idx+1}/{len(environments)} ({env.metadata.name}): "
                            f"{len(env.spec.data)} vars"
                        )
            except Exception as e:
                logger.error(f"[Legacy] Failed to merge environment_refs: {e}")

        # Layer 3: runtime_env CLI overrides (highest priority)
        if execution.spec.runtime_env:
            for key, value in execution.spec.runtime_env.items():
                merged_env_vars[key] = value.value
                if value.is_secret:
                    secret_keys.add(key)
            logger.info(f"[Legacy] Applied runtime env overrides: {len(execution.spec.runtime_env)} vars")

        logger.info(f"[Legacy] Final merged environment: {len(merged_env_vars)} total vars")

    return EnvironmentResult(
        merged_env_vars=merged_env_vars,
        secret_keys=secret_keys,
        used_legacy_merge=use_legacy,
    )
