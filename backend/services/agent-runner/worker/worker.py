"""Temporal worker for agent-runner service."""

from typing import Optional
from temporalio.client import Client
from temporalio.worker import Worker
from .config import Config
from .token_manager import set_api_key
import logging

class AgentRunner:
    """Temporal worker that executes Graphton agent activities."""
    
    def __init__(self, config: Config):
        self.config = config
        self.client: Optional[Client] = None
        self.worker: Optional[Worker] = None
        self.logger = logging.getLogger(__name__)
        
        # Set global API key for activities
        set_api_key(config.stigmer_api_key)
        self.logger.info("Configured Stigmer API authentication")
    
    async def register_activities(self):
        """Connect to Temporal and register activities.
        
        Activities registered:
        - ExecuteGraphton: Main agent execution activity
        - EnsureThread: Thread management for conversation state
        - cleanup_sandbox: Sandbox cleanup (legacy, may be removed)
        """
        # Import activities here to avoid circular imports
        from worker.activities.execute_graphton import execute_graphton
        from worker.activities.ensure_thread import ensure_thread
        from worker.activities.cleanup_sandbox import cleanup_sandbox
        
        self.client = await Client.connect(
            self.config.temporal_service_address,
            namespace=self.config.temporal_namespace,
        )
        
        self.logger.info(
            f"✅ [POLYGLOT] Connected to Temporal server at {self.config.temporal_service_address}, "
            f"namespace: {self.config.temporal_namespace}"
        )
        
        self.worker = Worker(
            self.client,
            task_queue=self.config.task_queue,
            activities=[
                execute_graphton,
                ensure_thread,
                cleanup_sandbox,
            ],
            max_concurrent_activities=self.config.max_concurrency,
        )
        
        self.logger.info(
            f"✅ [POLYGLOT] Registered Python activities on task queue: '{self.config.task_queue}'"
        )
        self.logger.info(
            f"✅ [POLYGLOT] Activities: ExecuteGraphton, EnsureThread, CleanupSandbox"
        )
        self.logger.info(
            f"✅ [POLYGLOT] Max concurrency: {self.config.max_concurrency}"
        )
        self.logger.info(
            f"✅ [POLYGLOT] Java workflows (InvokeAgentExecutionWorkflow) handled by stigmer-service on same queue"
        )
        self.logger.info(
            f"✅ [POLYGLOT] Temporal routes: workflow tasks → Java, Python activity tasks → Python"
        )
    
    async def start(self):
        """Start the Temporal worker (blocking)."""
        self.logger.info(f"Starting Temporal worker on task queue: {self.config.task_queue}")
        if self.worker:
            await self.worker.run()
