"""Temporal worker for agent-runner service."""

import logging
from datetime import timedelta

from temporalio.client import Client
from temporalio.worker import Worker

from .auth import configure as configure_auth
from .config import Config
from .heartbeat import HeartbeatEmitter
from .temporal_converter import create_data_converter


class AgentRunner:
    """Temporal worker that executes Graphton agent activities."""
    
    def __init__(self, config: Config):
        self.config = config
        self.client: Client | None = None
        self.worker: Worker | None = None
        self._heartbeat: HeartbeatEmitter | None = None
        self.logger = logging.getLogger(__name__)
        
        configure_auth(config.stigmer_token)
        self.logger.info("Configured Stigmer auth token")

        if config.agent_runner_id:
            self._heartbeat = HeartbeatEmitter(
                agent_runner_id=config.agent_runner_id,
                token=config.stigmer_token,
                backend_endpoint=config.stigmer_backend_endpoint,
                max_concurrency=config.max_concurrency,
            )
        
        # Initialize cloud-mode infrastructure
        if not config.is_local_mode():
            self._validate_mongodb_connectivity()
            self._initialize_snapshot_resolver()
    
    def _validate_mongodb_connectivity(self):
        """Validate MongoDB connectivity for cloud-mode checkpointer.
        
        Performs a fast ping against the MongoDB instance configured for
        the LangGraph checkpointer.  Runs only when the checkpointer type
        is ``mongodb``; silently skips for ``memory`` and ``sqlite``.
        
        This catches authentication and network issues at startup rather
        than on the first agent execution, giving operators a clear signal
        that the mongodb-app-user-provisioning Job needs to be applied.
        """
        if self.config.checkpointer.type != "mongodb":
            return
        
        if not self.config.checkpointer.mongodb_uri:
            raise ValueError(
                "STIGMER_CHECKPOINTER_MONGODB_URI is required when "
                "checkpointer type is 'mongodb'"
            )
        
        from pymongo import MongoClient
        from pymongo.errors import ConnectionFailure, OperationFailure
        
        client: MongoClient[dict[str, object]] = MongoClient(
            self.config.checkpointer.mongodb_uri,
            serverSelectionTimeoutMS=5000,
        )
        try:
            client.admin.command("ping")
            self.logger.info(
                "✅ Connected to MongoDB for checkpointer (db=%s)",
                self.config.checkpointer.mongodb_db_name,
            )
        except ConnectionFailure as e:
            self.logger.error("❌ MongoDB unreachable for checkpointer: %s", e)
            raise RuntimeError(
                f"MongoDB unreachable for checkpointer: {e}. "
                "Check STIGMER_CHECKPOINTER_MONGODB_URI and network connectivity."
            ) from e
        except OperationFailure as e:
            self.logger.error("❌ MongoDB authentication failed for checkpointer: %s", e)
            raise RuntimeError(
                f"MongoDB authentication failed for checkpointer: {e}. "
                "Verify the stigmer-app user exists with correct roles. "
                "Run the mongodb-app-user-provisioning Job if this is a new environment."
            ) from e
        finally:
            client.close()
    
    def _initialize_snapshot_resolver(self):
        """Initialize the MCP snapshot resolver for cloud mode.

        The resolver discovers the latest active Daytona snapshot with
        pre-installed MCP servers. Requires ``DAYTONA_API_KEY``.  If the
        key is absent the resolver is not created and sandbox creation
        falls back to ``DAYTONA_DEV_TOOLS_SNAPSHOT_ID`` or no snapshot.
        """
        import os

        api_key = os.getenv("DAYTONA_API_KEY")
        if not api_key:
            self.logger.info(
                "DAYTONA_API_KEY not set — snapshot resolver not initialized"
            )
            return

        try:
            from worker.snapshot_resolver import initialize_snapshot_resolver

            initialize_snapshot_resolver(api_key)
            self.logger.info("✅ Snapshot resolver initialized")
        except Exception as e:
            self.logger.warning(
                "Snapshot resolver initialization failed (non-fatal): %s", e
            )

    async def register_activities(self):
        """Connect to Temporal and register activities.
        
        Activities registered:
        - ExecuteGraphton: Main agent execution activity
        - EnsureThread: Thread management for conversation state
        - cleanup_sandbox: Sandbox cleanup (legacy, may be removed)
        """
        # Import activities and workflows here to avoid circular imports
        from worker.activities.build_mcp_snapshot import build_mcp_snapshot
        from worker.activities.classify_tool_approvals import classify_tool_approvals
        from worker.activities.cleanup_sandbox import cleanup_sandbox
        from worker.activities.discover_mcp_server import (
            ConnectMcpServerWorkflow,
            DiscoverMcpServerWorkflow,
            discover_mcp_server,
        )
        from worker.activities.ensure_thread import ensure_thread
        from worker.activities.execute_graphton import execute_graphton
        from worker.activities.generate_session_subject import generate_session_subject
        
        # Log execution mode
        mode = "LOCAL" if self.config.is_local_mode() else "CLOUD"
        self.logger.info(f"🔧 Execution Mode: {mode}")
        self.logger.info(f"🔧 Stigmer Backend: {self.config.stigmer_backend_endpoint}")
        if self.config.is_local_mode():
            self.logger.info(f"🔧 Sandbox: {self.config.sandbox_type} (root: {self.config.sandbox_root_dir})")
        else:
            self.logger.info(f"🔧 Sandbox: {self.config.sandbox_type}")
        
        # Connect to Temporal with forward-compatible proto deserialization.
        # The custom data converter tolerates unknown protobuf fields in JSON
        # payloads, preventing hard failures when Go services add new proto
        # fields before the Python worker is redeployed with updated stubs.
        try:
            self.client = await Client.connect(
                self.config.temporal_service_address,
                namespace=self.config.temporal_namespace,
                data_converter=create_data_converter(),
            )
            self.logger.info(
                f"✅ [POLYGLOT] Connected to Temporal server at {self.config.temporal_service_address}, "
                f"namespace: {self.config.temporal_namespace}"
            )
        except Exception as e:
            self.logger.error(f"❌ Failed to connect to Temporal: {e}")
            raise
        
        # Register worker with both activities and workflows.
        # ConnectMcpServerWorkflow is the primary connect flow (discover + classify).
        # DiscoverMcpServerWorkflow is retained for in-flight backward compat.
        self.worker = Worker(
            self.client,
            task_queue=self.config.task_queue,
            workflows=[
                ConnectMcpServerWorkflow,
                DiscoverMcpServerWorkflow,
            ],
            activities=[
                build_mcp_snapshot,
                execute_graphton,
                ensure_thread,
                cleanup_sandbox,
                generate_session_subject,
                discover_mcp_server,
                classify_tool_approvals,
            ],
            max_concurrent_activities=self.config.max_concurrency,
            max_heartbeat_throttle_interval=timedelta(seconds=10),
            graceful_shutdown_timeout=timedelta(seconds=30),
        )
        
        self.logger.info(
            f"✅ [POLYGLOT] Registered Python activities on task queue: '{self.config.task_queue}'"
        )
        self.logger.info(
            "✅ [POLYGLOT] Activities: BuildMcpSnapshot, ExecuteGraphton, EnsureThread, "
            "CleanupSandbox, GenerateSessionSubject, DiscoverMcpServerCapabilities, "
            "ClassifyToolApprovals"
        )
        self.logger.info(
            f"✅ [POLYGLOT] Max concurrency: {self.config.max_concurrency}"
        )
        self.logger.info(
            "✅ [POLYGLOT] Java workflows (InvokeAgentExecutionWorkflow) handled by stigmer-service on same queue"
        )
        self.logger.info(
            "✅ [POLYGLOT] Temporal routes: workflow tasks → Java, Python activity tasks → Python"
        )
    
    async def start(self):
        """Start the heartbeat emitter and Temporal worker (blocking)."""
        if self._heartbeat is not None:
            await self._heartbeat.start()

        self.logger.info(f"Starting Temporal worker on task queue: {self.config.task_queue}")
        if self.worker:
            await self.worker.run()
    
    async def shutdown(self):
        """Shutdown the worker and close connections.

        Order matters: the heartbeat emitter sends a final STOPPED heartbeat
        before the Temporal worker drains its activities, so the server sees
        the runner go offline immediately rather than waiting for the 90s
        heartbeat timeout.
        """
        self.logger.info("Shutting down worker...")

        if self._heartbeat is not None:
            try:
                await self._heartbeat.stop()
                self.logger.info("✓ Heartbeat emitter stopped")
            except Exception as e:
                self.logger.error(f"Error stopping heartbeat emitter: {e}")
        
        if self.worker:
            try:
                await self.worker.shutdown()
                self.logger.info("✓ Worker stopped")
            except Exception as e:
                self.logger.error(f"Error stopping worker: {e}")
        
        self.logger.info("✅ Worker shutdown complete")
