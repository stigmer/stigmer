"""Execution setup pipeline for Graphton agent.

Hydrates the execution from the database, resolves the full resource chain
(session -> agent_instance -> agent), provisions workspace and sandbox,
loads skills / MCP servers / environment, creates the LangGraph agent graph,
and returns a ``SetupResult`` containing everything the streaming phase needs.

Extracted from ``execute_graphton.py``.
"""

from __future__ import annotations

import contextlib
import dataclasses
import logging
import os
from typing import TYPE_CHECKING, Any

from graphton import SummarizationConfig, create_deep_agent
from graphton.core import ModelRegistry

from grpc_client.agent_client import AgentClient
from grpc_client.agent_execution_client import AgentExecutionClient
from grpc_client.agent_instance_client import AgentInstanceClient
from grpc_client.execution_context_client import ExecutionContextClient
from grpc_client.mcp_server_client import McpServerClient
from grpc_client.session_client import SessionClient
from grpc_client.skill_client import SkillClient
from worker.activities.graphton.approval_policy import (
    build_approval_config,
    create_approval_checker,
)
from worker.activities.graphton.attachments import inject_attachments
from worker.activities.graphton.inline_publisher import InlinePublisher
from worker.activities.graphton.prompt_builder import enhance_system_prompt
from worker.activities.graphton.session_context_merge import (
    merge_mcp_server_usages,
    merge_skill_refs,
)
from worker.activities.graphton.skill_writer import SkillWriter
from worker.activities.graphton.status_builder import StatusBuilder
from worker.activities.graphton.subagent_transformer import (
    create_builtin_subagents,
    transform_sub_agents,
)
from worker.activities.graphton.temporal_helpers import (
    SetupTimer,
    heartbeat_during_setup,
    report_setup_progress,
)
from worker.activities.graphton.temporal_helpers import (
    run_sync_with_heartbeat as _run_sync_with_heartbeat,
)
from worker.activities.graphton.tool_call_id_capture import ToolCallIdCapture
from worker.activities.relevance import (
    WorkspaceRoot,
    build_relevance_prompt_section,
)
from worker.checkpointer import create_checkpointer
from worker.mcp import transform_all_mcp_configs
from worker.sandbox_manager import SandboxManager
from worker.storage import create_artifact_storage
from worker.workspace import (
    LocalWorkspaceBackend,
    ProvisionResult,
    SourceType,
    WorkspaceProvisioner,
    WorkspaceProvisionError,
    initialize_workspace,
)

if TYPE_CHECKING:
    from grpc_client.channel import ChannelProvider
    from worker.activities.graphton.writeback_coordinator import WriteBackCoordinator
    from worker.resilience import GrpcRetryExecutor
    from worker.workspace import WorkspaceBackend

# Sentinel value matching the LANGGRAPH_DEFAULT_RECURSION_LIMIT env var
# set in daemon_process.go.  Used when the user does not configure
# max_tool_rounds — effectively "unlimited" (loop detection middleware
# is the primary behavioral safety).
_LANGGRAPH_UNLIMITED_RECURSION = 10_000_000


@dataclasses.dataclass(frozen=True)
class SetupResult:
    """Everything the streaming, post-stream, HITL resume, error handler,
    and cleanup phases need from execution setup.
    """

    agent_graph: Any
    config: dict[str, Any]
    status_builder: StatusBuilder
    execution_client: AgentExecutionClient
    retry_executor: GrpcRetryExecutor
    workspace_backend: WorkspaceBackend
    sandbox: Any | None
    artifact_storage: Any
    inline_publisher: InlinePublisher
    writeback_coordinator: WriteBackCoordinator | None
    merged_env_vars: dict[str, str]
    secret_keys: set[str]
    effective_recursion_limit: int
    langgraph_input: dict[str, Any]
    execution: Any


async def perform_setup(
    *,
    execution_id: str,
    thread_id: str,
    is_resume: bool,
    api_key: str,
    grpc_provider: ChannelProvider,
    execution_client: AgentExecutionClient,
    retry_executor: GrpcRetryExecutor,
    exit_stack: contextlib.AsyncExitStack,
    logger: logging.Logger,
    invoker_identity_account_id: str | None = None,
) -> SetupResult:
    """Execute all setup phases and return resources for streaming.

    Raises on fatal errors — the caller's ``except`` block handles them.
    Partial resources (workspace backend, MCP middleware) are cleaned up
    internally before re-raising so the caller's ``finally`` block only
    needs to handle ``exit_stack`` and ``grpc_provider``.
    """
    workspace_backend: WorkspaceBackend | None = None
    agent_graph: Any = None

    try:
        result, workspace_backend, agent_graph = await _perform_setup_core(
            execution_id=execution_id,
            thread_id=thread_id,
            is_resume=is_resume,
            api_key=api_key,
            grpc_provider=grpc_provider,
            execution_client=execution_client,
            retry_executor=retry_executor,
            exit_stack=exit_stack,
            logger=logger,
            invoker_identity_account_id=invoker_identity_account_id,
        )
        return result
    except Exception:
        # Clean up partial resources that the caller cannot access
        # because SetupResult was never returned.
        if agent_graph is not None:
            mcp_mw = getattr(agent_graph, "_graphton_mcp_middleware", None)
            if mcp_mw is not None:
                with contextlib.suppress(Exception):
                    await mcp_mw._exit_stack.aclose()
        if workspace_backend is not None:
            workspace_backend.close()
        raise


