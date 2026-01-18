"""Entry point for agent-runner service."""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from dotenv import load_dotenv
from worker.worker import AgentRunner
from worker.config import Config
from worker.logging_config import setup_logging

# Load .env file for local development (optional - fails silently in production)
# This follows the same pattern as stigmer-service (Spring Boot's optional .env loading).
# The .env file is included via Poetry/Bazel for local development.
# In production (Kubernetes), environment variables come from ConfigMaps/Secrets, not .env files.
def load_env_file():
    """Load environment variables from .env file if it exists."""
    # Try current directory first
    env_path = Path(".env")
    if env_path.exists():
        load_dotenv(env_path)
        return
    
    # Try relative to this file
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        return
    
    # No .env file found - this is expected in production
    # Environment variables will come from Kubernetes ConfigMaps/Secrets

load_env_file()

# Configure logging
setup_logging()
logger = logging.getLogger(__name__)

# Global flag for shutdown coordination
shutdown_requested = False


async def shutdown_handler(worker: AgentRunner):
    """Gracefully shutdown worker on SIGTERM/SIGINT."""
    global shutdown_requested
    
    if shutdown_requested:
        logger.warning("Shutdown already in progress, ignoring duplicate signal")
        return
    
    shutdown_requested = True
    logger.info("🛑 Received shutdown signal, stopping worker gracefully...")
    
    try:
        # Stop accepting new tasks and wait for in-flight activities to complete
        logger.info("Stopping worker (waiting for in-flight activities)...")
        if worker.worker:
            await worker.worker.shutdown()
            logger.info("✓ Worker stopped successfully")
        
        # Cancel token rotation background task
        if worker.rotation_task and not worker.rotation_task.done():
            logger.info("Canceling token rotation task...")
            worker.rotation_task.cancel()
            try:
                await worker.rotation_task
            except asyncio.CancelledError:
                logger.info("✓ Token rotation task canceled")
        
        logger.info("✅ Graceful shutdown complete")
        
    except Exception as e:
        logger.error(f"Error during graceful shutdown: {e}", exc_info=True)
        sys.exit(1)


async def main():
    """Main entry point."""
    config = Config.load_from_env()
    logger.info(f"Starting Agent Runner (task queue: {config.task_queue})")
    
    worker = AgentRunner(config)
    
    try:
        # Register activities and connect to Temporal
        await worker.register_activities()
        
        # Setup signal handlers for graceful shutdown
        loop = asyncio.get_running_loop()
        
        def signal_callback():
            """Signal handler callback (runs in main thread)."""
            asyncio.create_task(shutdown_handler(worker))
        
        # Register handlers for SIGTERM (Kubernetes) and SIGINT (Ctrl+C)
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, signal_callback)
        
        logger.info("✓ Signal handlers registered (SIGTERM, SIGINT)")
        logger.info("🚀 Worker ready, polling for tasks...")
        
        # Run worker until shutdown
        await worker.start()
        
    except Exception as e:
        logger.error(f"Fatal error in worker: {e}", exc_info=True)
        sys.exit(1)
    finally:
        logger.info("Worker process exiting")


if __name__ == "__main__":
    asyncio.run(main())
