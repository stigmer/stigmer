"""gRPC retry logic with exponential backoff and intelligent error classification.

This module provides production-grade retry functionality for gRPC operations,
ensuring reliable communication with backend services. It addresses transient
failures (network issues, service restarts) while failing fast on permanent
errors (invalid arguments, authentication failures).

Key features:
- Exponential backoff with configurable parameters
- gRPC status code classification (retryable vs non-retryable)
- Environment variable configuration
- Structured logging for observability
- Type-safe generic executor

Problems this solves:
- Transient network failures causing data loss
- Service restarts during long-running operations
- Rate limiting without proper backoff
- Unclear error handling for different failure modes

Usage:
    from stigmer_runner.worker.resilience import GrpcRetryExecutor, RetryConfig
    
    executor = GrpcRetryExecutor(RetryConfig.load_from_env())
    
    try:
        result = await executor.execute(
            operation=lambda: client.update_status(id, status),
            operation_name="final_status_update",
            context={"execution_id": id}
        )
    except GrpcRetryExhaustedError as e:
        logger.error(f"All retries exhausted: {e}")
    except GrpcNonRetryableError as e:
        logger.error(f"Permanent failure: {e}")
"""

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import grpc

logger = logging.getLogger(__name__)


# =============================================================================
# gRPC Status Code Classification
# =============================================================================

# Retryable: Transient network/server issues that may succeed on retry
RETRYABLE_STATUS_CODES: frozenset[grpc.StatusCode] = frozenset([
    grpc.StatusCode.UNAVAILABLE,        # Service temporarily unavailable
    grpc.StatusCode.DEADLINE_EXCEEDED,  # Timeout - may succeed with retry
    grpc.StatusCode.ABORTED,            # Operation aborted (retry may succeed)
    grpc.StatusCode.RESOURCE_EXHAUSTED, # Rate limited - backoff then retry
    grpc.StatusCode.INTERNAL,           # Server error (may be transient)
])

# Non-retryable: Client errors or permanent failures - retry won't help
NON_RETRYABLE_STATUS_CODES: frozenset[grpc.StatusCode] = frozenset([
    grpc.StatusCode.NOT_FOUND,           # Resource doesn't exist
    grpc.StatusCode.INVALID_ARGUMENT,    # Bad request - fix client
    grpc.StatusCode.PERMISSION_DENIED,   # Auth failure - won't change
    grpc.StatusCode.UNAUTHENTICATED,     # Auth failure - won't change
    grpc.StatusCode.ALREADY_EXISTS,      # Duplicate - idempotency issue
    grpc.StatusCode.FAILED_PRECONDITION, # State conflict - client issue
    grpc.StatusCode.UNIMPLEMENTED,       # Method not supported
    grpc.StatusCode.OUT_OF_RANGE,        # Invalid range - client issue
    grpc.StatusCode.DATA_LOSS,           # Unrecoverable data loss
])


def is_retryable_status_code(status_code: grpc.StatusCode) -> bool:
    """Check if a gRPC status code indicates a retryable error.
    
    Retryable errors are transient issues that may succeed on retry:
    - UNAVAILABLE: Service temporarily down
    - DEADLINE_EXCEEDED: Timeout (may succeed with retry)
    - ABORTED: Operation aborted (concurrency issue)
    - RESOURCE_EXHAUSTED: Rate limited (backoff helps)
    - INTERNAL: Server error (may be transient)
    
    Args:
        status_code: The gRPC status code to check.
        
    Returns:
        True if the error is retryable, False otherwise.
        
    Note:
        UNKNOWN status codes are treated as retryable to err on the side
        of attempting recovery. This is a conservative choice for
        critical operations where data loss is worse than extra retries.
    """
    if status_code in RETRYABLE_STATUS_CODES:
        return True
    if status_code in NON_RETRYABLE_STATUS_CODES:
        return False
    # Unknown codes: default to retryable for critical operations
    # Better to retry unnecessarily than lose data
    return True


# =============================================================================
# Custom Exceptions
# =============================================================================