async def _perform_setup_core(
    *,
    execution_id: str,
    thread_id: str,
    is_resume: bool,
    api_key: str,
    grpc_provider: ChannelProvider,
    execution_client: AgentExecutionClient,
    retry_executor: GrpcRetryExecutor,
    exit_stack: contextlib.AsyncExitStack,
    logger: logging.Logger,
    invoker_identity_account_id: str | None = None,
) -> tuple[SetupResult, WorkspaceBackend, Any]:
    setup_timer = SetupTimer(logger)

    # ─────────────────────────────────────────────────────────────────────
    # OBO channel and gRPC clients
    # ─────────────────────────────────────────────────────────────────────
    sys_ch = grpc_provider.channel
    obo_ch = (
        grpc_provider.obo_channel if invoker_identity_account_id else sys_ch
    )

    session_client = SessionClient(api_key, channel=obo_ch)
    agent_instance_client = AgentInstanceClient(api_key, channel=obo_ch)
    agent_client = AgentClient(api_key, channel=obo_ch)
    execution_query_client = AgentExecutionClient(api_key, channel=obo_ch)
    skill_client = SkillClient(api_key, channel=obo_ch)

    # ─────────────────────────────────────────────────────────────────────
    # Step 0: Hydrate AgentExecution from database via gRPC
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("execution_fetch")
    logger.info("Fetching execution %s from database via gRPC", execution_id)
    execution = await execution_query_client.get(execution_id)

    agent_id = execution.spec.agent_id
    user_message = execution.spec.message

    logger.info(
        "Execution parameters: agent_id=%s, session_id='%s' (empty=%s)",
        agent_id, execution.spec.session_id, not execution.spec.session_id,
    )

    heartbeat_during_setup("execution_fetch", {
        "execution_id": execution_id,
        "agent_id": agent_id,
    })

    # ─────────────────────────────────────────────────────────────────────
    # Step 1: Resolve chain — execution → session → agent_instance → agent
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("chain_resolution")
    logger.info("Resolving execution chain for execution: %s", execution_id)

    session_id = execution.spec.session_id
    if not session_id:
        raise ValueError(
            f"Session ID is required for execution {execution_id}. "
            "Execution must have a valid session_id to proceed."
        )

    session = await session_client.get(session_id)
    logger.info(
        "Session %s: agent_instance_id=%s",
        session_id, session.spec.agent_instance_id,
    )
    heartbeat_during_setup("chain_resolution:session", {
        "session_id": session_id,
    })

    agent_instance = await agent_instance_client.get(
        session.spec.agent_instance_id,
    )
    logger.info(
        "AgentInstance %s: agent_id=%s",
        session.spec.agent_instance_id, agent_instance.spec.agent_id,
    )
    heartbeat_during_setup("chain_resolution:agent_instance", {
        "session_id": session_id,
        "agent_instance_id": session.spec.agent_instance_id,
    })

    agent = await agent_client.get(agent_instance.spec.agent_id)
    logger.info(
        "Agent %s: name=%s",
        agent_instance.spec.agent_id, agent.metadata.name,
    )

    instructions = (
        agent.spec.instructions
        if agent.spec.instructions
        else "You are a helpful AI assistant."
    )

    heartbeat_during_setup("chain_resolution:agent", {
        "session_id": session_id,
        "agent_instance_id": session.spec.agent_instance_id,
        "agent_id": agent_instance.spec.agent_id,
    })

    # ─────────────────────────────────────────────────────────────────────
    # Step 2: Worker config & checkpointer
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("config_and_checkpointer")
    from worker.config import Config

    worker_config = Config.load_from_env()

    checkpointer = await exit_stack.enter_async_context(
        create_checkpointer(worker_config.checkpointer)
    )
    logger.info(
        "Created %s checkpointer for HITL approval flow and "
        "conversation persistence",
        worker_config.checkpointer.type,
    )

    model_name = (
        execution.spec.execution_config.model_name
        if execution.spec.execution_config
        and execution.spec.execution_config.model_name
        else worker_config.llm.model_name
    )
    logger.info(
        "Agent config: model=%s (provider=%s), instructions_length=%d",
        model_name, worker_config.llm.provider, len(instructions),
    )

    # ─────────────────────────────────────────────────────────────────────
    # Summarization config (context window management)
    # ─────────────────────────────────────────────────────────────────────
    context_management_config = None
    if (
        execution.spec.HasField("execution_config")
        and execution.spec.execution_config.HasField("context_management")
    ):
        context_management_config = (
            execution.spec.execution_config.context_management
        )
        logger.info(
            "[CONTEXT] Context management config from spec: "
            "disable=%s, custom_trigger=%s, custom_target=%s",
            context_management_config.disable_summarization,
            context_management_config.custom_trigger_threshold,
            context_management_config.custom_target_tokens,
        )

    if (
        context_management_config
        and context_management_config.disable_summarization
    ):
        summarization_config = SummarizationConfig.disabled()
        logger.info(
            "[CONTEXT] Summarization DISABLED via context_management config"
        )
    else:
        trigger_override = (
            context_management_config.custom_trigger_threshold
            if context_management_config
            and context_management_config.custom_trigger_threshold > 0
            else None
        )
        target_override = (
            context_management_config.custom_target_tokens
            if context_management_config
            and context_management_config.custom_target_tokens > 0
            else None
        )

        summarization_config = SummarizationConfig.for_model(
            model_id=model_name,
            enabled=True,
            trigger_threshold_override=trigger_override,
            target_tokens_override=target_override,
        )
        logger.info(
            "[CONTEXT] Summarization enabled: trigger=%s, target=%s, "
            "model=%s%s%s",
            summarization_config.trigger_threshold,
            summarization_config.target_tokens,
            summarization_config.summarization_model,
            f", trigger_override={trigger_override}"
            if trigger_override
            else "",
            f", target_override={target_override}"
            if target_override
            else "",
        )

    # ─────────────────────────────────────────────────────────────────────
    # Recursion limit from ExecutionConfig.max_tool_rounds
    # ─────────────────────────────────────────────────────────────────────
    min_tool_rounds = 10
    max_tool_rounds = 1000
    recursion_limit: int | None = None
    if (
        execution.spec.HasField("execution_config")
        and execution.spec.execution_config.max_tool_rounds > 0
    ):
        requested_rounds = execution.spec.execution_config.max_tool_rounds
        clamped_rounds = max(
            min_tool_rounds, min(max_tool_rounds, requested_rounds)
        )
        if clamped_rounds != requested_rounds:
            logger.warning(
                "max_tool_rounds=%d clamped to %d (valid range: %d-%d)",
                requested_rounds, clamped_rounds,
                min_tool_rounds, max_tool_rounds,
            )
        recursion_limit = clamped_rounds * 6
        logger.info(
            "Recursion limit from execution config: max_tool_rounds=%d "
            "-> recursion_limit=%d",
            clamped_rounds, recursion_limit,
        )

    # ─────────────────────────────────────────────────────────────────────
    # Phase 3B config: tool truncation + cost cap
    # ─────────────────────────────────────────────────────────────────────
    max_tool_result_chars = 0
    max_cost_usd = 0.0
    if execution.spec.HasField("execution_config"):
        max_tool_result_chars = (
            execution.spec.execution_config.max_tool_result_chars
        )
        max_cost_usd = execution.spec.execution_config.max_cost_usd

    if max_tool_result_chars > 0:
        logger.info(
            "Tool result truncation from execution config: max_chars=%d",
            max_tool_result_chars,
        )
    if max_cost_usd > 0.0:
        logger.info(
            "Cost cap from execution config: max_cost_usd=$%.2f",
            max_cost_usd,
        )

    # ─────────────────────────────────────────────────────────────────────
    # Sandbox & workspace initialisation
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("sandbox")
    sandbox_config = worker_config.get_sandbox_config(session_id=session_id)
    logger.info(
        "Sandbox mode: %s - using %s backend",
        worker_config.mode, sandbox_config.get("type"),
    )

    sandbox_manager = None
    if worker_config.mode != "local":
        daytona_api_key = os.environ.get("DAYTONA_API_KEY")
        if not daytona_api_key:
            raise ValueError(
                "DAYTONA_API_KEY environment variable required for "
                "cloud mode"
            )
        sandbox_manager = SandboxManager(daytona_api_key=daytona_api_key)
        if snapshot_id := sandbox_config.get("snapshot_id"):
            logger.info("Using Daytona snapshot: %s", snapshot_id)

    resolved_session_id: str | None = (
        execution.spec.session_id if execution.spec.session_id else None
    )

    heartbeat_during_setup("sandbox_init", {
        "mode": worker_config.mode,
        "sandbox_type": sandbox_config.get("type"),
    })
    await report_setup_progress(
        execution_client, execution_id,
        "Initializing sandbox\u2026", logger,
    )

    workspace_init = await initialize_workspace(
        worker_config=worker_config,
        sandbox_config=sandbox_config,
        sandbox_manager=sandbox_manager,
        session_id=resolved_session_id,
        session_client=session_client,
        activity_logger=logger,
        heartbeat_fn=lambda phase: heartbeat_during_setup(phase),
    )
    workspace_backend = workspace_init.backend
    sandbox = workspace_init.sandbox
    is_new_sandbox = workspace_init.is_new_sandbox

    heartbeat_during_setup("workspace_ready", {
        "is_new_sandbox": is_new_sandbox,
        "sandbox_id": sandbox.id if sandbox else None,
    })

    # ─────────────────────────────────────────────────────────────────────
    # Parallel gRPC fetches: environment, skills, MCP servers
    #
    # After chain resolution, these three groups are independent:
    # - environment resolution (needs execution, agent, agent_instance)
    # - skill fetch (needs skill_refs from agent + session)
    # - MCP server fetch (needs mcp_server_usages from agent + session)
    #
    # Running them concurrently saves ~2 gRPC round-trips of latency.
    # MCP fetch is non-fatal (continues with empty config on error).
    # ─────────────────────────────────────────────────────────────────────
    import asyncio

    setup_timer.start("parallel_fetch")

    skill_refs = merge_skill_refs(
        agent.spec.skill_refs, session.spec.skill_refs,
    )
    mcp_server_usages = merge_mcp_server_usages(
        agent.spec.mcp_server_usages, session.spec.mcp_server_usages,
    )

    env_result, skills, mcp_servers = await asyncio.gather(
        _fetch_environment(
            api_key=api_key,
            obo_ch=obo_ch,
            execution_id=execution_id,
            logger=logger,
        ),
        _fetch_skills(
            skill_refs=skill_refs,
            skill_client=skill_client,
            logger=logger,
        ),
        _fetch_mcp_servers(
            mcp_server_usages=mcp_server_usages,
            api_key=api_key,
            obo_ch=obo_ch,
            logger=logger,
        ),
    )

    merged_env_vars = env_result.merged_env_vars
    secret_keys = env_result.secret_keys

    heartbeat_during_setup("parallel_fetch_done", {
        "env_var_count": len(merged_env_vars),
        "skill_count": len(skills),
        "mcp_server_count": len(mcp_servers),
    })
    await report_setup_progress(
        execution_client, execution_id,
        "Configuring environment\u2026", logger,
    )

    # ─────────────────────────────────────────────────────────────────────
    # Connect backfill: trigger the connect RPC for MCP servers that are
    # either never-discovered or stale (>24h since last discovery).
    # Runs synchronously so status.tool_approvals are populated before
    # the approval chain runs.
    # ─────────────────────────────────────────────────────────────────────
    if mcp_servers:
        mcp_servers = await _backfill_undiscovered_servers(
            mcp_servers=mcp_servers,
            merged_env_vars=merged_env_vars,
            api_key=api_key,
            obo_ch=obo_ch,
            logger=logger,
        )

    # ─────────────────────────────────────────────────────────────────────
    # Workspace provisioning (sequential — needs merged_env_vars)
    # ─────────────────────────────────────────────────────────────────────
    provision_results: list[ProvisionResult] = []

    if session.spec.workspace_entries:
        await report_setup_progress(
            execution_client, execution_id,
            "Setting up workspace\u2026", logger,
        )
        setup_timer.start("workspace_provisioning")
        try:
            provisioner = WorkspaceProvisioner(log=logger)
            provision_results = await _run_sync_with_heartbeat(
                provisioner.provision_all,
                entries=session.spec.workspace_entries,
                backend=workspace_backend,
                merged_env=merged_env_vars,
                is_local_mode=True,
                configure_credentials=not worker_config.is_local_mode(),
                phase_name="workspace_provisioning",
                log=logger,
            )

            if provision_results:
                primary = provision_results[0]
                if (
                    len(provision_results) == 1
                    and primary.root_dir != workspace_backend.root_dir
                ):
                    logger.info(
                        "Workspace root changed by provisioning: %s -> %s",
                        workspace_backend.root_dir, primary.root_dir,
                    )
                    workspace_backend = LocalWorkspaceBackend(
                        root_dir=primary.root_dir,
                        platform_dir=workspace_init.platform_dir,
                    )
                elif len(provision_results) > 1:
                    logger.info(
                        "Multi-entry workspace: keeping backend at "
                        "root %s (%d entries)",
                        workspace_backend.root_dir,
                        len(provision_results),
                    )

                all_consumed: set[str] = set()
                for pr in provision_results:
                    all_consumed.update(pr.consumed_keys)
                if all_consumed:
                    stripped = [
                        k
                        for k in all_consumed
                        if merged_env_vars.pop(k, None) is not None
                    ]
                    if stripped:
                        logger.info(
                            "Stripped %d provisioning key(s) from agent "
                            "environment: %s",
                            len(stripped), ", ".join(sorted(stripped)),
                        )

        except WorkspaceProvisionError as prov_err:
            logger.error("Workspace provisioning failed: %s", prov_err)
            raise ValueError(
                f"Workspace provisioning failed: {prov_err}"
            ) from prov_err

        heartbeat_during_setup("workspace_provisioned", {
            "entry_count": len(provision_results),
            "source_types": [
                pr.source_type.value for pr in provision_results
            ],
            "primary_root_dir": (
                provision_results[0].root_dir if provision_results else None
            ),
        })

    # ─────────────────────────────────────────────────────────────────────
    # Workspace integrity flag (resume fast-path safety net)
    # ─────────────────────────────────────────────────────────────────────
    workspace_files_intact = True

    # ─────────────────────────────────────────────────────────────────────
    # Skills processing (uses pre-fetched skills from parallel block)
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("skills")
    skills_prompt_section = ""
    skill_paths: dict[str, str] = {}

    if skills:
        try:
            # Workspace integrity check (resume only)
            if is_resume:
                sentinel_paths = SkillWriter.compute_skill_paths(skills)
                first_skill_dir = next(iter(sentinel_paths.values()))
                sentinel = f"{first_skill_dir}/SKILL.md"
                workspace_files_intact = workspace_backend.file_exists(
                    sentinel,
                )
                if workspace_files_intact:
                    logger.info(
                        "[RESUME] Workspace integrity verified "
                        "(sentinel=%s) — volume-backed files intact",
                        sentinel,
                    )
                else:
                    logger.warning(
                        "[RESUME] Workspace integrity check FAILED "
                        "(sentinel=%s). Falling back to full "
                        "skill/attachment setup.",
                        sentinel,
                    )

            if is_resume and workspace_files_intact:
                skill_paths = SkillWriter.compute_skill_paths(skills)
                skills_prompt_section = (
                    SkillWriter.generate_prompt_section(skills, skill_paths)
                )
                logger.info(
                    "[RESUME] Skipped skill write — reusing %d skills "
                    "already in sandbox: %s",
                    len(skills), [s.metadata.name for s in skills],
                )
            else:
                if is_resume:
                    logger.warning(
                        "[RESUME-FALLBACK] Re-writing %d skills to "
                        "workspace (integrity check failed)",
                        len(skills),
                    )
                artifacts: dict[str, bytes] = {}
                for skill in skills:
                    if skill.status.artifact_storage_key:
                        logger.info(
                            "Downloading artifact for skill %s (key: %s)",
                            skill.metadata.name,
                            skill.status.artifact_storage_key,
                        )
                        try:
                            artifact_bytes = (
                                await skill_client.get_artifact(
                                    skill.status.artifact_storage_key
                                )
                            )
                            artifacts[skill.metadata.id] = artifact_bytes
                            logger.info(
                                "Downloaded artifact for %s: %d bytes",
                                skill.metadata.name, len(artifact_bytes),
                            )
                        except Exception as e:
                            logger.warning(
                                "Failed to download artifact for %s: %s. "
                                "Falling back to SKILL.md only.",
                                skill.metadata.name, e,
                            )

                logger.info(
                    "Writing %d skills to workspace at %s/.stigmer/skills/",
                    len(skills), workspace_backend.root_dir,
                )
                skill_writer = SkillWriter(backend=workspace_backend)
                skill_paths = skill_writer.write_skills(
                    skills, artifacts=artifacts,
                )

                skills_prompt_section = (
                    SkillWriter.generate_prompt_section(skills, skill_paths)
                )
                logger.info(
                    "Successfully wrote %d skills: %s",
                    len(skills), [s.metadata.name for s in skills],
                )

                if sandbox is not None:
                    logger.info(
                        "[skill-diag] workspace_root = %r",
                        workspace_backend.root_dir,
                    )
                    for _sid, spath in skill_paths.items():
                        diag_result = workspace_backend.execute(
                            f"ls -la {spath}/ 2>&1 | head -20",
                            timeout=5,
                        )
                        logger.info(
                            "[skill-diag] ls %s/  exit=%d  output=%s",
                            spath,
                            diag_result.exit_code,
                            diag_result.stdout[:300],
                        )

                if skill_paths:
                    for _vid, vpath in skill_paths.items():
                        skill_md_path = f"{vpath}/SKILL.md"
                        try:
                            if not workspace_backend.file_exists(
                                skill_md_path,
                            ):
                                raise FileNotFoundError(
                                    f"SKILL.md not found at {skill_md_path}"
                                )
                            content = workspace_backend.read_file(
                                skill_md_path,
                            )
                            logger.info(
                                "Skill post-write verification passed: "
                                "%s (%d bytes)",
                                skill_md_path, len(content),
                            )
                        except Exception as verify_exc:
                            logger.error(
                                "CRITICAL: Skill at %s not readable "
                                "through workspace backend: %s",
                                skill_md_path, verify_exc,
                            )
                            raise RuntimeError(
                                f"Skill verification failed for "
                                f"{skill_md_path}: {verify_exc}"
                            ) from verify_exc

        except RuntimeError as e:
            logger.error("Failed to write skills: %s", e)
            raise ValueError(f"Skill write failed: {e}") from e
        except Exception as e:
            logger.error("Unexpected error preparing skills: %s", e)
            raise

    heartbeat_during_setup("skills_written", {
        "skill_count": len(skills),
        "skill_names": [s.metadata.name for s in skills] if skills else [],
    })
    if skills:
        await report_setup_progress(
            execution_client, execution_id,
            "Loading skills\u2026", logger,
        )

    # ─────────────────────────────────────────────────────────────────────
    # Attachments
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("attachments")
    attachments = (
        list(execution.spec.attachments)
        if execution.spec.attachments
        else []
    )
    injected_files: list[dict] = []

    if attachments:
        if is_resume and workspace_files_intact:
            for att in attachments:
                mount_path = (
                    att.mount_path
                    if att.mount_path
                    else f".stigmer/inputs/{att.filename}"
                )
                injected_files.append({
                    "filename": att.filename,
                    "path": mount_path,
                    "size": None,
                })
            logger.info(
                "[RESUME] Skipped attachment injection — reusing "
                "%d attachments already in sandbox",
                len(injected_files),
            )
        else:
            if is_resume:
                logger.warning(
                    "[RESUME-FALLBACK] Re-injecting %d attachments "
                    "into workspace (integrity check failed)",
                    len(attachments),
                )
            logger.info(
                "Processing %d attachments: %s",
                len(attachments), [a.filename for a in attachments],
            )

            att_artifact_storage = create_artifact_storage(
                worker_config.artifact_storage,
            )
            logger.info(
                "Created artifact storage (%s) for attachment downloads",
                worker_config.artifact_storage.storage_type,
            )

            try:
                injected_files = await inject_attachments(
                    backend=workspace_backend,
                    attachments=attachments,
                    storage=att_artifact_storage,
                    logger=logger,
                    allow_local_path=worker_config.is_local_mode(),
                )
                logger.info(
                    "Successfully injected %d attachments",
                    len(injected_files),
                )
            except Exception as e:
                logger.error("Failed to inject attachments: %s", e)
                raise ValueError(
                    f"Attachment injection failed: {e}"
                ) from e

    heartbeat_during_setup("attachments_injected", {
        "attachment_count": len(attachments),
        "injected_count": len(injected_files),
    })

    # ─────────────────────────────────────────────────────────────────────
    # MCP server transform (uses pre-fetched servers + merged_env_vars)
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("mcp_servers")
    mcp_servers_config: dict[str, Any] = {}
    mcp_tools_config: dict[str, Any] = {}

    if mcp_servers:
        try:
            mcp_config_result = transform_all_mcp_configs(
                mcp_servers=mcp_servers,
                mcp_server_usages=list(mcp_server_usages),
                env_vars=merged_env_vars,
            )
            mcp_servers_config = mcp_config_result.servers
            mcp_tools_config = mcp_config_result.tools

            # Belt-and-suspenders: drop any servers that still have empty
            # tool lists after transform (should not happen after the
            # discovered-tools expansion in config_transformer, but guards
            # against edge cases like a never-discovered server).
            empty_tool_slugs = [
                slug for slug, tools in mcp_tools_config.items()
                if not tools
            ]
            for slug in empty_tool_slugs:
                logger.warning(
                    "Removing MCP server '%s' — empty tool list after "
                    "transform (Graphton requires explicit tool names)",
                    slug,
                )
                mcp_servers_config.pop(slug, None)
                mcp_tools_config.pop(slug, None)

            logger.info(
                "Transformed MCP configs: servers=%s, tools=%d total",
                list(mcp_servers_config.keys()),
                sum(
                    len(t) if t else 0
                    for t in mcp_tools_config.values()
                ),
            )
        except Exception as e:
            logger.error(
                "MCP server transform failed: %s", e,
            )
            logger.warning(
                "Continuing without MCP servers - agent will have "
                "limited capabilities"
            )
            mcp_servers_config = {}
            mcp_tools_config = {}
            mcp_servers = []

    heartbeat_during_setup("mcp_servers_transformed", {
        "mcp_server_count": len(mcp_servers),
        "mcp_servers": (
            list(mcp_servers_config.keys()) if mcp_servers_config else []
        ),
    })
    if mcp_servers:
        await report_setup_progress(
            execution_client, execution_id,
            "Connecting tools\u2026", logger,
        )

    # ─────────────────────────────────────────────────────────────────────
    # Step 5.6: ApprovalConfig & StatusBuilder
    # ─────────────────────────────────────────────────────────────────────
    approval_config = build_approval_config(
        execution=execution,
        mcp_server_usages=(
            list(mcp_server_usages) if mcp_server_usages else []
        ),
        mcp_servers=mcp_servers,
        mcp_tools_config=mcp_tools_config,
    )

    logger.info(
        "Built ApprovalConfig: auto_approve_all=%s, overrides=%d, "
        "pinned=%d servers, status=%d servers, tool_mapping=%d tools",
        approval_config.auto_approve_all,
        len(approval_config.tool_approval_overrides),
        len(approval_config.pinned_tool_approvals),
        len(approval_config.status_tool_approvals),
        len(approval_config.tool_to_mcp_server),
    )

    tool_call_id_capture = ToolCallIdCapture()

    status_builder = StatusBuilder(
        execution_id,
        execution.status,
        approval_config,
        tool_call_id_capture=tool_call_id_capture,
    )
    status_builder.set_display_env_vars(merged_env_vars, secret_keys)
    status_builder.set_workspace_root(workspace_backend.root_dir)

    # WriteBackCoordinator
    from worker.activities.graphton.writeback_coordinator import (
        WriteBackCoordinator,
    )

    writeback_coordinator: WriteBackCoordinator | None = None
    if provision_results and session.spec.workspace_entries:
        writeback_coordinator = WriteBackCoordinator(
            status_builder=status_builder,
            execution_id=execution_id,
            provision_results=provision_results,
            workspace_entries=list(session.spec.workspace_entries),
            sandbox=sandbox,
            workspace_backend=workspace_backend,
            logger=logger,
        )
        if not writeback_coordinator.has_eligible_entries:
            writeback_coordinator = None

    # ─────────────────────────────────────────────────────────────────────
    # Step 5.7: Resolved context & skill relevance
    # ─────────────────────────────────────────────────────────────────────
    mcp_server_status: dict[str, tuple[bool, str, int]] = {}
    requested_mcp_slugs = (
        {usage.mcp_server_ref.slug for usage in mcp_server_usages}
        if mcp_server_usages
        else set()
    )
    resolved_mcp_slugs = set(mcp_servers_config.keys())

    for slug in requested_mcp_slugs:
        if slug in resolved_mcp_slugs:
            tool_count = len(mcp_tools_config.get(slug, []) or [])
            mcp_server_status[slug] = (
                True, "Configured successfully", tool_count,
            )
        else:
            mcp_server_status[slug] = (
                False, "Server not found or resolution failed", 0,
            )

    from worker.activities.graphton.skill_relevance import filter_skills

    all_skill_names = [s.metadata.name for s in skills] if skills else []
    excluded_skill_names: list[str] = []

    if skills and len(skills) >= 8:
        filter_result = filter_skills(
            user_message=user_message,
            skill_names=[s.metadata.name for s in skills],
            skill_descriptions=[
                s.spec.description or "" for s in skills
            ],
        )
        if filter_result.excluded_names:
            included_skills = [
                skills[i] for i in filter_result.included_indices
            ]
            excluded_skill_names = filter_result.excluded_names
            logger.info(
                "Skill relevance filter: %d included, %d excluded %s",
                len(included_skills),
                len(excluded_skill_names),
                excluded_skill_names,
            )
            skills_prompt_section = SkillWriter.generate_prompt_section(
                included_skills, skill_paths,
            )
            skills_prompt_section += (
                SkillWriter.generate_also_available_section(
                    excluded_skill_names,
                )
            )
            all_skill_names = [
                s.metadata.name for s in included_skills
            ]

    status_builder.set_resolved_context(
        environment_keys=list(merged_env_vars.keys()),
        mcp_servers=mcp_server_status,
        skill_names=all_skill_names,
        excluded_skill_names=excluded_skill_names,
    )

    # ─────────────────────────────────────────────────────────────────────
    # Step 5.8: Context management tracking
    # ─────────────────────────────────────────────────────────────────────
    model_metadata = ModelRegistry.get_or_default(model_name)

    status_builder.initialize_context_info(
        context_window_limit=model_metadata.context_window_tokens,
        trigger_threshold=summarization_config.trigger_threshold,
        target_tokens=summarization_config.target_tokens,
        enabled=summarization_config.enabled,
    )

    # ─────────────────────────────────────────────────────────────────────
    # Step 5.9: Cost pricing
    # ─────────────────────────────────────────────────────────────────────
    cost_pricing: dict[str, float] | None = None
    if max_cost_usd > 0.0:
        cost_pricing = {
            "input_price_per_million": (
                model_metadata.input_price_per_million or 0.0
            ),
            "output_price_per_million": (
                model_metadata.output_price_per_million or 0.0
            ),
            "cache_read_price_per_million": (
                model_metadata.cache_read_price_per_million or 0.0
            ),
        }
        logger.info(
            "Cost pricing for cap middleware: input=$%.2f/MTok, "
            "output=$%.2f/MTok, cache_read=$%.2f/MTok",
            cost_pricing["input_price_per_million"],
            cost_pricing["output_price_per_million"],
            cost_pricing["cache_read_price_per_million"],
        )

    # ─────────────────────────────────────────────────────────────────────
    # Step 6: Create Graphton agent
    # ─────────────────────────────────────────────────────────────────────
    setup_timer.start("agent_creation")
    logger.info("Creating Graphton agent for execution %s", execution_id)

    workspace_roots = [
        WorkspaceRoot(name=pr.entry_name, root_dir=pr.root_dir)
        for pr in provision_results
    ]
    workspace_file_refs = (
        list(execution.spec.workspace_file_refs)
        if execution.spec.workspace_file_refs
        else []
    )

    enhanced_system_prompt = enhance_system_prompt(
        instructions=instructions,
        provision_results=provision_results,
        container_root=workspace_backend.root_dir,
        user_message=user_message,
        build_relevance=build_relevance_prompt_section,
        workspace_roots=workspace_roots,
        skills_prompt_section=skills_prompt_section,
        workspace_file_refs=workspace_file_refs,
        workspace_root=workspace_backend.root_dir,
        injected_files=injected_files if injected_files else [],
    )

    if sandbox is not None:
        sandbox_config_for_agent: dict[str, Any] = {
            "type": "daytona",
            "sandbox_id": sandbox.id,
            "workspace_root": workspace_backend.root_dir,
        }
        logger.info(
            "Configuring agent to use existing sandbox %s "
            "(workspace_root=%s)",
            sandbox.id, workspace_backend.root_dir,
        )
    else:
        sandbox_config_for_agent = sandbox_config.copy()
        sandbox_config_for_agent["root_dir"] = workspace_backend.root_dir
        if workspace_init.platform_dir:
            sandbox_config_for_agent["platform_dir"] = (
                workspace_init.platform_dir
            )
        logger.info(
            "Configuring agent for local mode (root=%s, platform_dir=%s)",
            workspace_backend.root_dir, workspace_init.platform_dir,
        )

    if merged_env_vars:
        sandbox_config_for_agent["env_vars"] = dict(merged_env_vars)
        logger.info(
            "Injecting %d env var(s) into sandbox config for "
            "shell execution",
            len(merged_env_vars),
        )

    if len(provision_results) > 1 and sandbox is None:
        local_roots: dict[str, str] = {
            pr.entry_name: pr.root_dir
            for pr in provision_results
            if pr.source_type == SourceType.LOCAL_PATH and pr.entry_name
        }
        if local_roots:
            sandbox_config_for_agent["allowed_roots"] = local_roots
            logger.info(
                "Configured %d allowed root(s) for multi-local-path: %s",
                len(local_roots),
                ", ".join(f"{n}={p}" for n, p in local_roots.items()),
            )

    api_model_id, _ = ModelRegistry.resolve_or_passthrough(
        model_name, provider=worker_config.llm.provider,
    )
    if api_model_id != model_name:
        logger.info(
            "Resolved model '%s' to API model ID '%s'",
            model_name, api_model_id,
        )

    llm_kwargs = worker_config.llm.build_llm_kwargs(
        proxy_endpoint=worker_config.stigmer_proxy_endpoint,
        proxy_auth_token=worker_config.stigmer_api_key,
    )

    approval_checker = create_approval_checker(approval_config)
    logger.info(
        "Created approval checker for HITL flow "
        "(auto_approve_all=%s)",
        approval_config.auto_approve_all,
    )

    # Sub-agents
    transformed_subagents = None
    if agent.spec.sub_agents:
        logger.info(
            "Transforming %d sub-agent(s): %s",
            len(agent.spec.sub_agents),
            [sa.name for sa in agent.spec.sub_agents],
        )
        try:
            transformed_subagents = await transform_sub_agents(
                sub_agents=list(agent.spec.sub_agents),
                parent_mcp_servers=mcp_servers_config or {},
                parent_mcp_tools=mcp_tools_config or {},
                parent_mcp_usages=(
                    list(mcp_server_usages)
                    if mcp_server_usages
                    else []
                ),
                skill_client=skill_client,
                skill_writer_class=SkillWriter,
                skill_writer_kwargs={"backend": workspace_backend},
                sandbox_config=sandbox_config_for_agent,
                approval_checker=approval_checker,
                activity_logger=logger,
                parent_has_native_thinking=(
                    model_metadata.supports_thinking
                    or model_metadata.supports_adaptive_thinking
                ),
            )
            if transformed_subagents:
                logger.info(
                    "Successfully transformed %d sub-agent(s) with "
                    "platform tools, MCP tools, and skills",
                    len(transformed_subagents),
                )
            else:
                logger.warning(
                    "No valid sub-agents after transformation "
                    "(all may have invalid configs)"
                )
        except Exception as e:
            logger.error("Failed to transform sub-agents: %s", e)
            logger.warning(
                "Continuing without sub-agents - agent will not "
                "delegate tasks"
            )
            transformed_subagents = None

    # Built-in subagent types (explore, shell)
    #
    # Always injected when a sandbox is available, regardless of whether
    # proto-defined subagents exist.  These provide specialized,
    # tool-restricted subagent types that prevent scope violations.
    try:
        builtin_subagents = create_builtin_subagents(
            sandbox_config=sandbox_config_for_agent,
            approval_checker=approval_checker,
            activity_logger=logger,
        )
        if builtin_subagents:
            existing_names = (
                {sa["name"] for sa in transformed_subagents}
                if transformed_subagents
                else set()
            )
            added = []
            for builtin in builtin_subagents:
                if builtin["name"] not in existing_names:
                    if transformed_subagents is None:
                        transformed_subagents = []
                    transformed_subagents.append(builtin)
                    added.append(builtin["name"])
                else:
                    logger.info(
                        "Skipping built-in '%s' subagent — name "
                        "already used by proto-defined subagent",
                        builtin["name"],
                    )
            if added:
                logger.info(
                    "Injected %d built-in subagent type(s): %s",
                    len(added), added,
                )
    except Exception as e:
        logger.error("Failed to create built-in subagents: %s", e)

    # Artifact storage & inline publisher
    artifact_storage = create_artifact_storage(
        worker_config.artifact_storage,
    )
    logger.info(
        "Created artifact storage (%s) for inline + post-stream "
        "artifact publish",
        worker_config.artifact_storage.storage_type,
    )

    inline_publisher = InlinePublisher(
        workspace_backend=workspace_backend,
        sandbox=sandbox,
        artifact_storage=artifact_storage,
        status_builder=status_builder,
        execution_id=execution_id,
        logger=logger,
    )

    mcp_client = _maybe_create_daytona_mcp_client(
        sandbox, mcp_servers_config, logger,
    )

    # Build the agent graph
    agent_kwargs: dict[str, Any] = dict(
        model=model_name,
        system_prompt=enhanced_system_prompt,
        mcp_servers=(
            mcp_servers_config if mcp_servers_config else None
        ),
        mcp_tools=(
            mcp_tools_config if mcp_tools_config else None
        ),
        mcp_client=mcp_client,
        tools=None,
        subagents=transformed_subagents,
        sandbox_config=sandbox_config_for_agent,
        checkpointer=checkpointer,
        approval_checker=approval_checker,
        summarization_config=summarization_config,
        summarization_callback=status_builder,
        max_tool_result_chars=max_tool_result_chars,
        tool_truncation_callback=None,
        max_cost_usd=max_cost_usd,
        cost_pricing=cost_pricing,
        **llm_kwargs,
    )
    if recursion_limit is not None:
        agent_kwargs["recursion_limit"] = recursion_limit
    agent_graph = create_deep_agent(**agent_kwargs)

    logger.info(
        "Graphton agent created successfully with %s sandbox",
        "new" if is_new_sandbox else "reused",
    )

    heartbeat_during_setup("agent_created", {
        "model": api_model_id,
        "sandbox_new": is_new_sandbox,
        "has_subagents": (
            transformed_subagents is not None
            and len(transformed_subagents) > 0
        ),
    })

    # ─────────────────────────────────────────────────────────────────────
    # Step 7: Prepare invocation input & config
    # ─────────────────────────────────────────────────────────────────────
    context_section = (
        f"\n\n---\nContext:\n- Organization: {execution.metadata.org}"
    )
    message_with_context = user_message + context_section
    langgraph_input: dict[str, Any] = {
        "messages": [{"role": "user", "content": message_with_context}],
    }

    effective_recursion_limit = (
        recursion_limit
        if recursion_limit is not None
        else _LANGGRAPH_UNLIMITED_RECURSION
    )
    config: dict[str, Any] = {
        "configurable": {
            "thread_id": thread_id,
            "org": execution.metadata.org,
        },
        "recursion_limit": effective_recursion_limit,
        "callbacks": [tool_call_id_capture],
    }

    logger.info(
        "Using thread_id=%s for Graphton execution %s "
        "(recursion_limit=%d%s)",
        thread_id, execution_id,
        effective_recursion_limit,
        " [unlimited]" if recursion_limit is None else "",
    )

    setup_timer.stop()
    setup_timer.log_total()

    result = SetupResult(
        agent_graph=agent_graph,
        config=config,
        status_builder=status_builder,
        execution_client=execution_client,
        retry_executor=retry_executor,
        workspace_backend=workspace_backend,
        sandbox=sandbox,
        artifact_storage=artifact_storage,
        inline_publisher=inline_publisher,
        writeback_coordinator=writeback_coordinator,
        merged_env_vars=merged_env_vars,
        secret_keys=secret_keys,
        effective_recursion_limit=effective_recursion_limit,
        langgraph_input=langgraph_input,
        execution=execution,
    )
    # Return workspace_backend and agent_graph alongside the result so
    # the outer perform_setup can track them for partial-failure cleanup.
    return result, workspace_backend, agent_graph


