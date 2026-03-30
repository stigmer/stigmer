"""Environment variable resolution for Graphton agent execution.

Resolves the merged environment from ExecutionContext — the single source
of truth for execution-scoped variables.  The workflow injects all
resolved variables into ExecutionContext before the activity starts, and
it persists until execution termination.
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


async def resolve_environment(
    *,
    execution_context_client: Any,
    execution_id: str,
    logger: logging.Logger,
) -> EnvironmentResult:
    """Resolve merged environment variables from ExecutionContext.

    ExecutionContext is created by the workflow with pre-merged env vars
    before the activity starts.  If it is absent or the lookup fails,
    the execution cannot proceed — the error propagates to the caller.

    Args:
        execution_context_client: ``ExecutionContextClient`` instance.
        execution_id: Current execution ID.
        logger: Activity logger.

    Returns:
        ``EnvironmentResult`` with merged vars and secret key set.

    Raises:
        ValueError: If no ExecutionContext exists for the execution.
    """
    exec_ctx = await execution_context_client.try_get_by_execution_id(
        execution_id,
    )

    if not exec_ctx:
        raise ValueError(
            f"No ExecutionContext found for execution {execution_id}. "
            "The workflow must create an ExecutionContext with merged "
            "environment variables before starting the activity."
        )

    merged_env_vars: dict[str, str] = {}
    secret_keys: set[str] = set()

    if exec_ctx.spec.data:
        for key, exec_value in exec_ctx.spec.data.items():
            merged_env_vars[key] = exec_value.value
            if exec_value.is_secret:
                secret_keys.add(key)

    logger.info(
        "Resolved environment from ExecutionContext: "
        "context_id=%s, env_count=%d, secret_count=%d",
        exec_ctx.metadata.id,
        len(merged_env_vars),
        len(secret_keys),
    )

    return EnvironmentResult(
        merged_env_vars=merged_env_vars,
        secret_keys=secret_keys,
    )
