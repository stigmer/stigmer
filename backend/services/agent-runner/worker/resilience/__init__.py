"""Resilience utilities for agent execution.

This module provides components for reliable gRPC communication with
retry logic, exponential backoff, and intelligent error classification.

Components:
    - RetryConfig: Configuration for retry behavior with env var support
    - GrpcRetryExecutor: Executes gRPC operations with automatic retry
    - GrpcRetryExhaustedError: Raised when all retries are exhausted
    - GrpcNonRetryableError: Raised on permanent/non-retryable errors
    - is_retryable_status_code: Check if a gRPC status code is retryable

Example:
    from worker.resilience import GrpcRetryExecutor, RetryConfig
    
    executor = GrpcRetryExecutor(RetryConfig.load_from_env())
    result = await executor.execute(
        operation=lambda: client.update_status(id, status),
        operation_name="final_status_update",
        context={"execution_id": id}
    )
"""

from worker.resilience.grpc_retry import (
    GrpcNonRetryableError,
    GrpcRetryExhaustedError,
    GrpcRetryExecutor,
    RETRYABLE_STATUS_CODES,
    NON_RETRYABLE_STATUS_CODES,
    RetryConfig,
    is_retryable_status_code,
)

__all__ = [
    "GrpcNonRetryableError",
    "GrpcRetryExhaustedError",
    "GrpcRetryExecutor",
    "RETRYABLE_STATUS_CODES",
    "NON_RETRYABLE_STATUS_CODES",
    "RetryConfig",
    "is_retryable_status_code",
]