async def _fetch_environment(
    *,
    api_key: str,
    obo_ch: Any,
    execution_id: str,
    logger: logging.Logger,
) -> Any:
    """Resolve merged environment variables from ExecutionContext.

    Fatal on failure — exceptions propagate to the caller.
    """
    from worker.activities.graphton.environment import resolve_environment

    return await resolve_environment(
        execution_context_client=ExecutionContextClient(
            api_key, channel=obo_ch,
        ),
        execution_id=execution_id,
        logger=logger,
    )


async def _fetch_skills(
    *,
    skill_refs: Any,
    skill_client: SkillClient,
    logger: logging.Logger,
) -> list[Any]:
    """Fetch skill protos via gRPC.

    Fatal on failure — exceptions propagate to the caller.
    Returns an empty list when there are no skill_refs.
    """
    if not skill_refs:
        return []
    logger.info(
        "Fetching %d skills: %s",
        len(skill_refs), [ref.slug for ref in skill_refs],
    )
    return await skill_client.list_by_refs(list(skill_refs))


async def _fetch_mcp_servers(
    *,
    mcp_server_usages: Any,
    api_key: str,
    obo_ch: Any,
    logger: logging.Logger,
) -> list[Any]:
    """Fetch MCP server protos via gRPC.

    Non-fatal: returns an empty list on failure so the agent can
    continue without MCP tools.
    """
    if not mcp_server_usages:
        return []
    logger.info(
        "Fetching %d MCP servers: %s",
        len(mcp_server_usages),
        [usage.mcp_server_ref.slug for usage in mcp_server_usages],
    )
    try:
        mcp_server_client = McpServerClient(api_key, channel=obo_ch)
        mcp_server_refs = [
            usage.mcp_server_ref for usage in mcp_server_usages
        ]
        servers = await mcp_server_client.list_by_refs(mcp_server_refs)
        logger.info(
            "Fetched %d MCP servers: %s",
            len(servers), [s.metadata.name for s in servers],
        )
        return servers
    except Exception as e:
        logger.error("MCP server fetch failed: %s", e)
        logger.warning(
            "Continuing without MCP servers - agent will have "
            "limited capabilities"
        )
        return []


