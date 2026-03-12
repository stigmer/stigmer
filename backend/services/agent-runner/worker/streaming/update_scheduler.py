"""Streaming update scheduler for agent execution status updates.

This module provides a hybrid time + event threshold scheduling system
for streaming status updates during agent execution. It addresses the
limitations of naive event-count based approaches:

Problems with event-count based updates:
- Slow operations (30s tool): No update for 30 seconds - user thinks stuck
- Fast operations (100 events/sec): 10 updates/sec - wasteful

Solution: Hybrid time + event scheduler:
- Time-based primary trigger (500ms minimum interval)
- Burst protection (force update after N events)
- Keepalive for long operations (max interval)

Usage:
    config = StreamingConfig.load_from_env()
    scheduler = StreamingUpdateScheduler(config)
    
    for event in events:
        process_event(event)
        events_processed += 1
        
        if scheduler.should_send_update(events_processed):
            send_status_update()
            scheduler.mark_update_sent(events_processed)
"""

import logging
import os
import time
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class UpdateReason(Enum):
    """Reason for triggering a status update.
    
    Used for logging and observability to understand why updates are sent.
    """
    TIME_THRESHOLD = "time_threshold"      # Min interval elapsed with new events
    BURST_PROTECTION = "burst_protection"  # Too many events accumulated
    KEEPALIVE = "keepalive"                # Max interval elapsed (long operation)
    FIRST_UPDATE = "first_update"          # First update after stream start
    NONE = "none"                          # No update triggered


