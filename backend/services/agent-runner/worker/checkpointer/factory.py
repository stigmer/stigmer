"""Checkpointer factory for mode-aware LangGraph state persistence.

This module provides a factory function that creates the appropriate
checkpointer based on configuration, enabling:
1. HITL (Human-in-the-Loop) approval flow - interrupt/resume execution
2. Conversational context preservation - multi-turn conversations

Design Principles:
-----------------
1. Mode-aware defaults - sensible defaults for local vs cloud
2. Lazy imports - optional dependencies loaded only when needed
3. Graceful degradation - clear error messages, fallback options
4. Production-ready - handles connection failures, timeouts
5. Proper resource lifecycle - async context manager ensures cleanup
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from langgraph.checkpoint.memory import MemorySaver

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

    from worker.config import CheckpointerConfig

logger = logging.getLogger(__name__)


class CheckpointerCreationError(Exception):
    """Raised when checkpointer creation fails.
    
    This exception provides context about what went wrong during
    checkpointer initialization, including the checkpointer type
    and the underlying cause.
    
    Attributes:
        checkpointer_type: The type of checkpointer that failed to create
        message: Human-readable error description
        cause: The underlying exception that caused the failure
    """
    
    def __init__(
        self,
        checkpointer_type: str,
        message: str,
        cause: Exception | None = None,
    ):
        self.checkpointer_type = checkpointer_type
        self.cause = cause
        full_message = f"Failed to create {checkpointer_type} checkpointer: {message}"
        super().__init__(full_message)


@asynccontextmanager
async def create_checkpointer(
    config: CheckpointerConfig,
) -> AsyncIterator[BaseCheckpointSaver]:
    """Create a checkpointer based on configuration.
    
    Async context manager factory for mode-aware checkpointer instantiation.
    Creates the appropriate checkpointer type based on configuration, with
    proper error handling, logging, and resource lifecycle management.
    
    The context manager pattern ensures that underlying resources (SQLite
    connections, MongoDB clients) are properly cleaned up when the checkpointer
    is no longer needed, preventing resource leaks in long-running workers.
    
    Checkpointer Types:
    ------------------
    - memory: In-memory storage using MemorySaver
      - Ephemeral (data lost on restart)
      - Fast, zero setup required
      - Best for: local development, testing
      
    - sqlite: File-based storage using AsyncSqliteSaver
      - Persistent across restarts
      - Single-instance only (file locking)
      - Best for: open source, local persistence
      
    - mongodb: Database storage using MongoDBSaver
      - Persistent across restarts
      - Multi-instance safe (shared state)
      - Best for: cloud deployments, horizontal scaling
    
    Args:
        config: CheckpointerConfig instance with type and connection details
        
    Yields:
        A BaseCheckpointSaver instance ready for use with LangGraph
        
    Raises:
        CheckpointerCreationError: If checkpointer creation fails
        ValueError: If checkpointer type is invalid
        
    Example:
        >>> from worker.config import CheckpointerConfig
        >>> config = CheckpointerConfig(type="sqlite", sqlite_path="./checkpoints/lg.db")
        >>> async with create_checkpointer(config) as checkpointer:
        ...     agent = create_deep_agent(..., checkpointer=checkpointer)
        ...     # checkpointer is valid for the lifetime of this block
    
    """
    logger.info(f"Creating checkpointer: type={config.type}")
    
    if config.type == "memory":
        yield _create_memory_checkpointer()
    
    elif config.type == "sqlite":
        async with _sqlite_checkpointer(config) as saver:
            yield saver
    
    elif config.type == "mongodb":
        async with _mongodb_checkpointer(config) as saver:
            yield saver
    
    elif config.type == "http":
        saver = _create_http_checkpointer(config)
        try:
            yield saver
        finally:
            await saver.aclose()
    
    else:
        raise ValueError(
            f"Unknown checkpointer type: {config.type}. "
            f"Valid types are: memory, sqlite, mongodb, http"
        )


def _create_memory_checkpointer() -> MemorySaver:
    """Create in-memory checkpointer.
    
    MemorySaver stores state in memory - fast but ephemeral.
    Data is lost when the process restarts.
    
    Returns:
        MemorySaver instance
    """
    logger.info("Created MemorySaver checkpointer (ephemeral, in-memory)")
    return MemorySaver()


@asynccontextmanager
async def _sqlite_checkpointer(
    config: CheckpointerConfig,
) -> AsyncIterator[BaseCheckpointSaver]:
    """Create and manage SQLite-based checkpointer lifecycle.
    
    AsyncSqliteSaver stores state in a SQLite database file.
    Persistent but single-instance only due to file locking.
    
    AsyncSqliteSaver.from_conn_string() is an async context manager that
    opens the aiosqlite connection, creates the saver, runs setup() to
    initialize the schema, and yields the saver. The connection is closed
    when the context exits.
    
    Args:
        config: CheckpointerConfig with sqlite_path
        
    Yields:
        AsyncSqliteSaver instance with an active database connection
        
    Raises:
        CheckpointerCreationError: If SQLite setup fails
    """
    try:
        # Lazy import to avoid requiring sqlite dependency when not used
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    except ImportError as e:
        raise CheckpointerCreationError(
            checkpointer_type="sqlite",
            message=(
                "langgraph-checkpoint-sqlite package not installed. "
                "Install with: pip install langgraph-checkpoint-sqlite"
            ),
            cause=e,
        ) from e
    
    if not config.sqlite_path:
        raise CheckpointerCreationError(
            checkpointer_type="sqlite",
            message="sqlite_path is required for SQLite checkpointer",
        )
    
    try:
        # Ensure parent directory exists
        import os
        parent_dir = os.path.dirname(config.sqlite_path)
        if parent_dir and not os.path.exists(parent_dir):
            os.makedirs(parent_dir, exist_ok=True)
            logger.info(f"Created directory for SQLite database: {parent_dir}")
        
        # from_conn_string() is an @asynccontextmanager that opens the
        # aiosqlite connection, creates the saver, runs setup(), and
        # yields the ready-to-use AsyncSqliteSaver instance.
        async with AsyncSqliteSaver.from_conn_string(config.sqlite_path) as saver:
            logger.info(
                f"Created AsyncSqliteSaver checkpointer "
                f"(persistent, file={config.sqlite_path})"
            )
            yield saver
        
        logger.debug(f"AsyncSqliteSaver connection closed (file={config.sqlite_path})")
        
    except CheckpointerCreationError:
        raise
    except Exception as e:
        raise CheckpointerCreationError(
            checkpointer_type="sqlite",
            message=f"Failed to initialize SQLite database at {config.sqlite_path}",
            cause=e,
        ) from e


@asynccontextmanager
async def _mongodb_checkpointer(
    config: CheckpointerConfig,
) -> AsyncIterator[BaseCheckpointSaver]:
    """Create and manage MongoDB-based checkpointer lifecycle.
    
    MongoDBSaver stores state in MongoDB. Persistent and multi-instance
    safe, suitable for cloud deployments with horizontal scaling.
    
    MongoDBSaver uses pymongo (sync driver) internally and provides async
    methods via run_in_executor. The pymongo MongoClient is created on
    entry and closed on exit, preventing connection leaks in long-running
    Temporal workers.
    
    Args:
        config: CheckpointerConfig with mongodb_uri and mongodb_db_name
        
    Yields:
        MongoDBSaver instance with an active MongoDB connection
        
    Raises:
        CheckpointerCreationError: If MongoDB connection fails
    """
    try:
        from langgraph.checkpoint.mongodb import MongoDBSaver
    except ImportError as e:
        raise CheckpointerCreationError(
            checkpointer_type="mongodb",
            message=(
                "langgraph-checkpoint-mongodb package not installed. "
                "Install with: pip install langgraph-checkpoint-mongodb"
            ),
            cause=e,
        ) from e
    
    if not config.mongodb_uri:
        raise CheckpointerCreationError(
            checkpointer_type="mongodb",
            message="mongodb_uri is required for MongoDB checkpointer",
        )
    
    try:
        from pymongo import MongoClient
        
        client: Any = MongoClient(config.mongodb_uri)
        
        try:
            checkpointer = MongoDBSaver(
                client,
                db_name=config.mongodb_db_name,
                ttl=config.mongodb_ttl_seconds,
            )
            
            masked_uri = _mask_mongodb_uri(config.mongodb_uri)
            ttl_info = f", ttl={config.mongodb_ttl_seconds}s" if config.mongodb_ttl_seconds else ""
            
            logger.info(
                f"Created MongoDBSaver checkpointer "
                f"(persistent, db={config.mongodb_db_name}, uri={masked_uri}{ttl_info})"
            )
            yield checkpointer
        finally:
            client.close()
            logger.debug("MongoDB client closed")
        
    except CheckpointerCreationError:
        raise
    except Exception as e:
        raise CheckpointerCreationError(
            checkpointer_type="mongodb",
            message=f"Failed to connect to MongoDB at {_mask_mongodb_uri(config.mongodb_uri)}",
            cause=e,
        ) from e


def _create_http_checkpointer(config: CheckpointerConfig) -> Any:
    """Create HTTP-backed checkpointer that routes through the proxy.

    Requires ``proxy_endpoint`` and ``auth_token`` on the config.

    Returns:
        HttpCheckpointSaver instance
    """
    from worker.checkpointer.http_saver import HttpCheckpointSaver

    if not config.proxy_endpoint:
        raise CheckpointerCreationError(
            checkpointer_type="http",
            message="proxy_endpoint is required for HTTP checkpointer",
        )
    if not config.auth_token:
        raise CheckpointerCreationError(
            checkpointer_type="http",
            message="auth_token is required for HTTP checkpointer",
        )

    saver = HttpCheckpointSaver(
        proxy_endpoint=config.proxy_endpoint,
        auth_token=config.auth_token,
    )
    logger.info(
        "Created HttpCheckpointSaver checkpointer "
        f"(proxy={config.proxy_endpoint})"
    )
    return saver


def _mask_mongodb_uri(uri: str) -> str:
    """Mask sensitive parts of MongoDB URI for logging.
    
    Replaces password in URI with asterisks for safe logging.
    
    Args:
        uri: MongoDB connection string
        
    Returns:
        URI with password masked
        
    Example:
        >>> _mask_mongodb_uri("mongodb://user:secret@host:27017/db")
        'mongodb://user:****@host:27017/db'
    """
    import re
    
    # Pattern matches: protocol://user:password@host
    # Captures: protocol://user: and @host...
    pattern = r"(mongodb(?:\+srv)?://[^:]+:)([^@]+)(@.+)"
    
    match = re.match(pattern, uri)
    if match:
        return f"{match.group(1)}****{match.group(3)}"
    
    # If pattern doesn't match, return as-is (might not have credentials)
    return uri