_BACKFILL_STALENESS_THRESHOLD_SECONDS = 24 * 60 * 60  # 24 hours


def _needs_backfill(server: Any) -> bool:
    """Check whether an MCP server needs a connect backfill.

    Returns True in two cases:
    1. Never discovered — ``last_discovered_at`` is unset/zero or the
       ``status``/``discovered_capabilities`` fields are absent.
    2. Stale — ``last_discovered_at`` is older than the staleness
       threshold (24 hours).  This keeps tools and approval policies
       fresh without requiring manual intervention.

    Null-safe: handles missing ``status``, missing
    ``discovered_capabilities``, and missing ``last_discovered_at``
    via the ``AttributeError`` guard.
    """
    import time

    try:
        caps = server.status.discovered_capabilities
        ts = caps.last_discovered_at
        if not ts.seconds and not ts.nanos:
            return True
        return (time.time() - ts.seconds) > _BACKFILL_STALENESS_THRESHOLD_SECONDS
    except AttributeError:
        return True


def _extract_runtime_env_for_server(
    server: Any,
    merged_env_vars: dict[str, str],
) -> dict[str, str] | None:
    """Extract the MCP server's required env vars from the merged env.

    Returns only the keys declared in ``spec.env`` that are present
    in the execution's merged environment.  Returns None if the server
    has no env declarations (no env vars needed).
    """
    try:
        env_decls = server.spec.env
        if not env_decls:
            return None
    except AttributeError:
        return None

    runtime_env: dict[str, str] = {}
    for key in env_decls:
        if key in merged_env_vars:
            runtime_env[key] = merged_env_vars[key]

    return runtime_env or None