class GrpcRetryExhaustedError(Exception):
    """Raised when all retry attempts have been exhausted.
    
    This exception indicates that the operation failed with retryable errors
    across all configured retry attempts. The operation may have partially
    succeeded or failed entirely.
    
    Attributes:
        operation_name: Name of the operation that failed.
        attempts: Number of attempts made.
        last_error: The last error encountered.
        total_duration_ms: Total time spent across all attempts.
    """
    
    def __init__(
        self,
        operation_name: str,
        attempts: int,
        last_error: Exception,
        total_duration_ms: float,
    ) -> None:
        self.operation_name = operation_name
        self.attempts = attempts
        self.last_error = last_error
        self.total_duration_ms = total_duration_ms
        
        super().__init__(
            f"Operation '{operation_name}' failed after {attempts} attempts "
            f"({total_duration_ms:.0f}ms total). Last error: {last_error}"
        )


class GrpcNonRetryableError(Exception):
    """Raised when a non-retryable gRPC error occurs.
    
    This exception indicates a permanent failure that will not succeed
    regardless of retry attempts. Examples include authentication failures,
    invalid arguments, or resource not found errors.
    
    Attributes:
        operation_name: Name of the operation that failed.
        status_code: The gRPC status code.
        original_error: The original gRPC error.
    """
    
    def __init__(
        self,
        operation_name: str,
        status_code: grpc.StatusCode,
        original_error: grpc.RpcError,
    ) -> None:
        self.operation_name = operation_name
        self.status_code = status_code
        self.original_error = original_error
        
        super().__init__(
            f"Operation '{operation_name}' failed with non-retryable error: "
            f"{status_code.name} - {original_error.details() if hasattr(original_error, 'details') else str(original_error)}"
        )


# =============================================================================
# Configuration
# =============================================================================

