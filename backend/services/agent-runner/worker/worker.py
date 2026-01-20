"""Temporal worker for agent-runner service."""

from typing import Optional
from temporalio.client import Client
from temporalio.worker import Worker
from .config import Config
from .token_manager import set_api_key
from .redis_config import RedisConfig, create_redis_client
import logging
import redis

class AgentRunner:
    """Temporal worker that executes Graphton agent activities."""
    
    def __init__(self, config: Config):
        self.config = config
        self.client: Optional[Client] = None
        self.worker: Optional[Worker] = None
        self.redis_client: Optional[redis.Redis] = None
        self.logger = logging.getLogger(__name__)
        
        # Set global API key for activities
        set_api_key(config.stigmer_api_key)
        self.logger.info("Configured Stigmer API authentication")
        
        # Initialize Redis in cloud mode
        if not config.is_local_mode():
            self._initialize_redis()
        else:
            self.logger.info("Local mode: Skipping Redis initialization (using gRPC to Stigmer Daemon)")
    
    def _initialize_redis(self):
        """Initialize Redis connection for cloud mode."""
        try:
            # Validate Redis config (should not be None in cloud mode)
            if self.config.redis_host is None or self.config.redis_port is None:
                raise ValueError(
                    "Redis host and port are required in cloud mode. "
                    "Set REDIS_HOST and REDIS_PORT environment variables."
                )
            
            redis_config = RedisConfig(
                host=self.config.redis_host,
                port=self.config.redis_port,
                password=self.config.redis_password,
            )
            self.redis_client = create_redis_client(redis_config)
            self.logger.info(f"✅ Connected to Redis at {self.config.redis_host}:{self.config.redis_port}")
        except redis.ConnectionError as e:
            self.logger.error(f"❌ Failed to connect to Redis: {e}")
            raise
        except Exception as e:
            self.logger.error(f"❌ Error initializing Redis: {e}")
            raise
    
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
        
        # Log execution mode
        mode = "LOCAL" if self.config.is_local_mode() else "CLOUD"
        self.logger.info(f"🔧 Execution Mode: {mode}")
        self.logger.info(f"🔧 Stigmer Backend: {self.config.stigmer_backend_endpoint}")
        if self.config.is_local_mode():
            self.logger.info(f"🔧 Sandbox: {self.config.sandbox_type} (root: {self.config.sandbox_root_dir})")
        else:
            self.logger.info(f"🔧 Sandbox: {self.config.sandbox_type}")
            self.logger.info(f"🔧 Redis: {self.config.redis_host}:{self.config.redis_port}")
        
        # Connect to Temporal
        try:
            self.client = await Client.connect(
                self.config.temporal_service_address,
                namespace=self.config.temporal_namespace,
            )
            self.logger.info(
                f"✅ [POLYGLOT] Connected to Temporal server at {self.config.temporal_service_address}, "
                f"namespace: {self.config.temporal_namespace}"
            )
        except Exception as e:
            self.logger.error(f"❌ Failed to connect to Temporal: {e}")
            raise
        
        # Register worker
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
    
    async def shutdown(self):
        """Shutdown the worker and close connections."""
        self.logger.info("Shutting down worker...")
        
        # Stop worker
        if self.worker:
            try:
                await self.worker.shutdown()
                self.logger.info("✓ Worker stopped")
            except Exception as e:
                self.logger.error(f"Error stopping worker: {e}")
        
        # Close Redis connection (cloud mode only)
        if self.redis_client:
            try:
                self.redis_client.close()
                self.logger.info("✓ Redis connection closed")
            except Exception as e:
                self.logger.error(f"Error closing Redis connection: {e}")
        
        self.logger.info("✅ Worker shutdown complete")
