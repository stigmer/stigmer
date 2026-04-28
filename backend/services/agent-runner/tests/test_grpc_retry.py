"""Unit tests for gRPC retry module.

Tests cover:
- RetryConfig creation and validation
- RetryConfig environment variable loading with defaults and overrides
- gRPC status code classification (retryable vs non-retryable)
- GrpcRetryExecutor successful operations
- GrpcRetryExecutor retry on transient failures
- GrpcRetryExecutor exhausted retries
- GrpcRetryExecutor non-retryable error handling
- Exponential backoff timing verification
- Logging and context handling
- Edge cases and error scenarios

Test Categories:
1. Configuration Tests - RetryConfig defaults, validation, env loading
2. Status Code Classification Tests - Retryable vs non-retryable codes
3. Success Tests - First attempt success, success after retries
4. Failure Tests - Exhausted retries, non-retryable errors
5. Backoff Tests - Exponential delay calculation
6. Edge Cases - Single attempt, zero delay, mixed errors
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest

from stigmer_runner.worker.resilience.grpc_retry import (
    NON_RETRYABLE_STATUS_CODES,
    RETRYABLE_STATUS_CODES,
    GrpcNonRetryableError,
    GrpcRetryExecutor,
    GrpcRetryExhaustedError,
    RetryConfig,
    is_retryable_status_code,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def default_config():
    """Create a default RetryConfig."""
    return RetryConfig()


@pytest.fixture
def fast_config():
    """Create a fast config for testing (shorter delays)."""
    return RetryConfig(
        max_attempts=3,
        initial_delay_ms=10,  # 10ms for fast tests
        backoff_multiplier=2.0,
        max_delay_ms=100,
    )


@pytest.fixture
def single_attempt_config():
    """Create a config with single attempt (no retries)."""
    return RetryConfig(
        max_attempts=1,
        initial_delay_ms=100,
        backoff_multiplier=2.0,
        max_delay_ms=1000,
    )


@pytest.fixture
def executor(default_config):
    """Create a GrpcRetryExecutor with default config."""
    return GrpcRetryExecutor(default_config)


@pytest.fixture
def fast_executor(fast_config):
    """Create a GrpcRetryExecutor with fast config for testing."""
    return GrpcRetryExecutor(fast_config)


@pytest.fixture
def single_attempt_executor(single_attempt_config):
    """Create a GrpcRetryExecutor with single attempt."""
    return GrpcRetryExecutor(single_attempt_config)


def create_grpc_error(status_code: grpc.StatusCode, details: str = "Test error") -> grpc.RpcError:
    """Create a real gRPC AioRpcError with the specified status code.
    
    Uses grpc.aio.AioRpcError which is a proper exception that inherits from
    both grpc.RpcError and BaseException.
    """
    error = grpc.aio.AioRpcError(
        code=status_code,
        initial_metadata=None,
        trailing_metadata=None,
        details=details,
        debug_error_string=None,
    )
    # Override code() method to return the status code (grpc.aio.AioRpcError 
    # stores it differently)
    error.code = MagicMock(return_value=status_code)
    error.details = MagicMock(return_value=details)
    return error


# =============================================================================
# Tests for RetryConfig Defaults
# =============================================================================


class TestRetryConfigDefaults:
    """Tests for RetryConfig default values."""

    def test_default_max_attempts(self):
        """Test default max_attempts is 3."""
        config = RetryConfig()
        assert config.max_attempts == 3

    def test_default_initial_delay_ms(self):
        """Test default initial_delay_ms is 1000."""
        config = RetryConfig()
        assert config.initial_delay_ms == 1000

    def test_default_backoff_multiplier(self):
        """Test default backoff_multiplier is 2.0."""
        config = RetryConfig()
        assert config.backoff_multiplier == 2.0

    def test_default_max_delay_ms(self):
        """Test default max_delay_ms is 10000."""
        config = RetryConfig()
        assert config.max_delay_ms == 10000

    def test_config_is_immutable(self):
        """Test that config is frozen (immutable)."""
        config = RetryConfig()
        with pytest.raises(AttributeError):
            config.max_attempts = 5


# =============================================================================
# Tests for RetryConfig Validation
# =============================================================================


class TestRetryConfigValidation:
    """Tests for RetryConfig validation."""

    def test_rejects_zero_max_attempts(self):
        """Test that zero max_attempts raises ValueError."""
        with pytest.raises(ValueError, match="max_attempts must be at least 1"):
            RetryConfig(max_attempts=0)

    def test_rejects_negative_max_attempts(self):
        """Test that negative max_attempts raises ValueError."""
        with pytest.raises(ValueError, match="max_attempts must be at least 1"):
            RetryConfig(max_attempts=-1)

    def test_accepts_one_max_attempt(self):
        """Test that max_attempts=1 is valid (no retries)."""
        config = RetryConfig(max_attempts=1)
        assert config.max_attempts == 1

    def test_rejects_negative_initial_delay(self):
        """Test that negative initial_delay_ms raises ValueError."""
        with pytest.raises(ValueError, match="initial_delay_ms must be non-negative"):
            RetryConfig(initial_delay_ms=-1)

    def test_accepts_zero_initial_delay(self):
        """Test that zero initial_delay_ms is valid (no delay)."""
        config = RetryConfig(initial_delay_ms=0)
        assert config.initial_delay_ms == 0

    def test_rejects_backoff_less_than_one(self):
        """Test that backoff_multiplier < 1.0 raises ValueError."""
        with pytest.raises(ValueError, match="backoff_multiplier must be at least 1.0"):
            RetryConfig(backoff_multiplier=0.5)

    def test_accepts_backoff_equal_to_one(self):
        """Test that backoff_multiplier=1.0 is valid (constant delay)."""
        config = RetryConfig(backoff_multiplier=1.0)
        assert config.backoff_multiplier == 1.0

    def test_rejects_max_delay_less_than_initial(self):
        """Test that max_delay_ms < initial_delay_ms raises ValueError."""
        with pytest.raises(ValueError, match="max_delay_ms .* must be >= initial_delay_ms"):
            RetryConfig(initial_delay_ms=1000, max_delay_ms=500)

    def test_accepts_max_delay_equal_to_initial(self):
        """Test that max_delay_ms == initial_delay_ms is valid."""
        config = RetryConfig(initial_delay_ms=1000, max_delay_ms=1000)
        assert config.max_delay_ms == config.initial_delay_ms


# =============================================================================
# Tests for RetryConfig Environment Variable Loading
# =============================================================================


class TestRetryConfigEnvLoading:
    """Tests for RetryConfig.load_from_env()."""

    def test_loads_defaults_without_env_vars(self):
        """Test that defaults are used when no env vars are set."""
        with patch.dict(os.environ, {}, clear=True):
            config = RetryConfig.load_from_env()
            assert config.max_attempts == 3
            assert config.initial_delay_ms == 1000
            assert config.backoff_multiplier == 2.0
            assert config.max_delay_ms == 10000

    def test_loads_max_attempts_from_env(self):
        """Test GRPC_RETRY_MAX_ATTEMPTS is loaded."""
        with patch.dict(os.environ, {"GRPC_RETRY_MAX_ATTEMPTS": "5"}):
            config = RetryConfig.load_from_env()
            assert config.max_attempts == 5

    def test_loads_initial_delay_from_env(self):
        """Test GRPC_RETRY_INITIAL_DELAY_MS is loaded."""
        with patch.dict(os.environ, {"GRPC_RETRY_INITIAL_DELAY_MS": "2000"}):
            config = RetryConfig.load_from_env()
            assert config.initial_delay_ms == 2000

    def test_loads_backoff_multiplier_from_env(self):
        """Test GRPC_RETRY_BACKOFF_MULTIPLIER is loaded."""
        with patch.dict(os.environ, {"GRPC_RETRY_BACKOFF_MULTIPLIER": "1.5"}):
            config = RetryConfig.load_from_env()
            assert config.backoff_multiplier == 1.5

    def test_loads_max_delay_from_env(self):
        """Test GRPC_RETRY_MAX_DELAY_MS is loaded."""
        with patch.dict(os.environ, {"GRPC_RETRY_MAX_DELAY_MS": "5000"}):
            config = RetryConfig.load_from_env()
            assert config.max_delay_ms == 5000

    def test_invalid_max_attempts_uses_default(self):
        """Test invalid GRPC_RETRY_MAX_ATTEMPTS falls back to default."""
        with patch.dict(os.environ, {"GRPC_RETRY_MAX_ATTEMPTS": "invalid"}):
            config = RetryConfig.load_from_env()
            assert config.max_attempts == 3

    def test_zero_max_attempts_uses_default(self):
        """Test zero GRPC_RETRY_MAX_ATTEMPTS falls back to default."""
        with patch.dict(os.environ, {"GRPC_RETRY_MAX_ATTEMPTS": "0"}):
            config = RetryConfig.load_from_env()
            assert config.max_attempts == 3

    def test_invalid_backoff_uses_default(self):
        """Test invalid GRPC_RETRY_BACKOFF_MULTIPLIER falls back to default."""
        with patch.dict(os.environ, {"GRPC_RETRY_BACKOFF_MULTIPLIER": "0.5"}):
            config = RetryConfig.load_from_env()
            assert config.backoff_multiplier == 2.0

    def test_max_delay_less_than_initial_is_corrected(self):
        """Test max_delay < initial_delay is corrected to initial_delay."""
        with patch.dict(os.environ, {
            "GRPC_RETRY_INITIAL_DELAY_MS": "2000",
            "GRPC_RETRY_MAX_DELAY_MS": "1000",
        }):
            config = RetryConfig.load_from_env()
            assert config.max_delay_ms == 2000  # Corrected to initial


# =============================================================================
# Tests for Backoff Calculation
# =============================================================================


class TestBackoffCalculation:
    """Tests for RetryConfig.calculate_delay_ms()."""

    def test_first_attempt_delay(self):
        """Test delay after first attempt equals initial delay."""
        config = RetryConfig(initial_delay_ms=1000, backoff_multiplier=2.0)
        assert config.calculate_delay_ms(1) == 1000.0

    def test_second_attempt_delay(self):
        """Test delay after second attempt uses backoff."""
        config = RetryConfig(initial_delay_ms=1000, backoff_multiplier=2.0)
        assert config.calculate_delay_ms(2) == 2000.0

    def test_third_attempt_delay(self):
        """Test delay after third attempt uses continued backoff."""
        config = RetryConfig(initial_delay_ms=1000, backoff_multiplier=2.0)
        assert config.calculate_delay_ms(3) == 4000.0

    def test_delay_capped_at_max(self):
        """Test delay is capped at max_delay_ms."""
        config = RetryConfig(
            initial_delay_ms=1000,
            backoff_multiplier=2.0,
            max_delay_ms=3000,
        )
        # 4th attempt would be 8000, but capped at 3000
        assert config.calculate_delay_ms(4) == 3000.0

    def test_constant_backoff(self):
        """Test backoff_multiplier=1.0 gives constant delay."""
        config = RetryConfig(
            initial_delay_ms=1000,
            backoff_multiplier=1.0,
            max_delay_ms=10000,
        )
        assert config.calculate_delay_ms(1) == 1000.0
        assert config.calculate_delay_ms(2) == 1000.0
        assert config.calculate_delay_ms(3) == 1000.0

    def test_zero_attempt_returns_zero(self):
        """Test that attempt < 1 returns 0."""
        config = RetryConfig()
        assert config.calculate_delay_ms(0) == 0.0
        assert config.calculate_delay_ms(-1) == 0.0


# =============================================================================
# Tests for Status Code Classification
# =============================================================================


class TestStatusCodeClassification:
    """Tests for gRPC status code classification."""

    def test_unavailable_is_retryable(self):
        """Test UNAVAILABLE is classified as retryable."""
        assert is_retryable_status_code(grpc.StatusCode.UNAVAILABLE) is True
        assert grpc.StatusCode.UNAVAILABLE in RETRYABLE_STATUS_CODES

    def test_deadline_exceeded_is_retryable(self):
        """Test DEADLINE_EXCEEDED is classified as retryable."""
        assert is_retryable_status_code(grpc.StatusCode.DEADLINE_EXCEEDED) is True
        assert grpc.StatusCode.DEADLINE_EXCEEDED in RETRYABLE_STATUS_CODES

    def test_resource_exhausted_is_retryable(self):
        """Test RESOURCE_EXHAUSTED is classified as retryable."""
        assert is_retryable_status_code(grpc.StatusCode.RESOURCE_EXHAUSTED) is True
        assert grpc.StatusCode.RESOURCE_EXHAUSTED in RETRYABLE_STATUS_CODES

    def test_internal_is_retryable(self):
        """Test INTERNAL is classified as retryable."""
        assert is_retryable_status_code(grpc.StatusCode.INTERNAL) is True
        assert grpc.StatusCode.INTERNAL in RETRYABLE_STATUS_CODES

    def test_aborted_is_retryable(self):
        """Test ABORTED is classified as retryable."""
        assert is_retryable_status_code(grpc.StatusCode.ABORTED) is True
        assert grpc.StatusCode.ABORTED in RETRYABLE_STATUS_CODES

    def test_not_found_is_not_retryable(self):
        """Test NOT_FOUND is classified as non-retryable."""
        assert is_retryable_status_code(grpc.StatusCode.NOT_FOUND) is False
        assert grpc.StatusCode.NOT_FOUND in NON_RETRYABLE_STATUS_CODES

    def test_invalid_argument_is_not_retryable(self):
        """Test INVALID_ARGUMENT is classified as non-retryable."""
        assert is_retryable_status_code(grpc.StatusCode.INVALID_ARGUMENT) is False
        assert grpc.StatusCode.INVALID_ARGUMENT in NON_RETRYABLE_STATUS_CODES

    def test_permission_denied_is_not_retryable(self):
        """Test PERMISSION_DENIED is classified as non-retryable."""
        assert is_retryable_status_code(grpc.StatusCode.PERMISSION_DENIED) is False
        assert grpc.StatusCode.PERMISSION_DENIED in NON_RETRYABLE_STATUS_CODES

    def test_unauthenticated_is_not_retryable(self):
        """Test UNAUTHENTICATED is classified as non-retryable."""
        assert is_retryable_status_code(grpc.StatusCode.UNAUTHENTICATED) is False
        assert grpc.StatusCode.UNAUTHENTICATED in NON_RETRYABLE_STATUS_CODES

    def test_already_exists_is_not_retryable(self):
        """Test ALREADY_EXISTS is classified as non-retryable."""
        assert is_retryable_status_code(grpc.StatusCode.ALREADY_EXISTS) is False
        assert grpc.StatusCode.ALREADY_EXISTS in NON_RETRYABLE_STATUS_CODES

    def test_unknown_code_is_retryable_by_default(self):
        """Test unknown status codes default to retryable (conservative)."""
        # OK is not in either set (it's not an error)
        # For safety, treat unknown errors as retryable
        assert is_retryable_status_code(grpc.StatusCode.OK) is True


# =============================================================================
# Tests for GrpcRetryExecutor - Success Cases
# =============================================================================


class TestGrpcRetryExecutorSuccess:
    """Tests for GrpcRetryExecutor successful operations."""

    @pytest.mark.asyncio
    async def test_success_on_first_attempt(self, fast_executor):
        """Test operation succeeds on first attempt without retry."""
        operation = AsyncMock(return_value="success")
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
            context={"test_id": "123"},
        )
        
        assert result == "success"
        assert operation.call_count == 1

    @pytest.mark.asyncio
    async def test_success_after_one_retry(self, fast_executor):
        """Test operation succeeds after one transient failure."""
        # Fail first, succeed second
        operation = AsyncMock(side_effect=[
            create_grpc_error(grpc.StatusCode.UNAVAILABLE),
            "success",
        ])
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
        )
        
        assert result == "success"
        assert operation.call_count == 2

    @pytest.mark.asyncio
    async def test_success_after_multiple_retries(self, fast_executor):
        """Test operation succeeds after multiple transient failures."""
        # Fail twice, succeed third
        operation = AsyncMock(side_effect=[
            create_grpc_error(grpc.StatusCode.UNAVAILABLE),
            create_grpc_error(grpc.StatusCode.DEADLINE_EXCEEDED),
            "success",
        ])
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
        )
        
        assert result == "success"
        assert operation.call_count == 3

    @pytest.mark.asyncio
    async def test_executor_with_no_config_uses_defaults(self):
        """Test executor with no config uses default RetryConfig."""
        executor = GrpcRetryExecutor()
        operation = AsyncMock(return_value="success")
        
        result = await executor.execute(
            operation=operation,
            operation_name="test_op",
        )
        
        assert result == "success"
        assert executor.config.max_attempts == 3


# =============================================================================
# Tests for GrpcRetryExecutor - Failure Cases
# =============================================================================


class TestGrpcRetryExecutorFailure:
    """Tests for GrpcRetryExecutor failure scenarios."""

    @pytest.mark.asyncio
    async def test_exhausted_retries_raises_error(self, fast_executor):
        """Test GrpcRetryExhaustedError is raised when all retries fail."""
        operation = AsyncMock(
            side_effect=create_grpc_error(grpc.StatusCode.UNAVAILABLE)
        )
        
        with pytest.raises(GrpcRetryExhaustedError) as exc_info:
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.operation_name == "test_op"
        assert exc_info.value.attempts == 3
        assert operation.call_count == 3

    @pytest.mark.asyncio
    async def test_non_retryable_error_fails_immediately(self, fast_executor):
        """Test GrpcNonRetryableError is raised without retry."""
        operation = AsyncMock(
            side_effect=create_grpc_error(grpc.StatusCode.NOT_FOUND)
        )
        
        with pytest.raises(GrpcNonRetryableError) as exc_info:
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.operation_name == "test_op"
        assert exc_info.value.status_code == grpc.StatusCode.NOT_FOUND
        assert operation.call_count == 1  # No retry

    @pytest.mark.asyncio
    async def test_permission_denied_fails_immediately(self, fast_executor):
        """Test PERMISSION_DENIED fails immediately without retry."""
        operation = AsyncMock(
            side_effect=create_grpc_error(grpc.StatusCode.PERMISSION_DENIED)
        )
        
        with pytest.raises(GrpcNonRetryableError):
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert operation.call_count == 1

    @pytest.mark.asyncio
    async def test_invalid_argument_fails_immediately(self, fast_executor):
        """Test INVALID_ARGUMENT fails immediately without retry."""
        operation = AsyncMock(
            side_effect=create_grpc_error(grpc.StatusCode.INVALID_ARGUMENT)
        )
        
        with pytest.raises(GrpcNonRetryableError):
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert operation.call_count == 1

    @pytest.mark.asyncio
    async def test_non_grpc_exception_not_retried(self, fast_executor):
        """Test non-gRPC exceptions are raised immediately."""
        operation = AsyncMock(side_effect=ValueError("Bad value"))
        
        with pytest.raises(ValueError, match="Bad value"):
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert operation.call_count == 1

    @pytest.mark.asyncio
    async def test_single_attempt_config_no_retry(self, single_attempt_executor):
        """Test single attempt config doesn't retry."""
        operation = AsyncMock(
            side_effect=create_grpc_error(grpc.StatusCode.UNAVAILABLE)
        )
        
        with pytest.raises(GrpcRetryExhaustedError) as exc_info:
            await single_attempt_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.attempts == 1
        assert operation.call_count == 1


