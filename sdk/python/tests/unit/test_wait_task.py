"""Unit tests for WaitTask."""

import pytest

from stigmer.exceptions import ValidationError
from stigmer.tasks.wait_task import WaitTask


class TestWaitTaskCreation:
    """Test WaitTask creation and validation."""

    def test_create_simple_wait_task(self):
        """Test creating a simple wait task."""
        task = WaitTask(duration="PT5S")
        
        assert task.duration == "PT5S"
        assert task.then is None

    def test_create_wait_task_minutes(self):
        """Test creating a wait task with minutes."""
        task = WaitTask(duration="PT30M")
        
        assert task.duration == "PT30M"

    def test_create_wait_task_hours(self):
        """Test creating a wait task with hours."""
        task = WaitTask(duration="PT2H")
        
        assert task.duration == "PT2H"

    def test_create_wait_task_with_then(self):
        """Test creating a wait task with flow control (then)."""
        task = WaitTask(
            duration="PT30S",
            then="checkStatus"
        )
        
        assert task.duration == "PT30S"
        assert task.then == "checkStatus"

    def test_empty_duration_raises_error(self):
        """Test that empty duration raises ValidationError."""
        with pytest.raises(ValidationError, match="duration must be a non-empty string"):
            WaitTask(duration="")

    def test_invalid_duration_format_raises_error(self):
        """Test that invalid duration format raises ValidationError."""
        with pytest.raises(ValidationError, match="duration must be in ISO-8601 format"):
            WaitTask(duration="5 seconds")

    def test_none_duration_raises_error(self):
        """Test that None duration raises ValidationError."""
        with pytest.raises(ValidationError, match="duration must be a non-empty string"):
            WaitTask(duration=None)

    def test_invalid_iso8601_format(self):
        """Test that invalid ISO-8601 format raises ValidationError."""
        with pytest.raises(ValidationError):
            WaitTask(duration="5S")  # Missing PT prefix

    def test_invalid_unit_raises_error(self):
        """Test that invalid unit raises ValidationError."""
        with pytest.raises(ValidationError):
            WaitTask(duration="PT5X")  # Invalid unit 'X'


class TestWaitTaskToDict:
    """Test WaitTask to_dict() method."""

    def test_to_dict_basic_structure(self):
        """Test basic YAML structure generation."""
        task = WaitTask(duration="PT30S")
        
        result = task.to_dict()
        
        assert "wait" in result
        assert "duration" in result["wait"]
        assert result["wait"]["duration"] == "PT30S"
        assert "then" not in result

    def test_to_dict_with_then(self):
        """Test YAML structure with flow control."""
        task = WaitTask(
            duration="PT30S",
            then="nextStep"
        )
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT30S"
        assert result["then"] == "nextStep"

    def test_to_dict_different_durations(self):
        """Test YAML generation with different durations."""
        task1 = WaitTask(duration="PT5S")
        task2 = WaitTask(duration="PT1M")
        task3 = WaitTask(duration="PT2H")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        result3 = task3.to_dict()
        
        assert result1["wait"]["duration"] == "PT5S"
        assert result2["wait"]["duration"] == "PT1M"
        assert result3["wait"]["duration"] == "PT2H"

    def test_to_dict_complete_structure(self):
        """Test complete YAML structure."""
        task = WaitTask(duration="PT30S")
        
        result = task.to_dict()
        
        assert isinstance(result["wait"], dict)
        assert isinstance(result["wait"]["duration"], str)

    def test_to_dict_complete_example(self):
        """Test complete realistic example."""
        task = WaitTask(
            duration="PT5M",
            then="retryOperation"
        )
        
        result = task.to_dict()
        
        expected = {
            "wait": {
                "duration": "PT5M"
            },
            "then": "retryOperation"
        }
        
        assert result == expected

    def test_to_dict_preserves_duration(self):
        """Test that duration is preserved exactly."""
        durations = ["PT1S", "PT30S", "PT5M", "PT1H", "PT1D"]
        
        for duration in durations:
            task = WaitTask(duration=duration)
            result = task.to_dict()
            assert result["wait"]["duration"] == duration


class TestWaitTaskExpressions:
    """Test WaitTask with different duration formats."""

    def test_seconds_duration(self):
        """Test duration in seconds."""
        task = WaitTask(duration="PT5S")
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT5S"

    def test_minutes_duration(self):
        """Test duration in minutes."""
        task = WaitTask(duration="PT30M")
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT30M"

    def test_hours_duration(self):
        """Test duration in hours."""
        task = WaitTask(duration="PT2H")
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT2H"

    def test_days_duration(self):
        """Test duration in days."""
        task = WaitTask(duration="PT1D")
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT1D"

    def test_large_numbers(self):
        """Test duration with large numbers."""
        task = WaitTask(duration="PT3600S")
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT3600S"


class TestWaitTaskIntegration:
    """Test WaitTask integration scenarios."""

    def test_rate_limiting_pattern(self):
        """Test rate limiting pattern."""
        task = WaitTask(
            duration="PT1S",
            then="makeAPICall"
        )
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT1S"
        assert result["then"] == "makeAPICall"

    def test_retry_backoff_pattern(self):
        """Test retry backoff pattern."""
        task = WaitTask(
            duration="PT30S",
            then="retryFailedOperation"
        )
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT30S"
        assert result["then"] == "retryFailedOperation"

    def test_scheduled_delay_pattern(self):
        """Test scheduled delay pattern."""
        task = WaitTask(
            duration="PT5M",
            then="checkStatus"
        )
        
        result = task.to_dict()
        
        assert result["wait"]["duration"] == "PT5M"
        assert result["then"] == "checkStatus"

    def test_multiple_wait_tasks(self):
        """Test multiple wait tasks with different durations."""
        tasks = [
            WaitTask(duration="PT1S", then="step2"),
            WaitTask(duration="PT30S", then="step3"),
            WaitTask(duration="PT5M", then="step4"),
        ]
        
        results = [t.to_dict() for t in tasks]
        
        assert results[0]["wait"]["duration"] == "PT1S"
        assert results[1]["wait"]["duration"] == "PT30S"
        assert results[2]["wait"]["duration"] == "PT5M"
