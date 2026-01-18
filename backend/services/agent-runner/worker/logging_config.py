"""Logging configuration for agent-runner service."""

import logging
import os


def setup_logging() -> None:
    """
    Configure logging for the agent-runner service.
    
    Sets global logging level (default: INFO) and suppresses noisy third-party libraries.
    Use LOG_LEVEL environment variable to override (DEBUG, INFO, WARNING, ERROR).
    """
    # Configure global logging level (default: INFO)
    log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)
    
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Suppress DEBUG logs from third-party libraries (they don't respect root logger level)
    # Only show WARNING and above for infrastructure noise
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("grpc").setLevel(logging.WARNING)
    logging.getLogger("grpc._cython.cygrpc").setLevel(logging.WARNING)
    
    # Suppress DEBUG logs from libraries that create their own loggers
    # Show INFO and above for these (useful operational logs, no debug noise)
    logging.getLogger("anthropic").setLevel(logging.INFO)
    logging.getLogger("anthropic._base_client").setLevel(logging.INFO)
    logging.getLogger("temporalio").setLevel(logging.INFO)
    logging.getLogger("temporalio.worker._activity").setLevel(logging.INFO)
    logging.getLogger("temporalio.activity").setLevel(logging.INFO)
    logging.getLogger("graphton").setLevel(logging.INFO)
    logging.getLogger("graphton.core.loop_detection").setLevel(logging.INFO)
    logging.getLogger("grpc_client.auth.token_manager").setLevel(logging.INFO)