# =============================================================================
# Tests for GrpcRetryExecutor - Mixed Error Scenarios
# =============================================================================


class TestGrpcRetryExecutorMixedErrors:
    """Tests for mixed error scenarios."""

    @pytest.mark.asyncio
    async def test_retryable_then_non_retryable_fails_on_non_retryable(self, fast_executor):
        """Test retryable error followed by non-retryable fails immediately."""
        operation = AsyncMock(side_effect=[
            create_grpc_error(grpc.StatusCode.UNAVAILABLE),  # Retryable
            create_grpc_error(grpc.StatusCode.NOT_FOUND),    # Non-retryable
        ])
        
        with pytest.raises(GrpcNonRetryableError) as exc_info:
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.status_code == grpc.StatusCode.NOT_FOUND
        assert operation.call_count == 2

    @pytest.mark.asyncio
    async def test_different_retryable_errors(self, fast_executor):
        """Test recovery works with different retryable errors."""
        operation = AsyncMock(side_effect=[
            create_grpc_error(grpc.StatusCode.UNAVAILABLE),
            create_grpc_error(grpc.StatusCode.RESOURCE_EXHAUSTED),
            "success",
        ])
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
        )
        
        assert result == "success"
        assert operation.call_count == 3


# =============================================================================
# Tests for Exception Details
# =============================================================================


