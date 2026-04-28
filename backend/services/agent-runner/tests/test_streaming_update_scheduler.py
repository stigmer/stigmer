"""Unit tests for StreamingUpdateScheduler module.

Tests cover:
- StreamingConfig creation and validation
- Environment variable loading with defaults and overrides
- StreamingUpdateScheduler time-based update triggers
- Burst protection behavior
- Keepalive behavior for long operations
- First update handling

Test Categories:
1. Configuration Tests - StreamingConfig defaults, validation, env loading
2. Time-Based Tests - Min interval behavior with event guards
3. Burst Protection Tests - Force update after N events
4. Keepalive Tests - Max interval behavior
5. Edge Cases - First event, rapid events, state management
"""

import os
import time
from unittest.mock import patch

import pytest

from stigmer_runner.worker.streaming.update_scheduler import (
    StreamingConfig,
    StreamingUpdateScheduler,
    UpdateReason,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def default_config():
    """Create a default StreamingConfig."""
    return StreamingConfig()


@pytest.fixture
def fast_config():
    """Create a fast config for testing (shorter intervals)."""
    return StreamingConfig(
        min_interval_ms=100,
        max_interval_ms=500,
        burst_threshold=10,
    )


@pytest.fixture
def scheduler(default_config):
    """Create a StreamingUpdateScheduler with default config."""
    return StreamingUpdateScheduler(default_config)


@pytest.fixture
def fast_scheduler(fast_config):
    """Create a StreamingUpdateScheduler with fast config for testing."""
    return StreamingUpdateScheduler(fast_config)


# =============================================================================
# Tests for StreamingConfig
# =============================================================================


class TestStreamingConfigDefaults:
    """Tests for StreamingConfig default values."""

    def test_default_min_interval(self):
        """Test default min_interval_ms is 500."""
        config = StreamingConfig()
        assert config.min_interval_ms == 500

    def test_default_max_interval(self):
        """Test default max_interval_ms is 5000."""
        config = StreamingConfig()
        assert config.max_interval_ms == 5000

    def test_default_burst_threshold(self):
        """Test default burst_threshold is 50."""
        config = StreamingConfig()
        assert config.burst_threshold == 50

    def test_config_is_immutable(self):
        """Test that config is frozen (immutable)."""
        config = StreamingConfig()
        with pytest.raises(AttributeError):
            config.min_interval_ms = 1000


class TestStreamingConfigValidation:
    """Tests for StreamingConfig validation."""

    def test_rejects_zero_min_interval(self):
        """Test that zero min_interval_ms raises ValueError."""
        with pytest.raises(ValueError, match="min_interval_ms must be positive"):
            StreamingConfig(min_interval_ms=0)

    def test_rejects_negative_min_interval(self):
        """Test that negative min_interval_ms raises ValueError."""
        with pytest.raises(ValueError, match="min_interval_ms must be positive"):
            StreamingConfig(min_interval_ms=-100)

    def test_rejects_zero_max_interval(self):
        """Test that zero max_interval_ms raises ValueError."""
        with pytest.raises(ValueError, match="max_interval_ms must be positive"):
            StreamingConfig(max_interval_ms=0)

    def test_rejects_negative_max_interval(self):
        """Test that negative max_interval_ms raises ValueError."""
        with pytest.raises(ValueError, match="max_interval_ms must be positive"):
            StreamingConfig(max_interval_ms=-100)

    def test_rejects_zero_burst_threshold(self):
        """Test that zero burst_threshold raises ValueError."""
        with pytest.raises(ValueError, match="burst_threshold must be positive"):
            StreamingConfig(burst_threshold=0)

    def test_rejects_negative_burst_threshold(self):
        """Test that negative burst_threshold raises ValueError."""
        with pytest.raises(ValueError, match="burst_threshold must be positive"):
            StreamingConfig(burst_threshold=-10)

    def test_rejects_max_less_than_min(self):
        """Test that max_interval_ms < min_interval_ms raises ValueError."""
        with pytest.raises(ValueError, match="max_interval_ms .* must be >= min_interval_ms"):
            StreamingConfig(min_interval_ms=1000, max_interval_ms=500)

    def test_accepts_max_equal_to_min(self):
        """Test that max_interval_ms == min_interval_ms is valid."""
        config = StreamingConfig(min_interval_ms=500, max_interval_ms=500)
        assert config.min_interval_ms == config.max_interval_ms

    def test_accepts_valid_custom_values(self):
        """Test that valid custom values are accepted."""
        config = StreamingConfig(
            min_interval_ms=250,
            max_interval_ms=10000,
            burst_threshold=100,
        )
        assert config.min_interval_ms == 250
        assert config.max_interval_ms == 10000
        assert config.burst_threshold == 100


class TestStreamingConfigLoadFromEnv:
    """Tests for StreamingConfig.load_from_env()."""

    def test_uses_defaults_when_no_env_vars(self):
        """Test that defaults are used when no env vars are set."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove any existing streaming env vars
            for key in ["STREAMING_MIN_INTERVAL_MS", "STREAMING_MAX_INTERVAL_MS", "STREAMING_BURST_THRESHOLD"]:
                os.environ.pop(key, None)
            
            config = StreamingConfig.load_from_env()
            
            assert config.min_interval_ms == 500
            assert config.max_interval_ms == 5000
            assert config.burst_threshold == 50

    def test_overrides_min_interval_from_env(self):
        """Test that STREAMING_MIN_INTERVAL_MS overrides default."""
        with patch.dict(os.environ, {"STREAMING_MIN_INTERVAL_MS": "250"}):
            config = StreamingConfig.load_from_env()
            assert config.min_interval_ms == 250

    def test_overrides_max_interval_from_env(self):
        """Test that STREAMING_MAX_INTERVAL_MS overrides default."""
        with patch.dict(os.environ, {"STREAMING_MAX_INTERVAL_MS": "10000"}):
            config = StreamingConfig.load_from_env()
            assert config.max_interval_ms == 10000

    def test_overrides_burst_threshold_from_env(self):
        """Test that STREAMING_BURST_THRESHOLD overrides default."""
        with patch.dict(os.environ, {"STREAMING_BURST_THRESHOLD": "100"}):
            config = StreamingConfig.load_from_env()
            assert config.burst_threshold == 100

    def test_overrides_all_from_env(self):
        """Test that all env vars can override defaults."""
        env_vars = {
            "STREAMING_MIN_INTERVAL_MS": "200",
            "STREAMING_MAX_INTERVAL_MS": "8000",
            "STREAMING_BURST_THRESHOLD": "75",
        }
        with patch.dict(os.environ, env_vars):
            config = StreamingConfig.load_from_env()
            
            assert config.min_interval_ms == 200
            assert config.max_interval_ms == 8000
            assert config.burst_threshold == 75

    def test_uses_default_for_invalid_min_interval(self):
        """Test that invalid min_interval falls back to default."""
        with patch.dict(os.environ, {"STREAMING_MIN_INTERVAL_MS": "invalid"}):
            config = StreamingConfig.load_from_env()
            assert config.min_interval_ms == 500

    def test_uses_default_for_negative_min_interval(self):
        """Test that negative min_interval falls back to default."""
        with patch.dict(os.environ, {"STREAMING_MIN_INTERVAL_MS": "-100"}):
            config = StreamingConfig.load_from_env()
            assert config.min_interval_ms == 500

    def test_uses_default_for_zero_min_interval(self):
        """Test that zero min_interval falls back to default."""
        with patch.dict(os.environ, {"STREAMING_MIN_INTERVAL_MS": "0"}):
            config = StreamingConfig.load_from_env()
            assert config.min_interval_ms == 500

    def test_corrects_max_less_than_min(self):
        """Test that max < min is corrected to max = min."""
        env_vars = {
            "STREAMING_MIN_INTERVAL_MS": "1000",
            "STREAMING_MAX_INTERVAL_MS": "500",
        }
        with patch.dict(os.environ, env_vars):
            config = StreamingConfig.load_from_env()
            # Should set max to min
            assert config.max_interval_ms == 1000


# =============================================================================
# Tests for StreamingUpdateScheduler - Time-Based Updates
# =============================================================================


class TestSchedulerTimeBased:
    """Tests for time-based update triggers."""

    def test_does_not_update_before_min_interval(self, fast_scheduler):
        """Test that no update is triggered before min_interval."""
        # Immediately after creation, min interval hasn't passed
        # (unless first_check triggers)
        fast_scheduler._first_check = False  # Skip first update logic
        
        # Should not update with 0 events
        assert fast_scheduler.should_send_update(0) is False
        
        # Should not update with 1 event if not enough time passed
        # (Note: we just created scheduler, so < 100ms has passed)
        assert fast_scheduler.should_send_update(1) is False

    def test_updates_after_min_interval_with_events(self, fast_config):
        """Test that update triggers after min_interval with new events."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False  # Skip first update logic
        
        # Simulate time passing
        scheduler._last_update_time = time.monotonic() - 0.2  # 200ms ago
        scheduler._last_update_events = 0
        
        # Now with 1 event and enough time, should update
        assert scheduler.should_send_update(1) is True
        assert scheduler.get_update_reason() == UpdateReason.TIME_THRESHOLD

    def test_does_not_update_at_min_interval_without_events(self, fast_config):
        """Test that no update if min_interval passed but no new events."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        # Simulate time passing
        scheduler._last_update_time = time.monotonic() - 0.2  # 200ms ago
        scheduler._last_update_events = 5  # Already processed 5 events
        
        # Min interval passed but no new events (still at 5)
        assert scheduler.should_send_update(5) is False
        
        # With max interval (keepalive) it would update
        scheduler._last_update_time = time.monotonic() - 1.0  # 1000ms ago (> 500ms max)
        assert scheduler.should_send_update(5) is True
        assert scheduler.get_update_reason() == UpdateReason.KEEPALIVE


# =============================================================================
# Tests for StreamingUpdateScheduler - Burst Protection
# =============================================================================


class TestSchedulerBurstProtection:
    """Tests for burst protection behavior."""

    def test_updates_at_burst_threshold_regardless_of_time(self, fast_config):
        """Test that burst threshold triggers update even if min_interval not reached."""
        scheduler = StreamingUpdateScheduler(fast_config)  # burst_threshold=10
        scheduler._first_check = False
        
        # Set last update to now (no time has passed)
        scheduler._last_update_time = time.monotonic()
        scheduler._last_update_events = 0
        
        # 9 events - should not trigger (below threshold)
        assert scheduler.should_send_update(9) is False
        
        # 10 events - should trigger burst protection
        assert scheduler.should_send_update(10) is True
        assert scheduler.get_update_reason() == UpdateReason.BURST_PROTECTION

    def test_burst_threshold_counts_from_last_update(self, fast_config):
        """Test that burst threshold counts events since last update."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        # Mark update at 50 events
        scheduler._last_update_time = time.monotonic()
        scheduler._last_update_events = 50
        
        # 55 events total (5 new) - should not trigger
        assert scheduler.should_send_update(55) is False
        
        # 60 events total (10 new) - should trigger burst
        assert scheduler.should_send_update(60) is True
        assert scheduler.get_update_reason() == UpdateReason.BURST_PROTECTION


# =============================================================================
# Tests for StreamingUpdateScheduler - Keepalive
# =============================================================================


class TestSchedulerKeepalive:
    """Tests for keepalive behavior during long operations."""

    def test_updates_at_max_interval_regardless_of_events(self, fast_config):
        """Test that max_interval triggers update even with no new events."""
        scheduler = StreamingUpdateScheduler(fast_config)  # max_interval=500ms
        scheduler._first_check = False
        
        # Set last update to 600ms ago
        scheduler._last_update_time = time.monotonic() - 0.6
        scheduler._last_update_events = 5
        
        # Same event count - but max interval passed
        assert scheduler.should_send_update(5) is True
        assert scheduler.get_update_reason() == UpdateReason.KEEPALIVE

    def test_keepalive_priority_below_time_threshold(self, fast_config):
        """Test that TIME_THRESHOLD has priority over KEEPALIVE when both apply."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        # Set last update to 600ms ago (both min and max interval exceeded)
        scheduler._last_update_time = time.monotonic() - 0.6
        scheduler._last_update_events = 5
        
        # With new events, TIME_THRESHOLD should be the reason (checked first)
        assert scheduler.should_send_update(6) is True
        assert scheduler.get_update_reason() == UpdateReason.TIME_THRESHOLD


# =============================================================================
# Tests for StreamingUpdateScheduler - First Update
# =============================================================================


class TestSchedulerFirstUpdate:
    """Tests for first update handling."""

    def test_first_event_triggers_update(self, fast_config):
        """Test that the first event triggers an immediate update."""
        scheduler = StreamingUpdateScheduler(fast_config)
        
        # First check with 0 events - should not update
        assert scheduler.should_send_update(0) is False
        
        # First check with 1 event - should trigger first update
        scheduler2 = StreamingUpdateScheduler(fast_config)
        assert scheduler2.should_send_update(1) is True
        assert scheduler2.get_update_reason() == UpdateReason.FIRST_UPDATE

    def test_first_update_clears_first_check_flag(self, fast_config):
        """Test that mark_update_sent clears the first_check flag."""
        scheduler = StreamingUpdateScheduler(fast_config)
        
        assert scheduler._first_check is True
        
        # First update
        assert scheduler.should_send_update(1) is True
        scheduler.mark_update_sent(1)
        
        assert scheduler._first_check is False

    def test_after_first_update_normal_behavior(self, fast_config):
        """Test that after first update, normal time-based behavior applies."""
        scheduler = StreamingUpdateScheduler(fast_config)
        
        # First update
        assert scheduler.should_send_update(1) is True
        scheduler.mark_update_sent(1)
        
        # Immediately after, should not update (no time passed, below burst)
        assert scheduler.should_send_update(2) is False


# =============================================================================
# Tests for StreamingUpdateScheduler - State Management
# =============================================================================


class TestSchedulerStateManagement:
    """Tests for scheduler state management."""

    def test_mark_update_sent_resets_time(self, fast_config):
        """Test that mark_update_sent resets the time tracking."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        # Set old time
        scheduler._last_update_time = time.monotonic() - 1.0
        
        # Mark update
        scheduler.mark_update_sent(10)
        
        # Time should be recent (within 50ms)
        assert scheduler.get_time_since_last_update_ms() < 50

    def test_mark_update_sent_resets_event_count(self, fast_config):
        """Test that mark_update_sent resets the event tracking."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        scheduler.mark_update_sent(100)
        
        assert scheduler._last_update_events == 100
        assert scheduler.get_events_since_last_update(105) == 5

    def test_get_update_reason_returns_correct_reason(self, fast_config):
        """Test that get_update_reason returns the reason from last check."""
        scheduler = StreamingUpdateScheduler(fast_config)
        
        # First update
        scheduler.should_send_update(1)
        assert scheduler.get_update_reason() == UpdateReason.FIRST_UPDATE
        
        scheduler.mark_update_sent(1)
        
        # Time-based update
        scheduler._last_update_time = time.monotonic() - 0.2
        scheduler.should_send_update(2)
        assert scheduler.get_update_reason() == UpdateReason.TIME_THRESHOLD

    def test_get_update_reason_str_returns_string(self, fast_config):
        """Test that get_update_reason_str returns a human-readable string."""
        scheduler = StreamingUpdateScheduler(fast_config)
        
        scheduler.should_send_update(1)
        reason_str = scheduler.get_update_reason_str()
        
        assert isinstance(reason_str, str)
        assert reason_str == "first_update"


# =============================================================================
# Tests for StreamingUpdateScheduler - Edge Cases
# =============================================================================


class TestSchedulerEdgeCases:
    """Tests for edge cases and unusual scenarios."""

    def test_rapid_events_respect_min_interval(self, fast_config):
        """Test that rapid events are rate-limited by min_interval."""
        scheduler = StreamingUpdateScheduler(fast_config)  # min_interval=100ms
        
        # First event triggers immediately
        assert scheduler.should_send_update(1) is True
        scheduler.mark_update_sent(1)
        
        updates_sent = 1
        events = 1
        
        # Simulate rapid events (below burst threshold each time)
        for _ in range(5):
            events += 1
            if scheduler.should_send_update(events):
                updates_sent += 1
                scheduler.mark_update_sent(events)
        
        # Should only have the first update (not enough time passed, below burst)
        assert updates_sent == 1

    def test_zero_events_never_triggers_time_based_update(self, fast_config):
        """Test that 0 events doesn't trigger time-based updates."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        # Even after min interval, 0 events shouldn't trigger
        scheduler._last_update_time = time.monotonic() - 0.2
        scheduler._last_update_events = 0
        
        # But keepalive should still work
        assert scheduler.should_send_update(0) is False
        
        # After max interval, keepalive triggers
        scheduler._last_update_time = time.monotonic() - 0.6
        assert scheduler.should_send_update(0) is True
        assert scheduler.get_update_reason() == UpdateReason.KEEPALIVE

    def test_scheduler_without_config_uses_defaults(self):
        """Test that scheduler with no config uses default config."""
        scheduler = StreamingUpdateScheduler()
        
        assert scheduler.config.min_interval_ms == 500
        assert scheduler.config.max_interval_ms == 5000
        assert scheduler.config.burst_threshold == 50

    def test_high_event_count_arithmetic(self, fast_config):
        """Test scheduler works correctly with high event counts."""
        scheduler = StreamingUpdateScheduler(fast_config)
        scheduler._first_check = False
        
        # Start at high count
        scheduler.mark_update_sent(1_000_000)
        
        # Should correctly calculate events since last
        assert scheduler.get_events_since_last_update(1_000_005) == 5
        
        # Burst threshold should work
        scheduler._last_update_time = time.monotonic()  # Reset time
        assert scheduler.should_send_update(1_000_010) is True
        assert scheduler.get_update_reason() == UpdateReason.BURST_PROTECTION


# =============================================================================
# Tests for UpdateReason Enum
# =============================================================================


class TestUpdateReason:
    """Tests for UpdateReason enum."""

    def test_all_reasons_have_values(self):
        """Test that all UpdateReason values are non-empty strings."""
        for reason in UpdateReason:
            assert isinstance(reason.value, str)
            assert len(reason.value) > 0

    def test_reason_values_are_unique(self):
        """Test that all UpdateReason values are unique."""
        values = [r.value for r in UpdateReason]
        assert len(values) == len(set(values))

    def test_expected_reasons_exist(self):
        """Test that expected reasons are defined."""
        expected = ["time_threshold", "burst_protection", "keepalive", "first_update", "none"]
        actual = [r.value for r in UpdateReason]
        
        for exp in expected:
            assert exp in actual, f"Expected reason '{exp}' not found"