@dataclass(frozen=True)
class RetryConfig:
    """Configuration for retry with exponential backoff.
    
    This configuration controls the retry behavior for gRPC operations.
    The exponential backoff ensures that transient failures have time to
    recover while avoiding thundering herd problems.
    
    Default behavior (3 attempts, 2x backoff):
    - Attempt 1: Immediate
    - Attempt 2: After 1000ms delay
    - Attempt 3: After 2000ms delay
    - Total max time: ~3000ms + operation time
    
    Attributes:
        max_attempts: Maximum number of attempts (including initial).
            Must be at least 1. Default: 3 (one initial + two retries)
            
        initial_delay_ms: Initial delay between retries in milliseconds.
            This is the delay after the first failed attempt.
            Must be non-negative. Default: 1000ms (1 second)
            
        backoff_multiplier: Multiplier for exponential backoff.
            Each subsequent delay is multiplied by this factor.
            Must be at least 1.0. Default: 2.0 (1s -> 2s -> 4s)
            
        max_delay_ms: Maximum delay cap in milliseconds.
            Prevents delays from growing indefinitely.
            Must be at least initial_delay_ms. Default: 10000ms (10 seconds)
    
    Environment Variables:
        GRPC_RETRY_MAX_ATTEMPTS: Override max_attempts
        GRPC_RETRY_INITIAL_DELAY_MS: Override initial_delay_ms
        GRPC_RETRY_BACKOFF_MULTIPLIER: Override backoff_multiplier
        GRPC_RETRY_MAX_DELAY_MS: Override max_delay_ms
    
    Example:
        >>> config = RetryConfig.load_from_env()
        >>> print(f"Max attempts: {config.max_attempts}")
        Max attempts: 3
        
        >>> # Custom config for critical operations
        >>> critical_config = RetryConfig(
        ...     max_attempts=5,
        ...     initial_delay_ms=500,
        ...     backoff_multiplier=1.5,
        ...     max_delay_ms=5000,
        ... )
    """
    
    max_attempts: int = 3            # 1 initial + 2 retries
    initial_delay_ms: int = 1000     # Start with 1 second
    backoff_multiplier: float = 2.0  # 1s -> 2s -> 4s
    max_delay_ms: int = 10000        # Cap at 10 seconds
    
    def __post_init__(self) -> None:
        """Validate configuration values."""
        if self.max_attempts < 1:
            raise ValueError(
                f"max_attempts must be at least 1, got {self.max_attempts}"
            )
        if self.initial_delay_ms < 0:
            raise ValueError(
                f"initial_delay_ms must be non-negative, got {self.initial_delay_ms}"
            )
        if self.backoff_multiplier < 1.0:
            raise ValueError(
                f"backoff_multiplier must be at least 1.0, got {self.backoff_multiplier}"
            )
        if self.max_delay_ms < self.initial_delay_ms:
            raise ValueError(
                f"max_delay_ms ({self.max_delay_ms}) must be >= "
                f"initial_delay_ms ({self.initial_delay_ms})"
            )
    
    @classmethod
    def load_from_env(cls) -> "RetryConfig":
        """Load configuration from environment variables with defaults.
        
        Returns:
            RetryConfig instance with values from environment or defaults.
            
        Note:
            Invalid environment values are logged as warnings and defaults
            are used to ensure the system remains operational. This graceful
            degradation prevents misconfiguration from causing failures.
        """
        # Default values
        default_max_attempts = 3
        default_initial_delay_ms = 1000
        default_backoff_multiplier = 2.0
        default_max_delay_ms = 10000
        
        # Parse max_attempts
        max_attempts_str = os.getenv("GRPC_RETRY_MAX_ATTEMPTS")
        if max_attempts_str:
            try:
                max_attempts = int(max_attempts_str)
                if max_attempts < 1:
                    raise ValueError("must be at least 1")
            except ValueError as e:
                logger.warning(
                    f"Invalid GRPC_RETRY_MAX_ATTEMPTS='{max_attempts_str}': {e}. "
                    f"Using default: {default_max_attempts}"
                )
                max_attempts = default_max_attempts
        else:
            max_attempts = default_max_attempts
        
        # Parse initial_delay_ms
        initial_delay_str = os.getenv("GRPC_RETRY_INITIAL_DELAY_MS")
        if initial_delay_str:
            try:
                initial_delay_ms = int(initial_delay_str)
                if initial_delay_ms < 0:
                    raise ValueError("must be non-negative")
            except ValueError as e:
                logger.warning(
                    f"Invalid GRPC_RETRY_INITIAL_DELAY_MS='{initial_delay_str}': {e}. "
                    f"Using default: {default_initial_delay_ms}ms"
                )
                initial_delay_ms = default_initial_delay_ms
        else:
            initial_delay_ms = default_initial_delay_ms
        
        # Parse backoff_multiplier
        backoff_str = os.getenv("GRPC_RETRY_BACKOFF_MULTIPLIER")
        if backoff_str:
            try:
                backoff_multiplier = float(backoff_str)
                if backoff_multiplier < 1.0:
                    raise ValueError("must be at least 1.0")
            except ValueError as e:
                logger.warning(
                    f"Invalid GRPC_RETRY_BACKOFF_MULTIPLIER='{backoff_str}': {e}. "
                    f"Using default: {default_backoff_multiplier}"
                )
                backoff_multiplier = default_backoff_multiplier
        else:
            backoff_multiplier = default_backoff_multiplier
        
        # Parse max_delay_ms
        max_delay_str = os.getenv("GRPC_RETRY_MAX_DELAY_MS")
        if max_delay_str:
            try:
                max_delay_ms = int(max_delay_str)
                if max_delay_ms < 0:
                    raise ValueError("must be non-negative")
            except ValueError as e:
                logger.warning(
                    f"Invalid GRPC_RETRY_MAX_DELAY_MS='{max_delay_str}': {e}. "
                    f"Using default: {default_max_delay_ms}ms"
                )
                max_delay_ms = default_max_delay_ms
        else:
            max_delay_ms = default_max_delay_ms
        
        # Validate max_delay >= initial_delay
        if max_delay_ms < initial_delay_ms:
            logger.warning(
                f"GRPC_RETRY_MAX_DELAY_MS ({max_delay_ms}) < "
                f"GRPC_RETRY_INITIAL_DELAY_MS ({initial_delay_ms}). "
                f"Setting max_delay_ms to {initial_delay_ms}."
            )
            max_delay_ms = initial_delay_ms
        
        return cls(
            max_attempts=max_attempts,
            initial_delay_ms=initial_delay_ms,
            backoff_multiplier=backoff_multiplier,
            max_delay_ms=max_delay_ms,
        )
    
    def calculate_delay_ms(self, attempt: int) -> float:
        """Calculate delay for a given attempt number.
        
        Uses exponential backoff: delay = initial * (multiplier ^ (attempt - 1))
        Capped at max_delay_ms.
        
        Args:
            attempt: The attempt number (1-indexed). Delay is calculated
                for the retry after this attempt.
                
        Returns:
            Delay in milliseconds before the next retry.
            
        Example:
            >>> config = RetryConfig(initial_delay_ms=1000, backoff_multiplier=2.0)
            >>> config.calculate_delay_ms(1)  # Delay after 1st attempt
            1000.0
            >>> config.calculate_delay_ms(2)  # Delay after 2nd attempt
            2000.0
            >>> config.calculate_delay_ms(3)  # Delay after 3rd attempt
            4000.0
        """
        if attempt < 1:
            return 0.0
        
        # Exponential backoff: initial * multiplier^(attempt-1)
        delay = self.initial_delay_ms * (self.backoff_multiplier ** (attempt - 1))
        
        # Cap at max delay
        return min(delay, self.max_delay_ms)


