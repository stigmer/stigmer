"""Temporal activity for executing Graphton agents."""

import asyncio
import contextlib
import logging
import os
import time
import traceback
from typing import Any, cast

from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.approval_pb2 import PendingApproval
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import (
    ApprovalAction,
    ExecutionPhase,
    MessageType,
    SubAgentStatus,
    ToolCallStatus,
)
from ai.stigmer.agentic.agentexecution.v1.io_pb2 import (
    ApprovalDecisionList,
    SubmitApprovalInput,
)
from ai.stigmer.agentic.agentexecution.v1.message_pb2 import AgentMessage
from graphton import SummarizationConfig, create_deep_agent
from graphton.core import ModelRegistry
from graphton.core.backends.platform_mount import (
    humanize_platform_refs,
    resolve_display_env_vars,
)
from langchain_core.runnables import RunnableConfig
from temporalio import activity

from grpc_client.agent_client import AgentClient
from grpc_client.agent_execution_client import AgentExecutionClient
from grpc_client.agent_instance_client import AgentInstanceClient
from grpc_client.channel import ChannelProvider
from grpc_client.environment_client import EnvironmentClient
from grpc_client.execution_context_client import (
    ExecutionContextClient,
)
from grpc_client.mcp_server_client import McpServerClient
from grpc_client.session_client import SessionClient
from grpc_client.skill_client import SkillClient
from worker.activities.graphton.approval_policy import (
    build_approval_config,
    create_approval_checker,
    resolve_platform_tool_name,
)
from worker.activities.graphton.attachments import (
    _MAX_ZIP_EXTRACTED_SIZE,
    _MAX_ZIP_FILES,
    _validate_zip_for_extraction,
    auto_publish_written_files as _auto_publish_written_files,
    inject_attachments,
)
from worker.activities.graphton.hitl import (
    ApprovalStateManager,
    CheckpointFallback,
    ResumeReconciler,
)
from worker.activities.graphton.temporal_helpers import (
    SetupTimer,
    heartbeat_during_setup,
    run_sync_with_heartbeat as _run_sync_with_heartbeat,
    slim_status_for_temporal as _slim_status_for_temporal,
)
from worker.activities.graphton.session_context_merge import (
    merge_mcp_server_usages,
    merge_skill_refs,
)
from worker.activities.graphton.skill_writer import SkillWriter
from worker.activities.graphton.status_builder import StatusBuilder, _utc_timestamp
from worker.activities.graphton.subagent_transformer import transform_sub_agents
from worker.activities.graphton.prompt_builder import (
    build_referenced_files_prompt_section,
    build_workspace_prompt_section,
    enhance_system_prompt,
    _format_entry_description,
)
from worker.activities.relevance import (
    WorkspaceRoot,
    build_relevance_prompt_section,
)
from worker.checkpointer import create_checkpointer
from worker.mcp import transform_all_mcp_configs
from worker.resilience import (
    GrpcNonRetryableError,
    GrpcRetryExecutor,
    GrpcRetryExhaustedError,
    RetryConfig,
)
from worker.sandbox_manager import SandboxManager
from worker.storage import ArtifactStorage, create_artifact_storage
from worker.streaming import StreamingConfig, StreamingUpdateScheduler
from worker.token_manager import get_api_key

from worker.tools import publish_artifact as _publish_artifact_to_storage
from worker.workspace import (
    LocalWorkspaceBackend,
    ProvisionResult,
    SourceType,
    WorkspaceBackend,
    WorkspaceProvisioner,
    WorkspaceProvisionError,
    initialize_workspace,
)

# _TREE_MAX_ENTRIES, _build_directory_tree, _human_size moved to
# worker.activities.graphton.prompt_builder



# _slim_status_for_temporal, SetupTimer, heartbeat_during_setup, and
# _run_sync_with_heartbeat are imported from
# worker.activities.graphton.temporal_helpers and re-exported at module
# level for backward compatibility.



# Attachment handling functions (_validate_zip_for_extraction, inject_attachments,
# _auto_publish_written_files) are imported from worker.activities.graphton.attachments
# and re-exported at module level for backward compatibility with existing test imports.


# Prompt construction functions (build_workspace_prompt_section, etc.) are
# imported from worker.activities.graphton.prompt_builder and re-exported
# at module level for backward compatibility with existing test imports.


@activity.defn(name="ExecuteGraphton")
async def execute_graphton(
    execution_id: str,
    thread_id: str,
    approval_decisions_wrapper: ApprovalDecisionList | None = None,
    invoker_identity_account_id: str | None = None,
) -> AgentExecutionStatus:
    """
    Execute Graphton agent and return final status.
    
    Slim-Payload Pattern:
    The activity receives only an execution_id (not the full AgentExecution proto)
    and hydrates the execution from the database via gRPC.  This keeps Temporal
    activity payloads small and bounded, avoiding the ~2 MB payload limit that
    can be hit when status.tool_calls / status.messages accumulate.
    
    Polyglot Workflow Pattern:
    1. Fetches AgentExecution via gRPC get(execution_id)
    2. Fetches Agent configuration via gRPC chain resolution
    3. Creates Graphton agent at runtime
    4. Creates/reuses Daytona sandbox
    5. Executes agent and builds status locally
    6. Returns final status to workflow
    
    Args:
        execution_id: The AgentExecution ID to fetch and execute
        thread_id: LangGraph thread ID for state persistence
        approval_decisions_wrapper: Approval decisions wrapped in ApprovalDecisionList
            for polyglot Temporal serialization (None on first invocation).
            Each entry carries a tool_call_id, action (APPROVE/SKIP/REJECT), and
            optional comment.  The activity correlates these with pending_approvals
            from the fetched execution to build the LangGraph Command(resume=...) dict.
        invoker_identity_account_id: Identity account ID of the user who triggered
            the execution. Used by the runner for on-behalf-of gRPC impersonation
            (x-on-behalf-of header). None for backward compatibility.
        
    Returns:
        AgentExecutionStatus: Final status with messages, tool_calls, phase
    """
    activity_logger = activity.logger
    activity_logger.info(f"ExecuteGraphton started for execution: {execution_id}")
    
    # Unwrap ApprovalDecisionList → list[SubmitApprovalInput].
    # The wrapper exists purely for polyglot Temporal serialization (a bare
    # list is not a proto.Message, so the Go/Java SDKs would fall back to
    # json/plain encoding that Python cannot decode).
    if approval_decisions_wrapper is not None and approval_decisions_wrapper.decisions:
        approval_decisions: list[SubmitApprovalInput] = list(
            approval_decisions_wrapper.decisions
        )
    else:
        approval_decisions = []
    
    # Top-level error handler for system errors (e.g., activity not registered, connection failures)
    # This catches errors that occur before the main try block or during initialization
    try:
        return await _execute_graphton_impl(
            execution_id, thread_id, approval_decisions, activity_logger,
            invoker_identity_account_id,
        )
    except Exception as system_error:
        exc_type = type(system_error).__name__
        exc_tb = traceback.format_exc()
        activity_logger.error(
            f"❌ SYSTEM ERROR in ExecuteGraphton for {execution_id}: "
            f"[{exc_type}] {system_error}\n{exc_tb}"
        )
        
        # Create minimal failed status for system errors
        # This handles cases where status_builder was never initialized


        
        failed_status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_FAILED,
            error=f"System error: [{exc_type}] {str(system_error)}",
            messages=[
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content="Internal system error occurred. Please contact support if this issue persists.",
                    timestamp=_utc_timestamp(),
                ),
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content=f"Error details: [{exc_type}] {str(system_error)}",
                    timestamp=_utc_timestamp(),
                )
            ]
        )
        
        # Try to update status in database (best effort)
        try:
            api_key = get_api_key()
            if api_key:
                execution_client = AgentExecutionClient(api_key)
                await execution_client.update_status(execution_id, failed_status)
                activity_logger.info(f"✅ Updated execution {execution_id} to FAILED status")
        except Exception as update_error:
            activity_logger.error(f"Failed to update status after system error: {update_error}")
        
        # Return slim status to workflow (full status already persisted via gRPC above)
        return _slim_status_for_temporal(failed_status)