@dataclass(frozen=True)
class StreamingConfig:
    """Configuration for streaming status updates.
    
    This configuration controls when status updates are sent during
    agent execution streaming. The hybrid approach ensures:
    
    - Rate limiting: Never more than 2 updates/second (500ms minimum)
    - Responsiveness: Always shows new activity within 500ms
    - Burst protection: Prevents memory buildup during rapid event streams
    - Keepalive: Shows "still alive" even during long tool executions
    
    Attributes:
        min_interval_ms: Minimum time between updates in milliseconds.
            Provides rate limiting to prevent excessive network traffic.
            Default: 500ms (max 2 updates/second)
            
        max_interval_ms: Maximum time before forced update in milliseconds.
            Provides keepalive to reassure users during long operations.
            Default: 5000ms (5 seconds)
            
        burst_threshold: Number of events that triggers immediate update.
            Provides burst protection to prevent unbounded memory growth.
            Default: 50 events
    
    Environment Variables:
        STREAMING_MIN_INTERVAL_MS: Override min_interval_ms
        STREAMING_MAX_INTERVAL_MS: Override max_interval_ms
        STREAMING_BURST_THRESHOLD: Override burst_threshold
    
    Example:
        >>> config = StreamingConfig.load_from_env()
        >>> print(f"Min interval: {config.min_interval_ms}ms")
        Min interval: 500ms
    """
    
    min_interval_ms: int = 500      # Rate limiting: max 2 updates/second
    max_interval_ms: int = 5000     # Keepalive: update at least every 5 seconds
    burst_threshold: int = 50       # Burst protection: force update after N events
    
    def __post_init__(self) -> None:
        """Validate configuration values."""
        if self.min_interval_ms <= 0:
            raise ValueError(
                f"min_interval_ms must be positive, got {self.min_interval_ms}"
            )
        if self.max_interval_ms <= 0:
            raise ValueError(
                f"max_interval_ms must be positive, got {self.max_interval_ms}"
            )
        if self.max_interval_ms < self.min_interval_ms:
            raise ValueError(
                f"max_interval_ms ({self.max_interval_ms}) must be >= "
                f"min_interval_ms ({self.min_interval_ms})"
            )
        if self.burst_threshold <= 0:
            raise ValueError(
                f"burst_threshold must be positive, got {self.burst_threshold}"
            )
    
    @classmethod
    def load_from_env(cls) -> "StreamingConfig":
        """Load configuration from environment variables with defaults.
        
        Returns:
            StreamingConfig instance with values from environment or defaults.
            
        Note:
            Invalid environment values are logged as warnings and defaults
            are used to ensure the system remains operational.
        """
        # Default values
        default_min_interval = 500
        default_max_interval = 5000
        default_burst_threshold = 50
        
        # Parse min_interval_ms
        min_interval_str = os.getenv("STREAMING_MIN_INTERVAL_MS")
        if min_interval_str:
            try:
                min_interval_ms = int(min_interval_str)
                if min_interval_ms <= 0:
                    raise ValueError("must be positive")
            except ValueError as e:
                logger.warning(
                    f"Invalid STREAMING_MIN_INTERVAL_MS='{min_interval_str}': {e}. "
                    f"Using default: {default_min_interval}ms"
                )
                min_interval_ms = default_min_interval
        else:
            min_interval_ms = default_min_interval
        
        # Parse max_interval_ms
        max_interval_str = os.getenv("STREAMING_MAX_INTERVAL_MS")
        if max_interval_str:
            try:
                max_interval_ms = int(max_interval_str)
                if max_interval_ms <= 0:
                    raise ValueError("must be positive")
            except ValueError as e:
                logger.warning(
                    f"Invalid STREAMING_MAX_INTERVAL_MS='{max_interval_str}': {e}. "
                    f"Using default: {default_max_interval}ms"
                )
                max_interval_ms = default_max_interval
        else:
            max_interval_ms = default_max_interval
        
        # Parse burst_threshold
        burst_threshold_str = os.getenv("STREAMING_BURST_THRESHOLD")
        if burst_threshold_str:
            try:
                burst_threshold = int(burst_threshold_str)
                if burst_threshold <= 0:
                    raise ValueError("must be positive")
            except ValueError as e:
                logger.warning(
                    f"Invalid STREAMING_BURST_THRESHOLD='{burst_threshold_str}': {e}. "
                    f"Using default: {default_burst_threshold}"
                )
                burst_threshold = default_burst_threshold
        else:
            burst_threshold = default_burst_threshold
        
        # Validate max >= min
        if max_interval_ms < min_interval_ms:
            logger.warning(
                f"STREAMING_MAX_INTERVAL_MS ({max_interval_ms}) < "
                f"STREAMING_MIN_INTERVAL_MS ({min_interval_ms}). "
                f"Setting max to min value."
            )
            max_interval_ms = min_interval_ms
        
        return cls(
            min_interval_ms=min_interval_ms,
            max_interval_ms=max_interval_ms,
            burst_threshold=burst_threshold,
        )


