"""Entry point for agent-runner service."""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from worker.config import Config
from worker.logging_config import setup_logging
from worker.worker import Runner


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


def _make_shutdown_exception_handler(
    original_handler: Any,
) -> Any:
    """Build an event-loop exception handler that suppresses expected MCP
    async-generator cleanup errors during shutdown.

    When the Temporal worker shuts down, in-flight MCP stdio sessions may
    not have been explicitly closed (the LangGraph ``aafter_agent`` hook
    is skipped on cancellation).  Python's event-loop finalizer then
    calls ``aclose()`` on these async generators from a different task
    than the one that entered the anyio cancel scope, triggering
    ``RuntimeError: Attempted to exit cancel scope in a different task``.
    This is a known anyio limitation (MCP SDK #577) and is harmless
    during shutdown — suppress it to keep logs clean.
    """
    def handler(loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        message = context.get("message", "")
        if "closing of asynchronous generator" in message:
            logger.debug(
                "Suppressed expected MCP async generator cleanup error during shutdown"
            )
            return
        if original_handler is not None:
            original_handler(loop, context)
        else:
            loop.default_exception_handler(context)
    return handler


async def shutdown_handler(worker: Runner):
    """Gracefully shutdown worker on SIGTERM/SIGINT."""
    global shutdown_requested
    
    if shutdown_requested:
        logger.warning("Shutdown already in progress, ignoring duplicate signal")
        return
    
    shutdown_requested = True
    logger.info("🛑 Received shutdown signal, stopping worker gracefully...")

    # Swap the event-loop exception handler to suppress expected MCP async
    # generator cleanup errors that fire after the worker stops.
    loop = asyncio.get_running_loop()
    original_handler = loop.get_exception_handler()
    loop.set_exception_handler(_make_shutdown_exception_handler(original_handler))
    
    try:
        # Shutdown worker (stops accepting tasks, waits for in-flight activities, closes connections)
        await worker.shutdown()
        logger.info("✅ Graceful shutdown complete")
        
    except Exception as e:
        logger.error(f"Error during graceful shutdown: {e}", exc_info=True)
        sys.exit(1)


async def main():
    """Main entry point."""
    try:
        config = Config.load_from_env()
    except Exception as e:
        logger.error(f"❌ Failed to load configuration: {e}", exc_info=True)
        logger.error("=" * 80)
        logger.error("STARTUP FAILURE: Configuration Error")
        logger.error("=" * 80)
        logger.error(f"Error: {e}")
        logger.error("This error will prevent the worker from processing any activities.")
        logger.error("=" * 80)
        sys.exit(1)
    
    # Log startup banner
    mode = "LOCAL" if config.is_local_mode() else "CLOUD"
    logger.info("=" * 60)
    logger.info(f"🚀 Stigmer Agent Runner - {mode} Mode")
    logger.info("=" * 60)
    logger.info(f"Task Queue: {config.task_queue}")
    logger.info(f"Temporal: {config.temporal_service_address} (namespace: {config.temporal_namespace})")
    logger.info(f"Backend: {config.stigmer_backend_endpoint}")
    
    if config.is_local_mode():
        logger.info(f"Execution mode: {config.execution_mode.value}")
        logger.info(f"Workspace root: {config.workspace_root_dir}")
        logger.info("Note: Using local defaults for development mode")
    else:
        logger.info(f"Execution mode: {config.execution_mode.value}")
        logger.info(f"Workspace root: {config.workspace_root_dir}")
        if config.stigmer_proxy_endpoint:
            logger.info(f"Proxy: {config.stigmer_proxy_endpoint}")
    
    logger.info("=" * 60)
    
    # Initialize worker
    try:
        worker = Runner(config)
    except Exception as e:
        logger.error(f"❌ Failed to initialize worker: {e}", exc_info=True)
        logger.error("=" * 80)
        logger.error("STARTUP FAILURE: Worker Initialization Error")
        logger.error("=" * 80)
        logger.error(f"Error: {e}")
        logger.error("Common causes:")
        logger.error("  - Redis connection failure (in cloud mode)")
        logger.error("  - Invalid configuration values")
        logger.error("  - Missing required environment variables")
        logger.error("This error will prevent the worker from processing any activities.")
        logger.error("=" * 80)
        sys.exit(1)
    
    try:
        # Register activities and connect to Temporal
        logger.info("Registering activities and connecting to Temporal...")
        await worker.register_activities()
        logger.info("✅ Activities registered successfully")
        
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
        
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"❌ Fatal error in worker: {e}", exc_info=True)
        logger.error("=" * 80)
        logger.error("STARTUP FAILURE: Activity Registration Error")
        logger.error("=" * 80)
        logger.error(f"Error: {e}")
        logger.error("Common causes:")
        logger.error("  - Missing Python dependencies (import errors)")
        logger.error("  - Temporal connection failure")
        logger.error("  - Activity implementation errors")
        logger.error("This error will prevent the worker from processing any activities.")
        logger.error("Check the stack trace above for the exact import or initialization error.")
        logger.error("=" * 80)
        sys.exit(1)
    finally:
        logger.info("Worker process exiting")


if __name__ == "__main__":
    asyncio.run(main())