class TestExceptionDetails:
    """Tests for exception attributes and messages."""

    @pytest.mark.asyncio
    async def test_exhausted_error_contains_duration(self, fast_executor):
        """Test GrpcRetryExhaustedError contains total duration."""
        operation = AsyncMock(
            side_effect=create_grpc_error(grpc.StatusCode.UNAVAILABLE)
        )
        
        with pytest.raises(GrpcRetryExhaustedError) as exc_info:
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.total_duration_ms > 0

    @pytest.mark.asyncio
    async def test_exhausted_error_contains_last_error(self, fast_executor):
        """Test GrpcRetryExhaustedError contains last error."""
        error = create_grpc_error(grpc.StatusCode.UNAVAILABLE, "Network error")
        operation = AsyncMock(side_effect=error)
        
        with pytest.raises(GrpcRetryExhaustedError) as exc_info:
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.last_error is error

    @pytest.mark.asyncio
    async def test_non_retryable_error_contains_original_error(self, fast_executor):
        """Test GrpcNonRetryableError contains original error."""
        error = create_grpc_error(grpc.StatusCode.NOT_FOUND, "Resource not found")
        operation = AsyncMock(side_effect=error)
        
        with pytest.raises(GrpcNonRetryableError) as exc_info:
            await fast_executor.execute(
                operation=operation,
                operation_name="test_op",
            )
        
        assert exc_info.value.original_error is error

    def test_exhausted_error_message_format(self):
        """Test GrpcRetryExhaustedError has informative message."""
        error = GrpcRetryExhaustedError(
            operation_name="test_op",
            attempts=3,
            last_error=Exception("Network timeout"),
            total_duration_ms=5000,
        )
        
        assert "test_op" in str(error)
        assert "3 attempts" in str(error)
        assert "5000" in str(error)
        assert "Network timeout" in str(error)

    def test_non_retryable_error_message_format(self):
        """Test GrpcNonRetryableError has informative message."""
        grpc_error = create_grpc_error(grpc.StatusCode.NOT_FOUND, "Not found")
        error = GrpcNonRetryableError(
            operation_name="test_op",
            status_code=grpc.StatusCode.NOT_FOUND,
            original_error=grpc_error,
        )
        
        assert "test_op" in str(error)
        assert "NOT_FOUND" in str(error)