class StreamingUpdateScheduler:
    """Manages timing for streaming status updates.
    
    This scheduler implements a hybrid time + event threshold algorithm
    to determine when status updates should be sent during agent execution.
    
    The scheduling algorithm:
    ```
    should_send_update = (
        # Primary: Time-based with minimum event guard
        (time_since_last >= MIN_INTERVAL AND events_since_last >= 1)
        OR
        # Secondary: Burst protection
        (events_since_last >= BURST_THRESHOLD)
        OR
        # Tertiary: Keepalive for long operations
        (time_since_last >= MAX_INTERVAL)
    )
    ```
    
    This ensures:
    - Rate limiting: Never more than 2 updates/second
    - Responsiveness: Always shows new activity within 500ms
    - Burst protection: Prevents memory buildup during rapid streams
    - Keepalive: Shows "still alive" during long tool executions
    
    Uses monotonic time for reliability (immune to clock adjustments).
    
    Attributes:
        config: The StreamingConfig controlling update timing.
        
    Example:
        >>> scheduler = StreamingUpdateScheduler(StreamingConfig())
        >>> events = 0
        >>> for event in stream:
        ...     events += 1
        ...     if scheduler.should_send_update(events):
        ...         send_update()
        ...         scheduler.mark_update_sent(events)
    """
    
    def __init__(self, config: StreamingConfig | None = None) -> None:
        """Initialize the scheduler.
        
        Args:
            config: Configuration for update timing. If None, uses defaults.
        """
        self.config = config or StreamingConfig()
        
        # Use monotonic time for reliability (immune to clock adjustments)
        self._last_update_time: float = time.monotonic()
        self._last_update_events: int = 0
        
        # Track the reason for the last update decision
        self._last_reason: UpdateReason = UpdateReason.NONE
        
        # Track if this is the first update check
        self._first_check: bool = True
    
    def should_send_update(self, events_processed: int) -> bool:
        """Determine if a status update should be sent.
        
        This method implements the hybrid scheduling algorithm that considers
        both time elapsed and events processed to make optimal update decisions.
        
        Args:
            events_processed: Total number of events processed so far.
            
        Returns:
            True if an update should be sent, False otherwise.
            
        Note:
            After calling this method, use `get_update_reason()` to get
            the reason for the decision (for logging purposes).
            
            After sending an update, call `mark_update_sent()` to reset
            the tracking state.
        """
        now = time.monotonic()
        time_since_last_ms = (now - self._last_update_time) * 1000
        events_since_last = events_processed - self._last_update_events
        
        # Store current time for reason calculation
        self._current_time = now
        self._current_events = events_processed
        
        # Check conditions in priority order
        
        # 1. First update - always send to establish initial state
        if self._first_check and events_since_last >= 1:
            self._last_reason = UpdateReason.FIRST_UPDATE
            return True
        
        # 2. Primary: Time-based with minimum event guard
        # Send if enough time has passed AND there are new events
        if time_since_last_ms >= self.config.min_interval_ms and events_since_last >= 1:
            self._last_reason = UpdateReason.TIME_THRESHOLD
            return True
        
        # 3. Secondary: Burst protection
        # Send if too many events have accumulated (prevent memory issues)
        if events_since_last >= self.config.burst_threshold:
            self._last_reason = UpdateReason.BURST_PROTECTION
            return True
        
        # 4. Tertiary: Keepalive for long operations
        # Send if max interval exceeded (even without new events)
        # This reassures users during long tool executions
        if time_since_last_ms >= self.config.max_interval_ms:
            self._last_reason = UpdateReason.KEEPALIVE
            return True
        
        # No update needed
        self._last_reason = UpdateReason.NONE
        return False
    
    def mark_update_sent(self, events_processed: int) -> None:
        """Mark that an update was sent, resetting tracking state.
        
        This method must be called after successfully sending a status update
        to reset the time and event tracking for the next update cycle.
        
        Args:
            events_processed: Total number of events processed when update was sent.
        """
        self._last_update_time = time.monotonic()
        self._last_update_events = events_processed
        self._first_check = False
    
    def get_update_reason(self) -> UpdateReason:
        """Get the reason for the last update decision.
        
        Returns:
            The UpdateReason enum value indicating why the last
            `should_send_update()` call returned True (or NONE if False).
            
        Example:
            >>> if scheduler.should_send_update(events):
            ...     reason = scheduler.get_update_reason()
            ...     logger.info(f"Sending update: {reason.value}")
        """
        return self._last_reason
    
    def get_update_reason_str(self) -> str:
        """Get a human-readable string for the update reason.
        
        Returns:
            A descriptive string suitable for logging.
        """
        return self._last_reason.value
    
    def get_time_since_last_update_ms(self) -> float:
        """Get milliseconds elapsed since the last update.
        
        Returns:
            Time in milliseconds since the last update was marked.
        """
        return (time.monotonic() - self._last_update_time) * 1000
    
    def get_events_since_last_update(self, events_processed: int) -> int:
        """Get number of events since the last update.
        
        Args:
            events_processed: Current total events processed.
            
        Returns:
            Number of events processed since the last update.
        """
        return events_processed - self._last_update_events