async def _backfill_undiscovered_servers(
    *,
    mcp_servers: list[Any],
    merged_env_vars: dict[str, str],
    api_key: str,
    obo_ch: Any,
    logger: logging.Logger,
) -> list[Any]:
    """Run connect backfill for MCP servers that need it.

    Triggers the ``connect`` RPC synchronously for servers that are either
    never-discovered (``last_discovered_at`` is unset) or stale (older
    than :data:`_BACKFILL_STALENESS_THRESHOLD_SECONDS`).  The RPC starts
    a Temporal workflow (discover + classify) and returns the updated
    server with populated ``status.discovered_capabilities`` and
    ``status.tool_approvals``.

    The returned list replaces any backfilled servers with the fresh
    versions from the connect response.

    Non-fatal: if connect fails for a server, the original (stale) server
    is kept and execution continues without current approval policies for
    that server's tools.
    """
    servers_needing_backfill = [
        (i, s) for i, s in enumerate(mcp_servers) if _needs_backfill(s)
    ]

    if not servers_needing_backfill:
        return mcp_servers

    logger.info(
        "Connect backfill needed for %d MCP server(s): %s",
        len(servers_needing_backfill),
        [s.metadata.name for _, s in servers_needing_backfill],
    )

    mcp_client = McpServerClient(api_key, channel=obo_ch)
    result = list(mcp_servers)

    for idx, server in servers_needing_backfill:
        slug = server.metadata.slug or server.metadata.name
        try:
            runtime_env = _extract_runtime_env_for_server(
                server, merged_env_vars,
            )
            updated = await mcp_client.connect(
                mcp_server_id=server.metadata.id,
                runtime_env=runtime_env,
                timeout=60.0,
            )
            result[idx] = updated

            tool_count = len(updated.status.discovered_capabilities.tools)
            approval_count = len(updated.status.tool_approvals)
            logger.info(
                "Connect backfill for MCP server '%s' — "
                "discovered %d tools, classified %d approval policies",
                slug, tool_count, approval_count,
            )
        except Exception as e:
            logger.warning(
                "Connect backfill failed for MCP server '%s': %s. "
                "Continuing without current approval policies for this server.",
                slug, e,
            )

    return result


