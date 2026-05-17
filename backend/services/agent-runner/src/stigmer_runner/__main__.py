"""Entry point for stigmer-runner.

Supports both ``python -m stigmer_runner`` and the ``stigmer-runner``
console script installed by pip.
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from stigmer_runner.worker.config import Config
from stigmer_runner.worker.logging_config import setup_logging
from stigmer_runner.worker.otel import init_tracing
from stigmer_runner.worker.worker import Runner


def _load_env_file() -> None:
    """Load environment variables from .env file if it exists.

    Follows the same pattern as stigmer-service (Spring Boot's optional
    .env loading).  In production (Kubernetes), environment variables
    come from ConfigMaps/Secrets, not .env files.
    """
    for candidate in (Path(".env"), Path(__file__).parent / ".env"):
        if candidate.exists():
            load_dotenv(candidate)
            return


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


shutdown_requested = False
logger = logging.getLogger(__name__)


async def _shutdown_handler(worker: Runner) -> None:
    """Gracefully shutdown worker on SIGTERM/SIGINT."""
    global shutdown_requested

    if shutdown_requested:
        logger.warning("Shutdown already in progress, ignoring duplicate signal")
        return

    shutdown_requested = True
    logger.info("Received shutdown signal, stopping worker gracefully...")

    loop = asyncio.get_running_loop()
    original_handler = loop.get_exception_handler()
    loop.set_exception_handler(_make_shutdown_exception_handler(original_handler))

    try:
        await worker.shutdown()
        logger.info("Graceful shutdown complete")
    except Exception as e:
        logger.error(f"Error during graceful shutdown: {e}", exc_info=True)
        sys.exit(1)


async def _run() -> None:
    """Async main loop: load config, start worker, handle signals."""
    try:
        config = Config.load_from_env()
    except Exception as e:
        logger.error(f"Failed to load configuration: {e}", exc_info=True)
        sys.exit(1)

    mode = "LOCAL" if config.is_local_mode() else "CLOUD"
    logger.info("=" * 60)
    logger.info(f"Stigmer Agent Runner - {mode} Mode")
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

    otel_shutdown = init_tracing("agent-runner")

    try:
        worker = Runner(config)
    except Exception as e:
        logger.error(f"Failed to initialize worker: {e}", exc_info=True)
        sys.exit(1)

    try:
        logger.info("Registering activities and connecting to Temporal...")
        await worker.register_activities()
        logger.info("Activities registered successfully")

        loop = asyncio.get_running_loop()

        def signal_callback() -> None:
            asyncio.create_task(_shutdown_handler(worker))

        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, signal_callback)

        logger.info("Signal handlers registered (SIGTERM, SIGINT)")
        logger.info("Worker ready, polling for tasks...")

        await worker.start()

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"Fatal error in worker: {e}", exc_info=True)
        sys.exit(1)
    finally:
        if otel_shutdown is not None:
            otel_shutdown()
        logger.info("Worker process exiting")


def main() -> None:
    """Synchronous entry point for the ``stigmer-runner`` console script."""
    _load_env_file()
    setup_logging()
    asyncio.run(_run())


if __name__ == "__main__":
    main()