# =============================================================================
# Tests for Logging and Context
# =============================================================================


class TestLoggingAndContext:
    """Tests for logging behavior and context handling."""

    @pytest.mark.asyncio
    async def test_context_is_optional(self, fast_executor):
        """Test operation works without context."""
        operation = AsyncMock(return_value="success")
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
            context=None,
        )
        
        assert result == "success"

    @pytest.mark.asyncio
    async def test_empty_context_works(self, fast_executor):
        """Test operation works with empty context."""
        operation = AsyncMock(return_value="success")
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
            context={},
        )
        
        assert result == "success"

    @pytest.mark.asyncio
    async def test_context_with_multiple_values(self, fast_executor):
        """Test operation works with multiple context values."""
        operation = AsyncMock(return_value="success")
        
        result = await fast_executor.execute(
            operation=operation,
            operation_name="test_op",
            context={
                "execution_id": "exec-123",
                "phase": "COMPLETED",
                "attempt_type": "final",
            },
        )
        
        assert result == "success"


# =============================================================================
# Tests for Timing Behavior
# =============================================================================


class TestTimingBehavior:
    """Tests for retry timing and backoff behavior."""

    @pytest.mark.asyncio
    async def test_backoff_delay_is_applied(self):
        """Test that backoff delay is actually applied between retries."""
        # Use measurable delays
        config = RetryConfig(
            max_attempts=2,
            initial_delay_ms=50,
            backoff_multiplier=2.0,
            max_delay_ms=1000,
        )
        executor = GrpcRetryExecutor(config)
        
        operation = AsyncMock(side_effect=[
            create_grpc_error(grpc.StatusCode.UNAVAILABLE),
            "success",
        ])
        
        import time
        start = time.monotonic()
        result = await executor.execute(
            operation=operation,
            operation_name="test_op",
        )
        elapsed_ms = (time.monotonic() - start) * 1000
        
        assert result == "success"
        # Should have waited at least 50ms (the initial delay)
        assert elapsed_ms >= 40  # Allow some timing tolerance

    @pytest.mark.asyncio
    async def test_zero_delay_config_works(self):
        """Test zero initial delay results in no wait."""
        config = RetryConfig(
            max_attempts=3,
            initial_delay_ms=0,
            backoff_multiplier=2.0,
            max_delay_ms=0,
        )
        executor = GrpcRetryExecutor(config)
        
        operation = AsyncMock(side_effect=[
            create_grpc_error(grpc.StatusCode.UNAVAILABLE),
            "success",
        ])
        
        result = await executor.execute(
            operation=operation,
            operation_name="test_op",
        )
        
        assert result == "success"
        assert operation.call_count == 2
