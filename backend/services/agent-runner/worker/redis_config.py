"""Redis configuration and client management for agent-runner."""

import os
import redis
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class RedisConfig:
    """Redis configuration loaded from environment variables."""
    
    def __init__(
        self,
        host: str,
        port: int,
        password: Optional[str] = None,
        db: int = 0,
        socket_timeout: int = 5,
        socket_connect_timeout: int = 5,
    ):
        self.host = host
        self.port = port
        self.password = password
        self.db = db
        self.socket_timeout = socket_timeout
        self.socket_connect_timeout = socket_connect_timeout
    
    @classmethod
    def load_from_env(cls):
        """Load Redis configuration from environment variables."""
        host = os.getenv("REDIS_HOST", "localhost")
        port = int(os.getenv("REDIS_PORT", "6379"))
        password = os.getenv("REDIS_PASSWORD")  # Optional
        
        logger.info(f"Redis configuration loaded: host={host}, port={port}")
        
        return cls(
            host=host,
            port=port,
            password=password if password else None,
        )


def create_redis_client(config: RedisConfig) -> redis.Redis:
    """Create Redis client from configuration.
    
    Args:
        config: Redis configuration
        
    Returns:
        Redis client instance
        
    Raises:
        redis.ConnectionError: If connection to Redis fails
    """
    client = redis.Redis(
        host=config.host,
        port=config.port,
        password=config.password,
        db=config.db,
        decode_responses=True,  # Decode responses to strings
        socket_timeout=config.socket_timeout,
        socket_connect_timeout=config.socket_connect_timeout,
    )
    
    # Test connection
    try:
        client.ping()
        logger.info(f"Successfully connected to Redis at {config.host}:{config.port}")
    except redis.ConnectionError as e:
        logger.error(f"Failed to connect to Redis at {config.host}:{config.port}: {e}")
        raise
    
    return client