# =============================================================================
# Retry Executor
# =============================================================================

# Type variable for generic return type
T = TypeVar("T")


class GrpcRetryExecutor:
    """Executes gRPC operations with retry and exponential backoff.
    
    This executor handles transient gRPC failures by automatically retrying
    with exponential backoff. It distinguishes between retryable errors
    (network issues, server overload) and permanent errors (bad request,
    auth failure) to avoid wasting time on unrecoverable situations.
    
    The executor provides comprehensive logging for observability, making
    it easy to diagnose issues in production without adding noise.
    
    Thread Safety:
        The executor itself is stateless and thread-safe. Multiple operations
        can be executed concurrently.
    
    Attributes:
        config: The RetryConfig controlling retry behavior.
    
    Example:
        >>> executor = GrpcRetryExecutor(RetryConfig.load_from_env())
        >>> 
        >>> # Execute with retry
        >>> result = await executor.execute(
        ...     operation=lambda: client.update_status(id, status),
        ...     operation_name="final_status_update",
        ...     context={"execution_id": id}
        ... )
        
        >>> # Handle specific error types
        >>> try:
        ...     await executor.execute(...)
        ... except GrpcRetryExhaustedError as e:
        ...     logger.error(f"Transient failure: {e.attempts} attempts failed")
        ... except GrpcNonRetryableError as e:
        ...     logger.error(f"Permanent failure: {e.status_code}")
    """
    
    def __init__(self, config: RetryConfig | None = None) -> None:
        """Initialize the executor.
        
        Args:
            config: Configuration for retry behavior. If None, uses defaults.
        """
        self.config = config or RetryConfig()
    
    async def execute(
        self,
        operation: Callable[[], Awaitable[T]],
        operation_name: str,
        context: dict[str, Any] | None = None,
    ) -> T:
        """Execute an async gRPC operation with retry logic.
        
        This method attempts the operation up to max_attempts times, with
        exponential backoff between retries. It distinguishes between
        retryable errors (which trigger retry) and non-retryable errors
        (which fail immediately).
        
        Args:
            operation: An async callable that performs the gRPC operation.
                Should be a lambda or partial that captures all arguments.
                
            operation_name: A descriptive name for logging and error messages.
                Examples: "final_status_update", "get_execution_context"
                
            context: Optional dictionary of context values for logging.
                Useful for including execution_id, phase, etc.
                
        Returns:
            The result of the successful operation.
            
        Raises:
            GrpcRetryExhaustedError: All retry attempts failed with
                retryable errors.
            GrpcNonRetryableError: Operation failed with a permanent error.
            
        Note:
            Non-gRPC exceptions (e.g., ValueError) are raised immediately
            without retry, as they indicate programming errors.
        """
        context = context or {}
        context_str = " ".join(f"{k}={v}" for k, v in context.items())
        
        start_time = time.monotonic()
        last_error: Exception | None = None
        
        for attempt in range(1, self.config.max_attempts + 1):
            attempt_start = time.monotonic()
            
            # Log attempt start
            logger.info(
                f"[RETRY] operation={operation_name} "
                f"{context_str} "
                f"attempt={attempt}/{self.config.max_attempts} "
                f"status=starting"
            )
            
            try:
                result = await operation()
                
                # Success - log and return
                elapsed_ms = (time.monotonic() - attempt_start) * 1000
                total_elapsed_ms = (time.monotonic() - start_time) * 1000
                
                if attempt > 1:
                    logger.info(
                        f"[RETRY] operation={operation_name} "
                        f"{context_str} "
                        f"attempt={attempt}/{self.config.max_attempts} "
                        f"status=success "
                        f"elapsed_ms={elapsed_ms:.0f} "
                        f"total_elapsed_ms={total_elapsed_ms:.0f} "
                        f"recovered_after={attempt - 1}_retries"
                    )
                else:
                    logger.info(
                        f"[RETRY] operation={operation_name} "
                        f"{context_str} "
                        f"attempt={attempt}/{self.config.max_attempts} "
                        f"status=success "
                        f"elapsed_ms={elapsed_ms:.0f}"
                    )
                
                return result
                
            except grpc.RpcError as e:
                last_error = e
                status_code = e.code() if hasattr(e, "code") else grpc.StatusCode.UNKNOWN
                elapsed_ms = (time.monotonic() - attempt_start) * 1000
                
                # Check if error is retryable
                if not is_retryable_status_code(status_code):
                    # Non-retryable error - fail immediately
                    logger.warning(
                        f"[RETRY] operation={operation_name} "
                        f"{context_str} "
                        f"attempt={attempt}/{self.config.max_attempts} "
                        f"status=failed_non_retryable "
                        f"error={status_code.name} "
                        f"elapsed_ms={elapsed_ms:.0f}"
                    )
                    raise GrpcNonRetryableError(
                        operation_name=operation_name,
                        status_code=status_code,
                        original_error=e,
                    ) from e
                
                # Retryable error - check if we have more attempts
                if attempt >= self.config.max_attempts:
                    # No more attempts - raise exhausted error
                    total_elapsed_ms = (time.monotonic() - start_time) * 1000
                    logger.error(
                        f"[RETRY] operation={operation_name} "
                        f"{context_str} "
                        f"attempt={attempt}/{self.config.max_attempts} "
                        f"status=exhausted "
                        f"error={status_code.name} "
                        f"total_elapsed_ms={total_elapsed_ms:.0f}"
                    )
                    raise GrpcRetryExhaustedError(
                        operation_name=operation_name,
                        attempts=attempt,
                        last_error=e,
                        total_duration_ms=total_elapsed_ms,
                    ) from e
                
                # Calculate delay for next attempt
                delay_ms = self.config.calculate_delay_ms(attempt)
                
                logger.warning(
                    f"[RETRY] operation={operation_name} "
                    f"{context_str} "
                    f"attempt={attempt}/{self.config.max_attempts} "
                    f"status=failed_retryable "
                    f"error={status_code.name} "
                    f"elapsed_ms={elapsed_ms:.0f} "
                    f"delay_ms={delay_ms:.0f}"
                )
                
                # Wait before retry
                await asyncio.sleep(delay_ms / 1000.0)
                
            except Exception as e:
                # Non-gRPC exception - likely a programming error
                # Don't retry these
                elapsed_ms = (time.monotonic() - attempt_start) * 1000
                logger.error(
                    f"[RETRY] operation={operation_name} "
                    f"{context_str} "
                    f"attempt={attempt}/{self.config.max_attempts} "
                    f"status=failed_unexpected "
                    f"error_type={type(e).__name__} "
                    f"error={str(e)} "
                    f"elapsed_ms={elapsed_ms:.0f}"
                )
                raise
        
        # Should not reach here, but handle defensively
        total_elapsed_ms = (time.monotonic() - start_time) * 1000
        raise GrpcRetryExhaustedError(
            operation_name=operation_name,
            attempts=self.config.max_attempts,
            last_error=last_error or Exception("Unknown error"),
            total_duration_ms=total_elapsed_ms,
        )