def _maybe_create_daytona_mcp_client(
    sandbox: Any | None,
    mcp_servers_config: dict[str, dict[str, Any]],
    logger: logging.Logger,
) -> Any | None:
    """Create a DaytonaMCPClient when sandbox and stdio servers are present.

    In cloud mode (``sandbox is not None``), stdio MCP servers run inside
    the Daytona sandbox instead of as local subprocesses.  This function
    encapsulates the three-way gating decision:

    1. No sandbox (local/OSS mode) → ``None`` (use default subprocess transport)
    2. Sandbox present but all servers are HTTP → ``None`` (no stdio to route)
    3. Sandbox present and at least one stdio server → ``DaytonaMCPClient``

    Returns:
        A ``DaytonaMCPClient`` instance, or ``None`` when sandbox routing
        is not applicable.
    """
    if sandbox is None or not mcp_servers_config:
        return None

    has_stdio = any(
        v.get("transport") == "stdio"
        for v in mcp_servers_config.values()
    )
    if not has_stdio:
        return None

    from worker.mcp.daytona_mcp_client import DaytonaMCPClient

    client = DaytonaMCPClient(servers=mcp_servers_config, sandbox=sandbox)

    stdio_count = sum(
        1 for v in mcp_servers_config.values()
        if v.get("transport") == "stdio"
    )
    logger.info(
        "Created DaytonaMCPClient for %d sandboxed stdio server(s)",
        stdio_count,
    )

    return client
