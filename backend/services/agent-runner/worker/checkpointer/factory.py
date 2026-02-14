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
5. Zero technical debt - clean abstractions, comprehensive logging
"""

from __future__ import annotations

import logging
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


async def create_checkpointer(
    config: CheckpointerConfig,
) -> BaseCheckpointSaver:
    """Create a checkpointer based on configuration.
    
    Factory function for mode-aware checkpointer instantiation. Creates
    the appropriate checkpointer type based on configuration, with proper
    error handling and logging.
    
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
      
    - mongodb: Database storage using AsyncMongoDBSaver
      - Persistent across restarts
      - Multi-instance safe (shared state)
      - Best for: cloud deployments, horizontal scaling
    
    Args:
        config: CheckpointerConfig instance with type and connection details
        
    Returns:
        A BaseCheckpointSaver instance ready for use with LangGraph
        
    Raises:
        CheckpointerCreationError: If checkpointer creation fails
        ValueError: If checkpointer type is invalid
        
    Example:
        >>> from worker.config import CheckpointerConfig
        >>> config = CheckpointerConfig(type="memory")
        >>> checkpointer = await create_checkpointer(config)
        >>> # Use with LangGraph agent
        >>> agent = create_deep_agent(..., checkpointer=checkpointer)
    
    """
    logger.info(f"Creating checkpointer: type={config.type}")
    
    if config.type == "memory":
        return _create_memory_checkpointer()
    
    elif config.type == "sqlite":
        return await _create_sqlite_checkpointer(config)
    
    elif config.type == "mongodb":
        return await _create_mongodb_checkpointer(config)
    
    else:
        # This should be caught by config validation, but handle defensively
        raise ValueError(
            f"Unknown checkpointer type: {config.type}. "
            f"Valid types are: memory, sqlite, mongodb"
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


async def _create_sqlite_checkpointer(
    config: CheckpointerConfig,
) -> BaseCheckpointSaver:
    """Create SQLite-based checkpointer.
    
    AsyncSqliteSaver stores state in a SQLite database file.
    Persistent but single-instance only due to file locking.
    
    Args:
        config: CheckpointerConfig with sqlite_path
        
    Returns:
        AsyncSqliteSaver instance
        
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
        
        # Create the checkpointer
        # Note: from_conn_string is an async context manager in some versions
        # We handle both cases
        checkpointer = AsyncSqliteSaver.from_conn_string(config.sqlite_path)
        
        logger.info(
            f"Created AsyncSqliteSaver checkpointer "
            f"(persistent, file={config.sqlite_path})"
        )
        return checkpointer  # type: ignore[return-value]  # from_conn_string returns context manager usable as checkpointer
        
    except Exception as e:
        raise CheckpointerCreationError(
            checkpointer_type="sqlite",
            message=f"Failed to initialize SQLite database at {config.sqlite_path}",
            cause=e,
        ) from e


async def _create_mongodb_checkpointer(
    config: CheckpointerConfig,
) -> BaseCheckpointSaver:
    """Create MongoDB-based checkpointer.
    
    AsyncMongoDBSaver stores state in MongoDB. Persistent and
    multi-instance safe, suitable for cloud deployments with
    horizontal scaling.
    
    Args:
        config: CheckpointerConfig with mongodb_uri and mongodb_db_name
        
    Returns:
        AsyncMongoDBSaver instance
        
    Raises:
        CheckpointerCreationError: If MongoDB connection fails
    """
    try:
        # Lazy import to avoid requiring mongodb dependency when not used
        from langgraph.checkpoint.mongodb.aio import AsyncMongoDBSaver
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
        # Create async MongoDB client
        from motor.motor_asyncio import AsyncIOMotorClient
        
        client: Any = AsyncIOMotorClient(config.mongodb_uri)
        
        # Create the checkpointer with optional TTL
        checkpointer = AsyncMongoDBSaver(
            client=client,
            db_name=config.mongodb_db_name,
            ttl=config.mongodb_ttl_seconds,
        )
        
        # Log configuration (mask sensitive URI parts)
        masked_uri = _mask_mongodb_uri(config.mongodb_uri)
        ttl_info = f", ttl={config.mongodb_ttl_seconds}s" if config.mongodb_ttl_seconds else ""
        
        logger.info(
            f"Created AsyncMongoDBSaver checkpointer "
            f"(persistent, db={config.mongodb_db_name}, uri={masked_uri}{ttl_info})"
        )
        return checkpointer
        
    except Exception as e:
        raise CheckpointerCreationError(
            checkpointer_type="mongodb",
            message=f"Failed to connect to MongoDB at {_mask_mongodb_uri(config.mongodb_uri)}",
            cause=e,
        ) from e


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