async def _execute_graphton_impl(
    execution_id: str,
    thread_id: str,
    approval_decisions: list[SubmitApprovalInput],
    activity_logger,
    invoker_identity_account_id: str | None = None,
) -> AgentExecutionStatus:
    """
    Internal implementation of execute_graphton with existing error handling.
    This function contains the original implementation wrapped in the main try-except.
    
    Durable Execution Support:
    - On retry (attempt > 1), extracts thread_id from last heartbeat for checkpoint resume
    - LangGraph automatically loads checkpoint state when invoked with existing thread_id
    - This enables crash recovery without re-running from the beginning
    """
    # ─────────────────────────────────────────────────────────────────────────────
    # Crash Recovery: Detect retry and resume from checkpoint
    #
    # When Temporal retries this activity after a crash:
    # 1. heartbeat_details contains the last heartbeat from the previous attempt
    # 2. We extract thread_id to resume from the LangGraph checkpoint
    # 3. LangGraph automatically loads state when invoked with the same thread_id
    # ─────────────────────────────────────────────────────────────────────────────
    attempt = activity.info().attempt
    heartbeat_details = activity.info().heartbeat_details
    is_retry = attempt > 1 and heartbeat_details is not None
    
    if is_retry:
        # Extract thread_id from last heartbeat for checkpoint resume
        try:
            # heartbeat_details can be a tuple/list of the heartbeat payload(s)
            last_heartbeat = heartbeat_details[0] if isinstance(heartbeat_details, (list, tuple)) else heartbeat_details
            
            if isinstance(last_heartbeat, dict) and "thread_id" in last_heartbeat:
                resume_thread_id = last_heartbeat["thread_id"]
                activity_logger.info(
                    f"🔄 RETRY DETECTED: attempt={attempt}, "
                    f"resuming from checkpoint with thread_id={resume_thread_id} "
                    f"(original thread_id={thread_id})"
                )
                # Override thread_id with the one from heartbeat for checkpoint resume
                thread_id = resume_thread_id
            else:
                activity_logger.warning(
                    f"⚠️ RETRY DETECTED: attempt={attempt}, but heartbeat missing thread_id. "
                    f"Heartbeat data: {last_heartbeat}. Using provided thread_id={thread_id}"
                )
        except Exception as e:
            activity_logger.warning(
                f"⚠️ RETRY DETECTED: attempt={attempt}, failed to extract thread_id from heartbeat: {e}. "
                f"Using provided thread_id={thread_id}"
            )
    else:
        activity_logger.info(
            f"First attempt (attempt={attempt}): using thread_id={thread_id}"
        )
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Resume-Aware Logging
    #
    # When re-invoked after approval, emit a prominent log banner so operators
    # can immediately distinguish fresh executions from resume paths in logs.
    # ─────────────────────────────────────────────────────────────────────────────
    is_resume = bool(approval_decisions)
    if is_resume:
        activity_logger.info("=" * 80)
        activity_logger.info(
            f"🔄 [RESUME] ExecuteGraphton re-invoked after approval for "
            f"execution={execution_id}, thread_id={thread_id}, "
            f"decisions={len(approval_decisions)}, attempt={attempt}"
        )
        activity_logger.info("=" * 80)
    
    # Initialize setup timer for phase-aware duration tracking.
    # On the resume path this is especially valuable because the full setup
    # re-execution is the most common source of unexplained latency.
    setup_timer = SetupTimer(activity_logger)
    
    # Get API key (for gRPC calls to Stigmer backend)
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("API key not initialized")
    
    # Shared gRPC channels for all clients in this activity invocation.
    # Two channels are maintained:
    #   sys_ch  – machine-account only, for operator-level calls (updateStatus)
    #   obo_ch  – adds x-on-behalf-of header, for user-scoped reads and writes
    # When invoker_identity_account_id is absent (backward compat), both point
    # to the same system channel.
    grpc_provider = ChannelProvider(
        api_key,
        invoker_identity_account_id=invoker_identity_account_id,
    )
    sys_ch = grpc_provider.channel
    obo_ch = grpc_provider.obo_channel if invoker_identity_account_id else sys_ch

    session_client = SessionClient(api_key, channel=obo_ch)
    agent_instance_client = AgentInstanceClient(api_key, channel=obo_ch)
    agent_client = AgentClient(api_key, channel=obo_ch)
    execution_query_client = AgentExecutionClient(api_key, channel=obo_ch)
    execution_client = AgentExecutionClient(api_key, channel=sys_ch)
    
    # ─────────────────────────────────────────────────────────────────────────────
    # Step 0: Hydrate AgentExecution from database via gRPC
    #
    # Instead of receiving the full AgentExecution proto through Temporal (which
    # can exceed the ~2 MB payload limit as status.tool_calls/messages grow),
    # we fetch it from the database.  The DB always has the latest persisted
    # state because the activity sends progressive gRPC status updates during
    # execution.
    # ─────────────────────────────────────────────────────────────────────────────
    setup_timer.start("execution_fetch")
    activity_logger.info(f"Fetching execution {execution_id} from database via gRPC")
    execution = await execution_query_client.get(execution_id)
    
    agent_id = execution.spec.agent_id
    user_message = execution.spec.message
    
    activity_logger.info(
        f"Execution parameters: agent_id={agent_id}, "
        f"session_id='{execution.spec.session_id}' (empty={not execution.spec.session_id})"
    )
    
    heartbeat_during_setup("execution_fetch", {
        "execution_id": execution_id,
        "agent_id": agent_id,
    })
    
    # Initialize retry executor for reliable final status updates
    # Uses exponential backoff (1s, 2s, 4s) with max 3 attempts
    retry_executor = GrpcRetryExecutor(RetryConfig.load_from_env())
    
    # NOTE: StatusBuilder is initialized later after MCP servers are fetched
    # so that ApprovalConfig can be built with complete policy data.
    # See Step 5.6 below.
    # Initialize to None here so error handler can check if it was created.
    status_builder = None

    # Workspace backend is initialized inside the try block but referenced
    # in the finally block for cleanup (close() deletes the Daytona process
    # session used for sandbox command execution).
    workspace_backend = None
    
    # AsyncExitStack manages the checkpointer lifecycle (SQLite connection,
    # MongoDB client, etc.) across the entire activity execution. Created
    # outside the try block so the finally clause can always clean it up.
    exit_stack = contextlib.AsyncExitStack()
    
    try:
        # Step 1: Resolve the full chain: execution → session → agent_instance → agent
        setup_timer.start("chain_resolution")
        activity_logger.info(f"Resolving execution chain for execution: {execution_id}")
        
        # 1a. Get session from execution
        session_id = execution.spec.session_id
        if not session_id:
            raise ValueError(
                f"Session ID is required for execution {execution_id}. "
                "Execution must have a valid session_id to proceed."
            )
        
        session = await session_client.get(session_id)
        activity_logger.info(
            f"Session {session_id}: agent_instance_id={session.spec.agent_instance_id}"
        )
        heartbeat_during_setup("chain_resolution:session", {
            "session_id": session_id,
        })
        
        # 1b. Get agent instance from session
        agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)
        activity_logger.info(
            f"AgentInstance {session.spec.agent_instance_id}: agent_id={agent_instance.spec.agent_id}"
        )
        heartbeat_during_setup("chain_resolution:agent_instance", {
            "session_id": session_id,
            "agent_instance_id": session.spec.agent_instance_id,
        })
        
        # 1c. Get agent template
        agent = await agent_client.get(agent_instance.spec.agent_id)
        activity_logger.info(
            f"Agent {agent_instance.spec.agent_id}: name={agent.metadata.name}"
        )
        
        # Extract agent instructions
        instructions = agent.spec.instructions if agent.spec.instructions else "You are a helpful AI assistant."
        
        heartbeat_during_setup("chain_resolution:agent", {
            "session_id": session_id,
            "agent_instance_id": session.spec.agent_instance_id,
            "agent_id": agent_instance.spec.agent_id,
        })
        
        # Step 2: Get worker configuration (for sandbox and LLM config)
        setup_timer.start("config_and_checkpointer")
        from worker.config import Config
        worker_config = Config.load_from_env()
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 2.5: Create checkpointer for HITL and conversation persistence
        #
        # The checkpointer enables two critical capabilities:
        # 1. HITL (Human-in-the-Loop) approval flow - interrupt/resume execution
        # 2. Conversational context preservation - multi-turn conversations
        #
        # Checkpointer selection is mode-aware:
        # - local mode: MemorySaver (ephemeral) or SqliteSaver (persistent)
        # - cloud mode: AsyncMongoDBSaver (persistent, multi-instance safe)
        #
        # create_checkpointer is an async context manager. We enter it via the
        # exit_stack so the underlying resources (SQLite connection, MongoDB client)
        # stay alive for the entire activity and are cleaned up in the finally block.
        # ─────────────────────────────────────────────────────────────────────────────
        checkpointer = await exit_stack.enter_async_context(
            create_checkpointer(worker_config.checkpointer)
        )
        activity_logger.info(
            f"Created {worker_config.checkpointer.type} checkpointer "
            f"for HITL approval flow and conversation persistence"
        )
        
        # Model name from execution config or worker config (mode-aware default)
        # Priority: execution config > worker LLM config (env vars + mode-aware defaults)
        model_name = (
            execution.spec.execution_config.model_name 
            if execution.spec.execution_config and execution.spec.execution_config.model_name
            else worker_config.llm.model_name
        )
        
        activity_logger.info(
            f"Agent config: model={model_name} (provider={worker_config.llm.provider}), "
            f"instructions_length={len(instructions)}"
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Create summarization config for automatic context window management (Phase 3)
        #
        # Uses Model Registry to determine model-appropriate thresholds.
        # Supports overrides from ExecutionConfig.context_management:
        # - disable_summarization: Opt out of automatic summarization
        # - custom_trigger_threshold: Override when summarization triggers
        # - custom_target_tokens: Override the target size after summarization
        # ─────────────────────────────────────────────────────────────────────────────
        
        # Parse context management config from execution_config (if present)
        context_management_config = None
        if execution.spec.HasField("execution_config") and execution.spec.execution_config.HasField("context_management"):
            context_management_config = execution.spec.execution_config.context_management
            activity_logger.info(
                f"[CONTEXT] Context management config from spec: "
                f"disable={context_management_config.disable_summarization}, "
                f"custom_trigger={context_management_config.custom_trigger_threshold}, "
                f"custom_target={context_management_config.custom_target_tokens}"
            )
        
        # Build summarization config with optional overrides
        if context_management_config and context_management_config.disable_summarization:
            summarization_config = SummarizationConfig.disabled()
            activity_logger.info("[CONTEXT] Summarization DISABLED via context_management config")
        else:
            # Apply custom thresholds if specified (0 means use model default)
            trigger_override = (
                context_management_config.custom_trigger_threshold
                if context_management_config and context_management_config.custom_trigger_threshold > 0
                else None
            )
            target_override = (
                context_management_config.custom_target_tokens
                if context_management_config and context_management_config.custom_target_tokens > 0
                else None
            )
            
            summarization_config = SummarizationConfig.for_model(
                model_id=model_name,
                enabled=True,
                trigger_threshold_override=trigger_override,
                target_tokens_override=target_override,
            )
            activity_logger.info(
                f"[CONTEXT] Summarization enabled: trigger={summarization_config.trigger_threshold}, "
                f"target={summarization_config.target_tokens}, "
                f"model={summarization_config.summarization_model}"
                + (f", trigger_override={trigger_override}" if trigger_override else "")
                + (f", target_override={target_override}" if target_override else "")
            )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Compute recursion_limit from ExecutionConfig.max_tool_rounds (if set).
        #
        # max_tool_rounds is the user-facing unit (model→tools cycles).
        # LangGraph's recursion_limit counts super-steps (~6 per round due to
        # middleware graph nodes: before_model, model, 3× after_model, tools).
        # 0 = use platform default (None = unlimited; loop detection is safety).
        # Non-zero values are clamped to 10–1000 rounds (60–6000 super-steps).
        # ─────────────────────────────────────────────────────────────────────────────
        min_tool_rounds = 10
        max_tool_rounds = 1000
        recursion_limit = None  # None = unlimited (loop detection is primary safety)
        if (execution.spec.HasField("execution_config")
                and execution.spec.execution_config.max_tool_rounds > 0):
            requested_rounds = execution.spec.execution_config.max_tool_rounds
            clamped_rounds = max(min_tool_rounds, min(max_tool_rounds, requested_rounds))
            if clamped_rounds != requested_rounds:
                activity_logger.warning(
                    "max_tool_rounds=%d clamped to %d (valid range: %d-%d)",
                    requested_rounds, clamped_rounds,
                    min_tool_rounds, max_tool_rounds,
                )
            recursion_limit = clamped_rounds * 6
            activity_logger.info(
                "Recursion limit from execution config: max_tool_rounds=%d "
                "-> recursion_limit=%d",
                clamped_rounds, recursion_limit,
            )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Extract Phase 3B config: tool truncation + cost cap (from ExecutionConfig).
        #
        # max_tool_result_chars: 0 = platform default (30K). Always active.
        # max_cost_usd: 0.0 = no cap.  When > 0, requires pricing from ModelRegistry.
        # ─────────────────────────────────────────────────────────────────────────────
        max_tool_result_chars = 0
        max_cost_usd = 0.0
        if execution.spec.HasField("execution_config"):
            max_tool_result_chars = execution.spec.execution_config.max_tool_result_chars
            max_cost_usd = execution.spec.execution_config.max_cost_usd

        if max_tool_result_chars > 0:
            activity_logger.info(
                "Tool result truncation from execution config: max_chars=%d",
                max_tool_result_chars,
            )
        if max_cost_usd > 0.0:
            activity_logger.info(
                "Cost cap from execution config: max_cost_usd=$%.2f",
                max_cost_usd,
            )

        # Get sandbox configuration from worker config
        setup_timer.start("sandbox")
        sandbox_config = worker_config.get_sandbox_config(session_id=session_id)
        
        activity_logger.info(
            f"Sandbox mode: {worker_config.mode} - using {sandbox_config.get('type')} backend"
        )
        
        # Initialize sandbox manager (cloud mode only).
        sandbox_manager = None
        if worker_config.mode != "local":
            daytona_api_key = os.environ.get("DAYTONA_API_KEY")
            if not daytona_api_key:
                raise ValueError("DAYTONA_API_KEY environment variable required for cloud mode")
            sandbox_manager = SandboxManager(
                daytona_api_key=daytona_api_key,
            )
            if snapshot_id := sandbox_config.get("snapshot_id"):
                activity_logger.info(f"Using Daytona snapshot: {snapshot_id}")

        resolved_session_id: str | None = execution.spec.session_id if execution.spec.session_id else None

        heartbeat_during_setup("sandbox_init", {
            "mode": worker_config.mode,
            "sandbox_type": sandbox_config.get("type"),
        })

        # Create the workspace backend — single point where local-vs-cloud
        # decision is made.  All subsequent code uses workspace_backend for
        # file operations and never branches on deployment mode.
        workspace_init = await initialize_workspace(
            worker_config=worker_config,
            sandbox_config=sandbox_config,
            sandbox_manager=sandbox_manager,
            session_id=resolved_session_id,
            session_client=session_client,
            activity_logger=activity_logger,
            heartbeat_fn=lambda phase: heartbeat_during_setup(phase),
        )
        workspace_backend = workspace_init.backend
        sandbox = workspace_init.sandbox
        is_new_sandbox = workspace_init.is_new_sandbox

        heartbeat_during_setup("workspace_ready", {
            "is_new_sandbox": is_new_sandbox,
            "sandbox_id": sandbox.id if sandbox else None,
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 2.8: Merge environment variables (moved up from Step 4)
        #
        # Environment merge now happens before workspace provisioning because
        # the provisioner needs credentials from the merged env (e.g.
        # GITHUB_TOKEN for git clone).  Nothing between the old Step 4
        # location and here depends on merged_env_vars, so the reorder is safe.
        # ─────────────────────────────────────────────────────────────────────────────
        setup_timer.start("environment")
        from worker.activities.graphton.environment import resolve_environment
        env_result = await resolve_environment(
            execution_context_client=ExecutionContextClient(api_key, channel=obo_ch),
            execution_id=execution_id,
            agent=agent,
            agent_instance=agent_instance,
            execution=execution,
            environment_client_factory=EnvironmentClient,
            api_key=api_key,
            obo_channel=obo_ch,
            logger=activity_logger,
        )
        merged_env_vars = env_result.merged_env_vars
        secret_keys = env_result.secret_keys
        
        heartbeat_during_setup("environment_merged", {
            "env_var_count": len(merged_env_vars),
            "used_legacy_merge": env_result.used_legacy_merge,
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 2.9: Workspace provisioning
        #
        # When the session has workspace_entries, the provisioner iterates
        # each entry and provisions it (git clone, local-path validation,
        # or empty).  The provisioner is idempotent: previously provisioned
        # workspaces are detected and reused without re-cloning.
        #
        # Credential stripping (AD-05): keys consumed by provisioning
        # (e.g. GITHUB_TOKEN) are removed from merged_env_vars so they
        # do not leak into MCP config placeholders or status reporting.
        #
        # Provisioning runs in a background thread via
        # _run_sync_with_heartbeat so that Temporal heartbeats continue
        # flowing while long-running synchronous operations (git clone
        # through the Daytona HTTP API) block.  Without this, a clone
        # exceeding the 2-minute heartbeat timeout would cause Temporal
        # to kill the activity even though the clone is still in progress.
        # ─────────────────────────────────────────────────────────────────────────────
        provision_results: list[ProvisionResult] = []
        
        if session.spec.workspace_entries:
            setup_timer.start("workspace_provisioning")
            try:
                provisioner = WorkspaceProvisioner(log=activity_logger)
                # Always use local-mode git provisioning: the workspace
                # lives on the sandbox's local overlay filesystem (even in
                # cloud mode), so --separate-git-dir and FUSE compat hacks
                # are unnecessary.
                provision_results = await _run_sync_with_heartbeat(
                    provisioner.provision_all,
                    entries=session.spec.workspace_entries,
                    backend=workspace_backend,
                    merged_env=merged_env_vars,
                    is_local_mode=True,
                    phase_name="workspace_provisioning",
                    log=activity_logger,
                )
                
                if provision_results:
                    primary = provision_results[0]
                    if (
                        len(provision_results) == 1
                        and primary.root_dir != workspace_backend.root_dir
                    ):
                        # Single entry: replace backend so the agent's
                        # CWD is the provisioned root (backward compat).
                        activity_logger.info(
                            "Workspace root changed by provisioning: %s -> %s",
                            workspace_backend.root_dir,
                            primary.root_dir,
                        )
                        workspace_backend = LocalWorkspaceBackend(
                            root_dir=primary.root_dir,
                            platform_dir=workspace_init.platform_dir,
                        )
                    elif len(provision_results) > 1:
                        # Multi-entry: keep backend at workspace root so
                        # all entry subdirectories remain reachable.  The
                        # system prompt tells the agent which entry is
                        # primary and how to navigate between them.
                        activity_logger.info(
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
                            k for k in all_consumed
                            if merged_env_vars.pop(k, None) is not None
                        ]
                        if stripped:
                            activity_logger.info(
                                "Stripped %d provisioning key(s) from agent environment: %s",
                                len(stripped),
                                ", ".join(sorted(stripped)),
                            )
                
            except WorkspaceProvisionError as prov_err:
                activity_logger.error(
                    "Workspace provisioning failed: %s", prov_err,
                )
                raise ValueError(
                    f"Workspace provisioning failed: {prov_err}"
                ) from prov_err
            
            heartbeat_during_setup("workspace_provisioned", {
                "entry_count": len(provision_results),
                "source_types": [pr.source_type.value for pr in provision_results],
                "primary_root_dir": provision_results[0].root_dir if provision_results else None,
            })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Workspace integrity flag (resume fast-path safety net)
        #
        # When resuming after approval, the fast-path skips skill/attachment
        # writes on the assumption that files persist from the prior execution
        # (backed by the Daytona Volume or local session directory).  Before
        # entering the fast-path, we verify a single sentinel file exists.
        # If the check fails (e.g. volume mount failure, data loss), we set
        # this flag to False and fall back to a full setup — gracefully
        # degrading rather than leaving the agent in an empty workspace.
        #
        # Initialised here so both Step 3 (skills) and Step 3.5 (attachments)
        # can read it.
        # ─────────────────────────────────────────────────────────────────────────────
        workspace_files_intact = True

        # Step 3: Fetch and write skills (from agent template via references)
        # Following the Agent Skills spec progressive disclosure model:
        # - Skills are written to .stigmer/skills/{name}/ in the sandbox
        # - Only metadata (name + description + location) injected into prompt
        # - Agent reads SKILL.md on demand when activating a skill
        #
        # RESUME FAST PATH: On the resume-after-approval path, skills have
        # already been written to the sandbox by the previous activity
        # invocation.  We still fetch the Skill protos (lightweight gRPC)
        # to generate the system-prompt section, but skip the expensive
        # artifact download, sandbox write, diagnostic listing, and
        # post-write verification steps.  A sentinel check (Step 2.75 above)
        # gates the fast-path — if the check fails, we fall through to the
        # full setup instead.
        setup_timer.start("skills")
        skills_prompt_section = ""
        skills = []  # List of Skill protos (populated if skill_refs exist)
        skill_refs = merge_skill_refs(agent.spec.skill_refs, session.spec.skill_refs)
        
        # Create skill client (needed for both parent skills and subagent skills)
        skill_client = SkillClient(api_key, channel=obo_ch)
        
        if skill_refs:
            
            try:
                # Fetch skills via gRPC using ApiResourceReference (supports version resolution)
                activity_logger.info(
                    f"Fetching {len(skill_refs)} skills: {[ref.slug for ref in skill_refs]}"
                )
                skills = await skill_client.list_by_refs(list(skill_refs))
                
                # ─── Step 2.75: Workspace integrity check (resume only) ───
                # Before trusting the fast-path, verify a single sentinel
                # file from the previous execution is still accessible.
                # This validates the full chain: volume mounted → subpath
                # correct → data intact.  One cheap I/O call.
                if is_resume and skills:
                    sentinel_paths = SkillWriter.compute_skill_paths(skills)
                    first_skill_dir = next(iter(sentinel_paths.values()))
                    sentinel = f"{first_skill_dir}/SKILL.md"
                    workspace_files_intact = workspace_backend.file_exists(sentinel)
                    if not workspace_files_intact:
                        activity_logger.warning(
                            "[workspace-check] Sentinel file missing: %s",
                            sentinel,
                        )
                    if workspace_files_intact:
                        activity_logger.info(
                            "[RESUME] Workspace integrity verified "
                            "(sentinel=%s) — volume-backed files intact",
                            sentinel,
                        )
                    else:
                        activity_logger.warning(
                            "[RESUME] Workspace integrity check FAILED "
                            "(sentinel=%s). Falling back to full "
                            "skill/attachment setup.",
                            sentinel,
                        )

                if is_resume and workspace_files_intact:
                    # ─── Resume fast path ─────────────────────────────────────
                    # Skills are already in the sandbox.  Compute paths
                    # deterministically (same logic as SkillWriter.write_skills)
                    # and generate the prompt section without any I/O.
                    skill_paths = SkillWriter.compute_skill_paths(skills)
                    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
                    activity_logger.info(
                        "[RESUME] Skipped skill write — reusing %d skills "
                        "already in sandbox: %s",
                        len(skills),
                        [s.metadata.name for s in skills],
                    )
                else:
                    # ─── Fresh execution path (or resume fallback) ────────────
                    if is_resume:
                        activity_logger.warning(
                            "[RESUME-FALLBACK] Re-writing %d skills to "
                            "workspace (integrity check failed)",
                            len(skills),
                        )
                    # Download artifacts for skills that have storage keys
                    artifacts = {}
                    for skill in skills:
                        if skill.status.artifact_storage_key:
                            activity_logger.info(
                                f"Downloading artifact for skill {skill.metadata.name} "
                                f"(key: {skill.status.artifact_storage_key})"
                            )
                            try:
                                artifact_bytes = await skill_client.get_artifact(
                                    skill.status.artifact_storage_key
                                )
                                artifacts[skill.metadata.id] = artifact_bytes
                                activity_logger.info(
                                    f"Downloaded artifact for {skill.metadata.name}: "
                                    f"{len(artifact_bytes)} bytes"
                                )
                            except Exception as e:
                                activity_logger.warning(
                                    f"Failed to download artifact for {skill.metadata.name}: {e}. "
                                    "Falling back to SKILL.md only."
                                )
                                # Continue without artifact - will use SKILL.md only
                    
                    activity_logger.info(
                        "Writing %d skills to workspace at %s/.stigmer/skills/",
                        len(skills),
                        workspace_backend.root_dir,
                    )
                    skill_writer = SkillWriter(backend=workspace_backend)
                    skill_paths = skill_writer.write_skills(skills, artifacts=artifacts)
                    
                    # Generate prompt section with full SKILL.md content and LOCATION headers
                    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
                    
                    activity_logger.info(
                        f"Successfully wrote {len(skills)} skills: {[s.metadata.name for s in skills]}"
                    )
                    
                    # ─── Diagnostic: verify skill files are accessible ───────────
                    if sandbox is not None:
                        activity_logger.info(
                            "[skill-diag] workspace_root = %r",
                            workspace_backend.root_dir,
                        )
                        for _sid, spath in skill_paths.items():
                            diag_result = workspace_backend.execute(
                                f"ls -la {spath}/ 2>&1 | head -20",
                                timeout=5,
                            )
                            activity_logger.info(
                                "[skill-diag] ls %s/  exit=%d  output=%s",
                                spath,
                                diag_result.exit_code,
                                diag_result.stdout[:300],
                            )

                    # ─── Post-write verification ─────────────────────────────
                    # Create the same backend the agent will use and verify
                    # every skill's SKILL.md is readable.  This catches path
                    # mismatches at setup time rather than at agent runtime.
                    if skill_paths:
                        for _vid, vpath in skill_paths.items():
                            skill_md_path = f"{vpath}/SKILL.md"
                            try:
                                if not workspace_backend.file_exists(skill_md_path):
                                    raise FileNotFoundError(
                                        f"SKILL.md not found at {skill_md_path}"
                                    )
                                content = workspace_backend.read_file(skill_md_path)
                                activity_logger.info(
                                    "Skill post-write verification passed: %s (%d bytes)",
                                    skill_md_path,
                                    len(content),
                                )
                            except Exception as verify_exc:
                                activity_logger.error(
                                    "CRITICAL: Skill at %s not readable through "
                                    "workspace backend: %s",
                                    skill_md_path,
                                    verify_exc,
                                )
                                raise RuntimeError(
                                    f"Skill verification failed for {skill_md_path}: "
                                    f"{verify_exc}"
                                ) from verify_exc
                    
            except RuntimeError as e:
                # Catch write/upload failures from SkillWriter
                activity_logger.error(f"Failed to write skills: {e}")
                raise ValueError(f"Skill write failed: {e}") from e
            except Exception as e:
                activity_logger.error(f"Unexpected error preparing skills: {e}")
                raise
        
        # Heartbeat after skill writing to prevent timeout during setup
        heartbeat_during_setup("skills_written", {
            "skill_count": len(skills) if skills else 0,
            "skill_names": [s.metadata.name for s in skills] if skills else [],
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        setup_timer.start("attachments")
        # Step 3.5: Inject Attachments into Sandbox
        #
        # Attachments are files provided by the user with the execution request.
        # They are injected into the sandbox at their specified mount_path
        # (default: inputs/{filename}), making them available to the agent.
        #
        # All attachments must have storage_key (pre-uploaded via uploadAttachment RPC).
        #
        # RESUME FAST PATH: On the resume-after-approval path, attachments
        # have already been injected by the previous activity invocation.
        # We reconstruct the injected_files list from the execution spec
        # (needed for the system prompt) without re-downloading or
        # re-uploading anything.
        # ─────────────────────────────────────────────────────────────────────────────
        attachments = list(execution.spec.attachments) if execution.spec.attachments else []
        injected_files: list[dict] = []  # Track injected files for system prompt
        
        if attachments:
            if is_resume and workspace_files_intact:
                # ─── Resume fast path ─────────────────────────────────────
                # Attachments are already in the sandbox.  Reconstruct the
                # metadata list for the system prompt without any I/O.
                for att in attachments:
                    mount_path = att.mount_path if att.mount_path else f".stigmer/inputs/{att.filename}"
                    injected_files.append({
                        "filename": att.filename,
                        "path": mount_path,
                        "size": None,  # Not available on resume (content not re-downloaded)
                    })
                activity_logger.info(
                    "[RESUME] Skipped attachment injection — reusing "
                    "%d attachments already in sandbox",
                    len(injected_files),
                )
            else:
                # ─── Fresh execution path (or resume fallback) ────────────
                if is_resume:
                    activity_logger.warning(
                        "[RESUME-FALLBACK] Re-injecting %d attachments "
                        "into workspace (integrity check failed)",
                        len(attachments),
                    )
                activity_logger.info(
                    f"Processing {len(attachments)} attachments: "
                    f"{[a.filename for a in attachments]}"
                )
                
                # Create artifact storage for downloading attachments
                artifact_storage = create_artifact_storage(worker_config.artifact_storage)
                activity_logger.info(
                    f"Created artifact storage ({worker_config.artifact_storage.storage_type}) "
                    "for attachment downloads"
                )
                
                try:
                    injected_files = await inject_attachments(
                        backend=workspace_backend,
                        attachments=attachments,
                        storage=artifact_storage,
                        logger=activity_logger,
                        allow_local_path=worker_config.is_local_mode(),
                    )
                    activity_logger.info(f"Successfully injected {len(injected_files)} attachments")
                except Exception as e:
                    activity_logger.error(f"Failed to inject attachments: {e}")
                    raise ValueError(f"Attachment injection failed: {e}") from e
        
        # Heartbeat after attachment injection to prevent timeout during setup
        heartbeat_during_setup("attachments_injected", {
            "attachment_count": len(attachments),
            "injected_count": len(injected_files),
        })
        
        # Step 5: Fetch and transform MCP servers (agent + session usages merged)
        # MCP servers provide external tools via Model Context Protocol
        setup_timer.start("mcp_servers")
        mcp_servers_config = {}
        mcp_tools_config = {}
        mcp_servers = []  # Initialize to empty list (populated if usages exist and fetch succeeds)
        mcp_server_usages = merge_mcp_server_usages(
            agent.spec.mcp_server_usages, session.spec.mcp_server_usages
        )
        
        if mcp_server_usages:
            activity_logger.info(
                f"Fetching {len(mcp_server_usages)} MCP servers: "
                f"{[usage.mcp_server_ref.slug for usage in mcp_server_usages]}"
            )
            
            try:
                # Create MCP server client
                mcp_server_client = McpServerClient(api_key, channel=obo_ch)
                
                # Extract refs from usages
                mcp_server_refs = [usage.mcp_server_ref for usage in mcp_server_usages]
                
                # Fetch MCP server resources via gRPC
                mcp_servers = await mcp_server_client.list_by_refs(mcp_server_refs)
                
                activity_logger.info(
                    f"Fetched {len(mcp_servers)} MCP servers: "
                    f"{[s.metadata.name for s in mcp_servers]}"
                )
                
                # Transform MCP server configs to LangGraph format
                # Uses merged_env_vars for placeholder resolution (${VAR_NAME})
                mcp_config_result = transform_all_mcp_configs(
                    mcp_servers=mcp_servers,
                    mcp_server_usages=list(mcp_server_usages),
                    env_vars=merged_env_vars,
                )
                
                mcp_servers_config = mcp_config_result.servers
                mcp_tools_config = mcp_config_result.tools
                
                activity_logger.info(
                    f"Transformed MCP configs: servers={list(mcp_servers_config.keys())}, "
                    f"tools={sum(len(t) if t else 0 for t in mcp_tools_config.values())} total"
                )
                
            except ValueError as e:
                # MCP server not found - log error but continue without MCP
                activity_logger.error(f"MCP server fetch failed: {e}")
                activity_logger.warning("Continuing without MCP servers - agent will have limited capabilities")
                mcp_servers_config = {}
                mcp_tools_config = {}
                mcp_servers = []  # Reset to empty on failure
            except Exception as e:
                activity_logger.error(f"Unexpected error preparing MCP servers: {e}")
                activity_logger.warning("Continuing without MCP servers - agent will have limited capabilities")
                mcp_servers_config = {}
                mcp_tools_config = {}
                mcp_servers = []  # Reset to empty on failure
        
        # Heartbeat after MCP server transform to prevent timeout during setup
        heartbeat_during_setup("mcp_servers_transformed", {
            "mcp_server_count": len(mcp_servers),
            "mcp_servers": list(mcp_servers_config.keys()) if mcp_servers_config else [],
        })
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.6: Build ApprovalConfig and Initialize StatusBuilder (HITL Phase 3A)
        #
        # Assembles approval policy configuration from multiple sources:
        # - execution.spec.auto_approve_all (runtime bypass)
        # - mcp_server_usages[].tool_approval_overrides (per-agent customization)
        # - mcp_servers[].spec.default_tool_approvals (platform/org defaults)
        #
        # StatusBuilder is initialized here (not earlier) to receive the complete
        # ApprovalConfig for tool approval detection during execution.
        # ─────────────────────────────────────────────────────────────────────────────
        
        approval_config = build_approval_config(
            execution=execution,
            mcp_server_usages=list(mcp_server_usages) if mcp_server_usages else [],
            mcp_servers=mcp_servers,
            mcp_tools_config=mcp_tools_config,
        )
        
        activity_logger.info(
            f"Built ApprovalConfig: auto_approve_all={approval_config.auto_approve_all}, "
            f"overrides={len(approval_config.tool_approval_overrides)}, "
            f"default_policies={len(approval_config.default_tool_approvals)} servers, "
            f"tool_mapping={len(approval_config.tool_to_mcp_server)} tools"
        )
        
        # Initialize status builder with approval config
        status_builder = StatusBuilder(execution_id, execution.status, approval_config)
        status_builder.set_display_env_vars(merged_env_vars, secret_keys)
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.7: Build ResolvedExecutionContext (Phase 2.5)
        #
        # Captures what resources the agent actually has access to for visibility,
        # debugging, and auditing. Populated once before streaming begins.
        # ─────────────────────────────────────────────────────────────────────────────
        
        # Build MCP server resolution status
        # Track which servers were requested vs successfully resolved
        mcp_server_status = {}
        requested_mcp_slugs = (
            {usage.mcp_server_ref.slug for usage in mcp_server_usages}
            if mcp_server_usages else set()
        )
        resolved_mcp_slugs = set(mcp_servers_config.keys())
        
        for slug in requested_mcp_slugs:
            if slug in resolved_mcp_slugs:
                # Server successfully resolved - count enabled tools
                tool_count = len(mcp_tools_config.get(slug, []) or [])
                mcp_server_status[slug] = (True, "Configured successfully", tool_count)
            else:
                # Server resolution failed
                mcp_server_status[slug] = (False, "Server not found or resolution failed", 0)
        
        # ── Skill relevance filtering ─────────────────────────────────────
        # When the agent has many skills, low-relevance skills are excluded
        # from the system prompt to improve signal quality.  Excluded skills
        # remain on disk and a brief "also available" note is appended so
        # the agent can still activate them if needed.
        from worker.activities.graphton.skill_relevance import filter_skills

        all_skill_names = [s.metadata.name for s in skills] if skills else []
        excluded_skill_names: list[str] = []

        if skills and len(skills) >= 8:
            filter_result = filter_skills(
                user_message=user_message,
                skill_names=[s.metadata.name for s in skills],
                skill_descriptions=[s.spec.description or "" for s in skills],
            )
            if filter_result.excluded_names:
                included_skills = [skills[i] for i in filter_result.included_indices]
                excluded_skill_names = filter_result.excluded_names
                activity_logger.info(
                    "Skill relevance filter: %d included, %d excluded %s",
                    len(included_skills),
                    len(excluded_skill_names),
                    excluded_skill_names,
                )
                # Rebuild the prompt section with only included skills.
                # Skill paths are already computed for ALL skills (included
                # and excluded) so the agent can still read excluded skills.
                skills_prompt_section = SkillWriter.generate_prompt_section(
                    included_skills, skill_paths,
                )
                skills_prompt_section += SkillWriter.generate_also_available_section(
                    excluded_skill_names,
                )
                # Update the name list to reflect what is in the prompt.
                all_skill_names = [s.metadata.name for s in included_skills]

        # Set resolved context on status builder
        status_builder.set_resolved_context(
            environment_keys=list(merged_env_vars.keys()),
            mcp_servers=mcp_server_status,
            skill_names=all_skill_names,
            excluded_skill_names=excluded_skill_names,
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.8: Initialize Context Management Tracking (Phase 3)
        #
        # Sets up context info for tracking context window utilization and
        # summarization events. The StatusBuilder implements SummarizationCallback
        # to receive events from the middleware during execution.
        # ─────────────────────────────────────────────────────────────────────────────
        
        # Get model metadata for context window info
        model_metadata = ModelRegistry.get_or_default(model_name)
        
        # Initialize context info on status builder
        status_builder.initialize_context_info(
            context_window_limit=model_metadata.context_window_tokens,
            trigger_threshold=summarization_config.trigger_threshold,
            target_tokens=summarization_config.target_tokens,
            enabled=summarization_config.enabled,
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.9: Build cost pricing for cost cap middleware (Phase 3B)
        #
        # Extract pricing rates from ModelRegistry for the primary model.
        # The cost cap middleware uses these for rough cost estimation.
        # Only built when max_cost_usd > 0 (otherwise no cap middleware).
        # ─────────────────────────────────────────────────────────────────────────────
        cost_pricing: dict[str, float] | None = None
        if max_cost_usd > 0.0:
            cost_pricing = {
                "input_price_per_million": model_metadata.input_price_per_million or 0.0,
                "output_price_per_million": model_metadata.output_price_per_million or 0.0,
                "cache_read_price_per_million": model_metadata.cache_read_price_per_million or 0.0,
            }
            activity_logger.info(
                "Cost pricing for cap middleware: input=$%.2f/MTok, "
                "output=$%.2f/MTok, cache_read=$%.2f/MTok",
                cost_pricing["input_price_per_million"],
                cost_pricing["output_price_per_million"],
                cost_pricing["cache_read_price_per_million"],
            )

        # Build truncation callback to wire middleware → UsageTracker (Phase 3B).
        # The callback is invoked each time the tool truncation middleware
        # truncates a tool result, forwarding the character count to the
        # usage tracker for accumulation in UsageMetrics.tool_result_chars_truncated.
        from worker.activities.graphton.usage_tracker import MAIN_SCOPE

        def _on_tool_truncation(tool_name: str, chars_truncated: int) -> None:
            status_builder.usage_tracker.record_tool_truncation(
                chars_truncated, MAIN_SCOPE,
            )

        # Step 6: Create Graphton agent at runtime with EXISTING sandbox
        # Note: MCP servers are passed if configured, providing external tool access
        setup_timer.start("agent_creation")
        activity_logger.info(f"Creating Graphton agent for execution {execution_id}")
        
        workspace_roots = [
            WorkspaceRoot(name=pr.entry_name, root_dir=pr.root_dir)
            for pr in provision_results
        ]
        workspace_file_refs = list(
            execution.spec.workspace_file_refs
        ) if execution.spec.workspace_file_refs else []

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

        # Configure sandbox for Graphton agent.
        # Derive the config from workspace_backend + sandbox rather than
        # branching on mode.
        if sandbox is not None:
            sandbox_config_for_agent: dict[str, Any] = {
                "type": "daytona",
                "sandbox_id": sandbox.id,
                "workspace_root": workspace_backend.root_dir,
            }
            activity_logger.info(
                "Configuring agent to use existing sandbox %s "
                "(workspace_root=%s)",
                sandbox.id,
                workspace_backend.root_dir,
            )
        else:
            sandbox_config_for_agent = sandbox_config.copy()
            sandbox_config_for_agent["root_dir"] = workspace_backend.root_dir
            if workspace_init.platform_dir:
                sandbox_config_for_agent["platform_dir"] = workspace_init.platform_dir
            activity_logger.info(
                "Configuring agent for local mode (root=%s, platform_dir=%s)",
                workspace_backend.root_dir,
                workspace_init.platform_dir,
            )
        
        if merged_env_vars:
            sandbox_config_for_agent["env_vars"] = dict(merged_env_vars)
            activity_logger.info(
                "Injecting %d env var(s) into sandbox config for shell execution",
                len(merged_env_vars),
            )

        # Multi-local-path: collect host paths so the FilesystemBackend
        # can accept resolved symlink targets in its containment check
        # and rewrite absolute host paths to entry-relative form.
        if len(provision_results) > 1 and sandbox is None:
            local_roots: dict[str, str] = {
                pr.entry_name: pr.root_dir
                for pr in provision_results
                if pr.source_type == SourceType.LOCAL_PATH and pr.entry_name
            }
            if local_roots:
                sandbox_config_for_agent["allowed_roots"] = local_roots
                activity_logger.info(
                    "Configured %d allowed root(s) for multi-local-path: %s",
                    len(local_roots),
                    ", ".join(f"{n}={p}" for n, p in local_roots.items()),
                )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Resolve model name for logging/diagnostics only.
        #
        # The actual model creation and configuration (ANTHROPIC_DEFAULTS, thinking,
        # etc.) happens inside create_deep_agent() → parse_model_string().  This
        # early resolve is kept only so we can log the resolved API model ID and
        # include it in heartbeats.
        # ─────────────────────────────────────────────────────────────────────────────
        api_model_id, _ = ModelRegistry.resolve_or_passthrough(
            model_name,
            provider=worker_config.llm.provider,
        )
        
        if api_model_id != model_name:
            activity_logger.info(
                f"Resolved model '{model_name}' to API model ID '{api_model_id}'"
            )
        
        # Build provider-specific kwargs for model creation.
        # The model name is passed as a string to create_deep_agent(), which
        # routes it through parse_model_string() to apply ANTHROPIC_DEFAULTS,
        # thinking configuration, and all model-registry metadata.
        llm_kwargs: dict[str, Any] = {}
        if worker_config.llm.provider == "ollama":
            llm_kwargs["base_url"] = worker_config.llm.base_url
        elif worker_config.llm.provider == "anthropic":
            llm_kwargs["api_key"] = worker_config.llm.api_key
        elif worker_config.llm.provider == "openai":
            llm_kwargs["api_key"] = worker_config.llm.api_key
        
        # Create approval checker for HITL tool approval flow (Phase 3B)
        # The checker evaluates the approval policy chain for each tool invocation
        approval_checker = create_approval_checker(approval_config)
        
        activity_logger.info(
            f"Created approval checker for HITL flow "
            f"(auto_approve_all={approval_config.auto_approve_all})"
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.9: Transform SubAgents (Sub-agent Execution Support)
        #
        # Transforms proto SubAgent definitions from AgentSpec.sub_agents to graphton
        # format. Each subagent gets:
        # - Platform tools (read, write, ls, glob, grep, execute) from the sandbox
        # - Filtered MCP access based on McpAccess grants (subset of parent's tools)
        # - Resolved skills injected into system_prompt
        #
        # Permission model:
        # - Every subagent receives the full platform tool set from the sandbox
        # - SubAgent can only access MCP servers explicitly listed in mcp_access
        # - SubAgent MCP tools = intersection of parent's enabled tools and subagent's request
        # - SubAgent skills are independent (can reference any Skill resource)
        # ─────────────────────────────────────────────────────────────────────────────
        
        transformed_subagents = None
        
        if agent.spec.sub_agents:
            activity_logger.info(
                f"Transforming {len(agent.spec.sub_agents)} sub-agent(s): "
                f"{[sa.name for sa in agent.spec.sub_agents]}"
            )
            
            try:
                transformed_subagents = await transform_sub_agents(
                    sub_agents=list(agent.spec.sub_agents),
                    parent_mcp_servers=mcp_servers_config or {},
                    parent_mcp_tools=mcp_tools_config or {},
                    parent_mcp_usages=list(mcp_server_usages) if mcp_server_usages else [],
                    skill_client=skill_client,
                    skill_writer_class=SkillWriter,
                    skill_writer_kwargs={"backend": workspace_backend},
                    sandbox_config=sandbox_config_for_agent,
                    approval_checker=approval_checker,
                    activity_logger=activity_logger,
                )
                
                if transformed_subagents:
                    activity_logger.info(
                        f"Successfully transformed {len(transformed_subagents)} sub-agent(s) "
                        f"with platform tools, MCP tools, and skills"
                    )
                else:
                    activity_logger.warning(
                        "No valid sub-agents after transformation (all may have invalid configs)"
                    )
                    
            except Exception as e:
                activity_logger.error(f"Failed to transform sub-agents: {e}")
                activity_logger.warning("Continuing without sub-agents - agent will not delegate tasks")
                transformed_subagents = None
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 5.10: Create Artifact Storage & Inline Publish Callback
        #
        # Artifact storage uploads files created/modified by the agent as
        # downloadable artifacts.  The agent does NOT receive a
        # publish_artifact tool — publishing is handled structurally by the
        # platform, both inline (fire-and-forget on each write/edit tool
        # completion) and post-stream (safety-net for anything missed).
        # ─────────────────────────────────────────────────────────────────────────────
        artifact_storage = create_artifact_storage(worker_config.artifact_storage)
        activity_logger.info(
            f"Created artifact storage ({worker_config.artifact_storage.storage_type}) "
            "for inline + post-stream artifact publish"
        )

        async def _publish_file_inline(path: str) -> None:
            """Fire-and-forget callback: upload a single file from the
            sandbox to artifact storage and register it on the status
            builder so the next progressive gRPC update carries it to
            the UI.

            Exceptions are logged and swallowed — this must never crash
            the streaming loop.
            """
            from pathlib import PurePosixPath

            try:
                normalizer = (
                    workspace_backend._normalize
                    if hasattr(workspace_backend, "_normalize")
                    else None
                )
                rel_path = normalizer(path) if normalizer else path.lstrip("/")
                file_name = PurePosixPath(rel_path).name

                artifact = await _publish_artifact_to_storage(
                    sandbox=sandbox,
                    storage=artifact_storage,
                    execution_id=execution_id,
                    path=rel_path,
                    name=file_name,
                    local_root=(
                        workspace_backend.root_dir if sandbox is None else None
                    ),
                )
                status_builder.add_artifact(artifact)
                activity_logger.info(
                    f"[INLINE_PUBLISH] execution={execution_id} — "
                    f"published '{rel_path}' as artifact '{file_name}'"
                )
            except Exception as exc:
                activity_logger.warning(
                    f"[INLINE_PUBLISH] execution={execution_id} — "
                    f"failed to publish '{path}' (non-fatal, safety net "
                    f"will retry): {exc}"
                )
        
        # Create Graphton agent.
        #
        # Recursion limit: graphton's default (1000) applies via with_config()
        # at graph compilation time unless overridden by the user via
        # ExecutionConfig.max_tool_rounds.  The default gives the main agent
        # ~166 model+tool rounds (~4 min).  Loop detection middleware is the
        # primary behavioral safety; the recursion limit is the cost ceiling.
        # Sub-agent graphs use deepagents' DEFAULT_RECURSION_LIMIT (10,000),
        # giving them generous room independently.
        #
        # Graphton's ExecutionBudgetMiddleware injects a wrap-up SystemMessage
        # at ~80 % of the budget, and LoopDetectionMiddleware provides
        # pattern-based intervention.  The hard stop at 100 % is LangGraph's
        # GraphRecursionError, handled below.
        #
        # Sandbox tools: graphton creates platform tool wrappers (read, write,
        # edit, execute, ls, glob, grep) backed by the sandbox. deepagents also
        # creates in-memory filesystem tools (read_file, write_file, edit_file)
        # via its FilesystemMiddleware. Both sets coexist in the tool registry.
        agent_kwargs: dict[str, Any] = dict(
            model=model_name,
            system_prompt=enhanced_system_prompt,
            mcp_servers=mcp_servers_config if mcp_servers_config else None,
            mcp_tools=mcp_tools_config if mcp_tools_config else None,
            tools=None,
            subagents=transformed_subagents,
            sandbox_config=sandbox_config_for_agent,
            checkpointer=checkpointer,
            approval_checker=approval_checker,
            summarization_config=summarization_config,
            summarization_callback=status_builder,
            max_tool_result_chars=max_tool_result_chars,
            tool_truncation_callback=_on_tool_truncation,
            max_cost_usd=max_cost_usd,
            cost_pricing=cost_pricing,
            **llm_kwargs,
        )
        if recursion_limit is not None:
            agent_kwargs["recursion_limit"] = recursion_limit
        agent_graph = create_deep_agent(**agent_kwargs)
        
        activity_logger.info(f"Graphton agent created successfully with {'new' if is_new_sandbox else 'reused'} sandbox")
        
        # Heartbeat after agent creation to prevent timeout during setup
        heartbeat_during_setup("agent_created", {
            "model": api_model_id,
            "sandbox_new": is_new_sandbox,
            "has_subagents": transformed_subagents is not None and len(transformed_subagents) > 0,
        })
        
        # Step 7: Prepare invocation input
        # Append organization context to message
        context_section = f"\n\n---\nContext:\n- Organization: {execution.metadata.org}"
        message_with_context = user_message + context_section
        
        langgraph_input = {
            "messages": [{"role": "user", "content": message_with_context}]
        }
        
        # Prepare config with thread_id for state persistence.
        #
        # recursion_limit is set HERE in the invoke config — this is the
        # authoritative override.  The invoke config is the LAST config
        # processed by LangGraph's merge_configs chain, so it takes priority
        # over any .with_config() bindings (including deepagents' internal
        # recursion_limit=1000).
        #
        # Additionally, LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000 is set in
        # the agent-runner environment (daemon_process.go) as a framework-wide
        # default that also covers subagent graphs.
        unlimited_recursion = 10_000_000
        effective_recursion_limit = (
            recursion_limit if recursion_limit is not None else unlimited_recursion
        )
        config = {
            "configurable": {
                "thread_id": thread_id,
                "org": execution.metadata.org,
            },
            "recursion_limit": effective_recursion_limit,
        }
        
        activity_logger.info(
            "Using thread_id=%s for Graphton execution %s "
            "(recursion_limit=%d%s)",
            thread_id, execution_id,
            effective_recursion_limit,
            " [unlimited]" if recursion_limit is None else "",
        )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 7.5: Check for Resume from HITL Approval (Batch Approval)
        #
        # If the workflow passed approval_decisions, it means the execution was
        # previously interrupted for approval (WAITING_FOR_APPROVAL) and the user
        # has submitted decisions.  We correlate the decisions (passed as activity
        # args — small, bounded) with pending_approvals from the DB-fetched
        # execution status (which has interrupt_ids) to build the LangGraph
        # Command(resume={id_A: decision_A, ...}) dict.
        #
        # With **Batch Approval**, the LLM may have issued N tool calls that each
        # required approval.  All N decisions are collected before the Temporal
        # workflow re-invokes this activity.  We build a dict that maps each
        # LangGraph interrupt_id to its decision value and pass it as a single
        #   Command(resume={id_A: decision_A, id_B: decision_B, ...})
        # so the graph processes every interrupt in one re-execution of the
        # tools node — avoiding repeated node re-runs and idempotency issues.
        # ─────────────────────────────────────────────────────────────────────────────
        
        resume_decision: dict[str, Any] | None = None
        is_resume_from_approval = False
        
        # Proto enum → action string for interrupt resume values
        _action_map = {
            ApprovalAction.APPROVAL_ACTION_APPROVE: "approve",
            ApprovalAction.APPROVAL_ACTION_SKIP: "skip",
            ApprovalAction.APPROVAL_ACTION_REJECT: "reject",
        }
        
        # --- Build resume dict from approval_decisions + pending_approvals -------
        #
        # approval_decisions: passed by the workflow as activity args (small payload)
        #   Each SubmitApprovalInput has: tool_call_id, action, comment
        #
        # pending_approvals: fetched from the DB-persisted execution status
        #   Each PendingApproval has: tool_call_id, interrupt_id, tool_name, ...
        #
        # We join on tool_call_id to pair each decision with its interrupt_id.
        if approval_decisions:
            # Index decisions by tool_call_id for O(1) lookup
            decisions_by_tool_call: dict[str, SubmitApprovalInput] = {
                d.tool_call_id: d for d in approval_decisions
            }
            
            pending_approvals = list(execution.status.pending_approvals)
            resume_dict: dict[str, dict[str, str]] = {}
            needs_interrupt_discovery: list[tuple[PendingApproval, dict[str, str]]] = []
            loop_aborted = False
            
            for pa in pending_approvals:
                decision = decisions_by_tool_call.get(pa.tool_call_id)
                if not decision:
                    activity_logger.warning(
                        f"⚠️ pending_approvals entry tool_call_id={pa.tool_call_id} "
                        f"has no matching approval_decision. Skipping batch resume."
                    )
                    loop_aborted = True
                    break
                
                action_str = _action_map.get(decision.action, "unknown")
                decision_value: dict[str, str] = {"action": action_str}
                if decision.comment:
                    decision_value["comment"] = decision.comment
                
                if pa.interrupt_id:
                    resume_dict[pa.interrupt_id] = decision_value
                else:
                    needs_interrupt_discovery.append((pa, decision_value))
            
            if loop_aborted:
                resume_dict = {}
            
            # Defense-in-depth: when Phase 2 enrichment failed to populate
            # interrupt_id (e.g., legacy from_sub_agent mismatch), query the
            # graph checkpoint to discover the actual interrupt IDs.
            if not loop_aborted and needs_interrupt_discovery:
                activity_logger.info(
                    f"[DIAG] Resume path: {len(needs_interrupt_discovery)} "
                    f"pending approval(s) need interrupt discovery: "
                    + ", ".join(
                        f"tool={pa.tool_name} tc_id={pa.tool_call_id}"
                        for pa, _ in needs_interrupt_discovery
                    )
                )
                try:
                    graph_state = await agent_graph.aget_state(
                        cast(RunnableConfig, config)
                    )
                    if graph_state and graph_state.interrupts:
                        activity_logger.info(
                            f"[DIAG] Resume path: {len(graph_state.interrupts)} "
                            f"interrupt(s) in graph state: "
                            + ", ".join(
                                f"id={i.id} tool={i.value.get('tool_name', '') if isinstance(i.value, dict) else ''}"
                                for i in graph_state.interrupts
                            )
                        )
                        consumed_ids = set(resume_dict.keys())
                        available_interrupts = [
                            i for i in graph_state.interrupts
                            if i.id not in consumed_ids
                        ]
                        for pa, dv in needs_interrupt_discovery:
                            matched_intr = None
                            for intr in available_interrupts:
                                intr_value = intr.value if hasattr(intr, "value") else {}
                                intr_tool = (
                                    intr_value.get("tool_name", "")
                                    if isinstance(intr_value, dict) else ""
                                )
                                if intr_tool == pa.tool_name:
                                    matched_intr = intr
                                    break
                            if not matched_intr and len(available_interrupts) == 1 and len(needs_interrupt_discovery) == 1:
                                matched_intr = available_interrupts[0]
                            if matched_intr:
                                resume_dict[matched_intr.id] = dv
                                available_interrupts.remove(matched_intr)
                                activity_logger.info(
                                    f"[RESUME_FALLBACK] Discovered interrupt_id="
                                    f"{matched_intr.id} for tool={pa.tool_name} "
                                    f"tc_id={pa.tool_call_id} via graph checkpoint"
                                )
                            else:
                                activity_logger.warning(
                                    f"⚠️ [RESUME_PARTIAL] Cannot discover interrupt_id "
                                    f"for tool={pa.tool_name} tc_id={pa.tool_call_id}. "
                                    f"Skipping — partial resume will proceed with "
                                    f"{len(resume_dict)} resolved interrupt(s)."
                                )
                    else:
                        activity_logger.warning(
                            "[RESUME_FALLBACK] No interrupts in graph checkpoint. "
                            "Proceeding with %d already-resolved interrupt(s).",
                            len(resume_dict),
                        )
                except Exception as e:
                    activity_logger.warning(
                        f"[RESUME_FALLBACK] Failed to query graph state for "
                        f"interrupt discovery: {e}. Proceeding with "
                        f"{len(resume_dict)} already-resolved interrupt(s)."
                    )
            
            # Defense-in-depth: when pending_approvals was completely empty
            # (cleared upstream), discover interrupt IDs from checkpoint.
            if not resume_dict and not loop_aborted:
                checkpoint_fb = CheckpointFallback(
                    execution_id=execution_id,
                    logger=activity_logger,
                )
                resume_dict = await checkpoint_fb.discover_interrupts(
                    agent_graph=agent_graph,
                    config=config,
                    approval_decisions=approval_decisions,
                    pending_approvals=pending_approvals,
                    action_map=_action_map,
                )
            
            if resume_dict:
                is_resume_from_approval = True
                resume_decision = resume_dict
                activity_logger.info(
                    f"🔄 Batch resume from {len(resume_dict)} approval(s) for "
                    f"execution {execution_id}: "
                    + ", ".join(
                        f"interrupt_id={iid} action={d['action']}"
                        for iid, d in resume_dict.items()
                    )
                )
        
        # ─────────────────────────────────────────────────────────────────────────────
        # Step 7.6: Reconcile Loaded Status for Resume Path
        #
        # On resume, the StatusBuilder was initialized with the DB-persisted status
        # from the *previous* invocation.  That status contains tool calls that were
        # interrupted for approval with TOOL_CALL_WAITING_APPROVAL status — they
        # were never updated because the previous invocation ended at the interrupt.
        #
        # Without reconciliation, these stale WAITING_APPROVAL entries poison the
        # post-stream interrupt capture: when the next tool triggers an interrupt,
        # the capture code matches the interrupt to the stale entry (first hit in
        # the tool_calls list by tool_name + WAITING_APPROVAL) instead of the new
        # tool call.  The resulting PendingApproval carries the old tool_call_id,
        # which the CLI has already prompted for — so the approval prompt is skipped.
        #
        # We fix this by:
        # 1. Updating each approved/skipped/rejected tool call to a non-WAITING
        #    status so it cannot be matched by the interrupt capture code.
        # 2. Clearing the stale pending_approvals from the loaded status.
        # 3. Pre-populating StatusBuilder's fingerprint set from existing tool calls
        #    to prevent duplicate entries when LangGraph re-fires on_tool_start for
        #    resumed tools.
        # ─────────────────────────────────────────────────────────────────────────────
        if is_resume_from_approval and approval_decisions:
            resume_reconciler = ResumeReconciler(
                execution_id=execution_id,
                status_builder=status_builder,
                state_manager=ApprovalStateManager(
                    execution_id=execution_id, logger=activity_logger,
                ),
                logger=activity_logger,
            )
            resume_reconciler.reconcile(approval_decisions=approval_decisions)
        
        # Log total setup time before entering the streaming phase.
        # This is the boundary between "setup" and "execution" — any time
        # spent beyond this point is in the LangGraph streaming loop.
        setup_timer.stop()
        setup_timer.log_total()
        
        # Step 8: Set phase to IN_PROGRESS (status built locally)
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        activity_logger.info(f"Execution {execution_id} phase set to IN_PROGRESS (building locally)")
        
        # Step 9: Stream execution and build status from events
        streaming_config = StreamingConfig.load_from_env()
        default_grpc_update_timeout = 10
        grpc_update_timeout_seconds = int(
            os.environ.get(
                "GRAPHTON_GRPC_UPDATE_TIMEOUT_SECONDS",
                default_grpc_update_timeout,
            )
        )
        default_stall_timeout = 300
        stall_timeout_seconds = int(
            os.environ.get("GRAPHTON_STALL_TIMEOUT_SECONDS", default_stall_timeout)
        )
        
        # Determine graph input based on whether this is a resume or fresh
        graph_input: Any
        if is_resume_from_approval and resume_decision is not None:
            from langgraph.types import Command
            graph_input = Command(resume=resume_decision)
            if isinstance(resume_decision, dict) and "action" not in resume_decision:
                summary = ", ".join(
                    f"{iid[:12]}...={d.get('action', '?')}"
                    for iid, d in resume_decision.items()
                )
                activity_logger.info(
                    f"Resuming Graphton agent (batch) for execution {execution_id} "
                    f"({len(resume_decision)} interrupt(s): {summary})"
                )
            else:
                activity_logger.info(
                    f"Resuming Graphton agent (legacy) for execution {execution_id} "
                    f"(decision={resume_decision.get('action', '?')})"
                )
        else:
            graph_input = langgraph_input
            activity_logger.info(
                f"Starting Graphton agent stream for execution {execution_id} "
                f"(streaming: min_interval={streaming_config.min_interval_ms}ms, "
                f"max_interval={streaming_config.max_interval_ms}ms, "
                f"burst_threshold={streaming_config.burst_threshold})"
            )
        
        from worker.activities.graphton.streaming import StreamExecutor
        stream_executor = StreamExecutor(
            agent_graph=agent_graph,
            config=config,
            execution_id=execution_id,
            thread_id=thread_id,
            status_builder=status_builder,
            execution_client=execution_client,
            streaming_config=streaming_config,
            stall_timeout_seconds=stall_timeout_seconds,
            grpc_update_timeout_seconds=grpc_update_timeout_seconds,
            effective_recursion_limit=effective_recursion_limit,
            heartbeat_fn=activity.heartbeat,
            is_cancelled_fn=activity.is_cancelled,
            slim_status_fn=_slim_status_for_temporal,
            logger=activity_logger,
            on_file_written=_publish_file_inline,
        )
        stream_result = await stream_executor.execute(
            graph_input, is_resume=is_resume_from_approval,
        )
        if stream_result.terminal_status is not None:
            return stream_result.terminal_status
        events_processed = stream_result.events_processed
        
        from worker.activities.graphton.post_stream import process_post_stream
        post_result = await process_post_stream(
            status_builder=status_builder,
            execution_id=execution_id,
            agent_graph=agent_graph,
            config=config,
            sandbox=sandbox,
            artifact_storage=artifact_storage,
            workspace_backend=workspace_backend,
            merged_env_vars=merged_env_vars,
            secret_keys=secret_keys,
            auto_publish_fn=_auto_publish_written_files,
            pending_publish_tasks=stream_executor.pending_publish_tasks,
            resolve_platform_tool_name=resolve_platform_tool_name,
            humanize_platform_refs=humanize_platform_refs,
            resolve_display_env_vars=resolve_display_env_vars,
            logger=activity_logger,
        )
        final_phase_name = post_result.final_phase_name
        
        # Send final status update via gRPC with retry.
        # This is critical for data persistence — use retry to handle transient failures.
        # The update is sent regardless of phase so that the latest messages, tool_calls,
        # and context info are always persisted.
        try:
            activity_logger.info(
                f"📤 [FINAL] Sending {final_phase_name} status update with retry"
            )
            await retry_executor.execute(
                operation=lambda: execution_client.update_status(
                    execution_id=execution_id,
                    status=status_builder.current_status
                ),
                operation_name="final_status_update",
                context={"execution_id": execution_id, "phase": final_phase_name},
            )
            activity_logger.info(f"✅ [FINAL] Status update sent successfully (phase={final_phase_name})")
        except GrpcRetryExhaustedError as e:
            activity_logger.error(
                f"[FINAL] All retries exhausted for status update: {e.attempts} attempts, "
                f"{e.total_duration_ms:.0f}ms total. Last error: {e.last_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except GrpcNonRetryableError as e:
            activity_logger.error(
                f"[FINAL] Non-retryable error on status update: {e.status_code.name} - {e.original_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except Exception as e:
            activity_logger.error(f"[FINAL] Unexpected error on status update: {e}")
            # Continue - we'll still return status to workflow as fallback
        
        # Diagnostic logging for final status
        activity_logger.info("=" * 80)
        activity_logger.info(f"📊 [FINAL_STATUS] Execution {execution_id}:")
        activity_logger.info(f"   messages: {len(status_builder.current_status.messages)}")
        activity_logger.info(f"   tool_calls: {len(status_builder.current_status.tool_calls)}")
        activity_logger.info(f"   sub_agent_executions: {len(status_builder.current_status.sub_agent_executions)}")
        activity_logger.info(f"   todos: {len(status_builder.current_status.todos)}")
        activity_logger.info(f"   artifacts: {len(status_builder.current_status.artifacts)}")
        activity_logger.info(f"   phase: {ExecutionPhase.Name(status_builder.current_status.phase)}")
        activity_logger.info("=" * 80)
        
        activity_logger.info(
            "✅ ExecuteGraphton completed - returning slim status to workflow"
        )
        
        # Return slim status to workflow (full status already persisted via gRPC above)
        return _slim_status_for_temporal(status_builder.current_status)
    
    except Exception as e:
        # Capture the full exception context for diagnostics.  str(e) alone
        # is often cryptic (e.g. a bare field name like "size_bytes") —
        # the exception type and traceback are essential for root-cause analysis.
        exc_type = type(e).__name__
        exc_tb = traceback.format_exc()
        activity_logger.error(
            f"ExecuteGraphton failed for execution {execution_id}: "
            f"[{exc_type}] {e}\n{exc_tb}"
        )
        
        # Build a human-readable error message that includes the exception type
        # so cryptic bare-string exceptions are at least classifiable.
        error_str = str(e)
        error_message = f"Execution failed: [{exc_type}] {error_str}"
        
        # Import required types for error message


        
        error_msg = AgentMessage(
            type=MessageType.MESSAGE_SYSTEM,
            content=f"❌ Error: {error_message}",
            timestamp=_utc_timestamp(),
        )
        
        # Check if status_builder was initialized before the error occurred
        # If not, create a minimal failed status (handles early failures like attachment injection)
        if status_builder is not None:
            status_builder.finalize_active_sub_agents(
                SubAgentStatus.SUB_AGENT_FAILED,
                f"Parent execution failed: {error_message}",
            )

            # Use status_builder for rich error reporting
            status_builder.current_status.messages.append(error_msg)

            # Finalize context info before returning (Phase 3)
            # Even on failure, we want to capture any context tracking data
            status_builder.finalize_context_info()
            
            status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
            status_builder.current_status.error = error_message
            
            # Stamp completed_at and finalize usage so partial cost data is persisted
            if not status_builder.current_status.completed_at:
                status_builder.current_status.completed_at = _utc_timestamp()
            status_builder.finalize_usage()
            
            failed_status = status_builder.current_status
        else:
            # Early failure before status_builder was created
            # Create minimal failed status (similar to outer handler)
            activity_logger.warning(
                f"status_builder not initialized - creating minimal failed status for {execution_id}"
            )
            failed_status = AgentExecutionStatus(
                phase=ExecutionPhase.EXECUTION_FAILED,
                error=error_message,
                messages=[
                    error_msg,
                    AgentMessage(
                        type=MessageType.MESSAGE_SYSTEM,
                        content="Execution failed during initialization before agent could start.",
                        timestamp=_utc_timestamp(),
                    )
                ]
            )
        
        activity_logger.info(f"Execution {execution_id} phase set to FAILED - returning error status to workflow")
        
        # Send failed status update via gRPC with retry
        # This is critical for data persistence - use retry to handle transient failures
        try:
            activity_logger.info("📤 [FINAL] Sending FAILED status update with retry")
            await retry_executor.execute(
                operation=lambda: execution_client.update_status(
                    execution_id=execution_id,
                    status=failed_status
                ),
                operation_name="final_status_update",
                context={"execution_id": execution_id, "phase": "FAILED"},
            )
            activity_logger.info("✅ [FINAL] Failed status update sent successfully")
        except GrpcRetryExhaustedError as retry_err:
            activity_logger.error(
                f"[FINAL] All retries exhausted for failed status update: {retry_err.attempts} attempts, "
                f"{retry_err.total_duration_ms:.0f}ms total. Last error: {retry_err.last_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except GrpcNonRetryableError as grpc_err:
            activity_logger.error(
                f"[FINAL] Non-retryable error on failed status update: {grpc_err.status_code.name} - {grpc_err.original_error}"
            )
            # Continue - we'll still return status to workflow as fallback
        except Exception as update_error:
            activity_logger.error(f"[FINAL] Unexpected error on failed status update: {update_error}")
            # Continue - we'll still return status to workflow as fallback
        
        activity_logger.info(
            f"✅ Returning failed AgentExecutionStatus to workflow: "
            f"type={type(failed_status).__name__}"
        )
        
        # Return slim status to workflow (full status already persisted via gRPC above)
        return _slim_status_for_temporal(failed_status)
    
    finally:
        # Clean up workspace backend (deletes the Daytona process session used
        # for sandbox command execution, if one was created).
        if workspace_backend is not None:
            workspace_backend.close()

        # Clean up checkpointer resources (SQLite connection, MongoDB client, etc.)
        # This runs regardless of success or failure, ensuring no resource leaks.
        await exit_stack.aclose()
        await grpc_provider.close()
