"""Temporal worker for agent-runner service."""

import logging
from datetime import timedelta

from temporalio.client import Client
from temporalio.worker import Worker

from .auth import configure as configure_auth
from .config import Config
from .idle_watchdog import IdleWatchdog
from .temporal_converter import create_data_converter


class Runner:
    """Temporal worker that executes Graphton agent activities."""
    
    def __init__(self, config: Config):
        self.config = config
        self.client: Client | None = None
        self.worker: Worker | None = None
        self._idle_watchdog: IdleWatchdog | None = None
        self.logger = logging.getLogger(__name__)
        
        configure_auth(config.stigmer_token)
        self.logger.info("Configured Stigmer auth token")

        if config.idle_timeout_seconds:
            self._idle_watchdog = IdleWatchdog(
                timeout_seconds=config.idle_timeout_seconds,
            )
        
        if not config.is_local_mode():
            self._validate_mongodb_connectivity()
    
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
    
    async def register_activities(self):
        """Connect to Temporal and register activities.
        
        Activities registered:
        - ExecuteGraphton: Main agent execution activity
        - EnsureThread: Thread management for conversation state
        - cleanup_sandbox: Sandbox cleanup (legacy, may be removed)
        """
        from stigmer_runner.worker.activities.classify_tool_approvals import classify_tool_approvals
        from stigmer_runner.worker.activities.discover_mcp_server import (
            ConnectMcpServerWorkflow,
            DiscoverMcpServerWorkflow,
            discover_mcp_server,
        )
        from stigmer_runner.worker.activities.ensure_thread import ensure_thread
        from stigmer_runner.worker.activities.execute_graphton import execute_graphton
        from stigmer_runner.worker.activities.generate_session_subject import (
            generate_session_subject,
        )
        
        mode = "LOCAL" if self.config.is_local_mode() else "CLOUD"
        self.logger.info(f"🔧 Execution Mode: {mode}")
        self.logger.info(f"🔧 Stigmer Backend: {self.config.stigmer_backend_endpoint}")
        self.logger.info(f"🔧 Workspace: {self.config.workspace_root_dir}")
        
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
                execute_graphton,
                ensure_thread,
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
            "✅ [POLYGLOT] Activities: ExecuteGraphton, EnsureThread, "
            "GenerateSessionSubject, DiscoverMcpServerCapabilities, "
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
        """Start the idle watchdog and Temporal worker (blocking)."""
        if self._idle_watchdog is not None:
            await self._idle_watchdog.start()

        self.logger.info(f"Starting Temporal worker on task queue: {self.config.task_queue}")
        if self.worker:
            await self.worker.run()
    
    async def shutdown(self):
        """Shutdown the worker and close connections.

        Order matters:
        1. Idle watchdog stops first (prevent re-trigger during drain)
        2. Temporal worker drains in-flight activities and exits
        """
        self.logger.info("Shutting down worker...")

        if self._idle_watchdog is not None:
            try:
                await self._idle_watchdog.stop()
                self.logger.info("✓ Idle watchdog stopped")
            except Exception as e:
                self.logger.error(f"Error stopping idle watchdog: {e}")
        
        if self.worker:
            try:
                await self.worker.shutdown()
                self.logger.info("✓ Worker stopped")
            except Exception as e:
                self.logger.error(f"Error stopping worker: {e}")
        
        self.logger.info("✅ Worker shutdown complete")
