"""Unit tests for ListenTask."""

import pytest

from stigmer.exceptions import ValidationError
from stigmer.tasks.listen_task import ListenTask


class TestListenTaskCreation:
    """Test ListenTask creation and validation."""

    def test_create_simple_listen_task(self):
        """Test creating a simple listen task."""
        task = ListenTask(
            event_id="approval_signal",
            event_type="signal"
        )
        
        assert task.event_id == "approval_signal"
        assert task.event_type == "signal"
        assert task.then is None

    def test_create_listen_task_with_event_type(self):
        """Test creating a listen task with event type."""
        task = ListenTask(
            event_id="user_registered",
            event_type="event"
        )
        
        assert task.event_id == "user_registered"
        assert task.event_type == "event"

    def test_create_listen_task_with_then(self):
        """Test creating a listen task with flow control (then)."""
        task = ListenTask(
            event_id="approval_signal",
            event_type="signal",
            then="processApproval"
        )
        
        assert task.event_id == "approval_signal"
        assert task.event_type == "signal"
        assert task.then == "processApproval"

    def test_empty_event_id_raises_error(self):
        """Test that empty event_id raises ValidationError."""
        with pytest.raises(ValidationError, match="event_id must be a non-empty string"):
            ListenTask(event_id="", event_type="signal")

    def test_invalid_event_type_raises_error(self):
        """Test that invalid event_type raises ValidationError."""
        with pytest.raises(ValidationError, match='event_type must be either "signal" or "event"'):
            ListenTask(event_id="test", event_type="invalid")

    def test_none_event_id_raises_error(self):
        """Test that None event_id raises ValidationError."""
        with pytest.raises(ValidationError, match="event_id must be a non-empty string"):
            ListenTask(event_id=None, event_type="signal")


class TestListenTaskToDict:
    """Test ListenTask to_dict() method."""

    def test_to_dict_basic_structure(self):
        """Test basic YAML structure generation."""
        task = ListenTask(
            event_id="approval_signal",
            event_type="signal"
        )
        
        result = task.to_dict()
        
        assert "listen" in result
        assert "to" in result["listen"]
        assert "one" in result["listen"]["to"]
        assert "with" in result["listen"]["to"]["one"]
        assert result["listen"]["to"]["one"]["with"]["id"] == "approval_signal"
        assert result["listen"]["to"]["one"]["with"]["type"] == "signal"
        assert "then" not in result

    def test_to_dict_with_then(self):
        """Test YAML structure with flow control."""
        task = ListenTask(
            event_id="approval_signal",
            event_type="signal",
            then="processApproval"
        )
        
        result = task.to_dict()
        
        assert result["listen"]["to"]["one"]["with"]["id"] == "approval_signal"
        assert result["listen"]["to"]["one"]["with"]["type"] == "signal"
        assert result["then"] == "processApproval"

    def test_to_dict_with_event_type(self):
        """Test YAML structure with event type."""
        task = ListenTask(
            event_id="user_registered",
            event_type="event"
        )
        
        result = task.to_dict()
        
        assert result["listen"]["to"]["one"]["with"]["id"] == "user_registered"
        assert result["listen"]["to"]["one"]["with"]["type"] == "event"

    def test_to_dict_nested_structure(self):
        """Test complete nested YAML structure."""
        task = ListenTask(
            event_id="approval_signal",
            event_type="signal",
            then="next"
        )
        
        result = task.to_dict()
        
        # Verify nested structure
        assert isinstance(result["listen"], dict)
        assert isinstance(result["listen"]["to"], dict)
        assert isinstance(result["listen"]["to"]["one"], dict)
        assert isinstance(result["listen"]["to"]["one"]["with"], dict)

    def test_to_dict_different_event_ids(self):
        """Test YAML generation with different event IDs."""
        task1 = ListenTask(event_id="approval_signal", event_type="signal")
        task2 = ListenTask(event_id="payment_complete", event_type="event")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        
        assert result1["listen"]["to"]["one"]["with"]["id"] == "approval_signal"
        assert result2["listen"]["to"]["one"]["with"]["id"] == "payment_complete"

    def test_to_dict_complete_example(self):
        """Test complete realistic example."""
        task = ListenTask(
            event_id="onboarding_approval",
            event_type="signal",
            then="finalizeOnboarding"
        )
        
        result = task.to_dict()
        
        expected = {
            "listen": {
                "to": {
                    "one": {
                        "with": {
                            "id": "onboarding_approval",
                            "type": "signal"
                        }
                    }
                }
            },
            "then": "finalizeOnboarding"
        }
        
        assert result == expected


class TestListenTaskExpressions:
    """Test ListenTask with runtime expressions."""

    def test_event_id_with_expression(self):
        """Test event_id can contain runtime expressions."""
        task = ListenTask(
            event_id="${ $data.signalId }",
            event_type="signal"
        )
        
        result = task.to_dict()
        
        assert result["listen"]["to"]["one"]["with"]["id"] == "${ $data.signalId }"

    def test_complex_event_id(self):
        """Test complex event_id values."""
        task = ListenTask(
            event_id="approval_signal_${.userId}_${.timestamp}",
            event_type="signal"
        )
        
        result = task.to_dict()
        
        assert "approval_signal_" in result["listen"]["to"]["one"]["with"]["id"]

    def test_event_types_preserved(self):
        """Test that event types are preserved exactly."""
        task_signal = ListenTask(event_id="test", event_type="signal")
        task_event = ListenTask(event_id="test", event_type="event")
        
        assert task_signal.to_dict()["listen"]["to"]["one"]["with"]["type"] == "signal"
        assert task_event.to_dict()["listen"]["to"]["one"]["with"]["type"] == "event"


class TestListenTaskIntegration:
    """Test ListenTask integration scenarios."""

    def test_workflow_approval_pattern(self):
        """Test realistic approval workflow pattern."""
        task = ListenTask(
            event_id="manager_approval",
            event_type="signal",
            then="processApprovalResult"
        )
        
        result = task.to_dict()
        
        assert result["listen"]["to"]["one"]["with"]["id"] == "manager_approval"
        assert result["then"] == "processApprovalResult"

    def test_event_driven_workflow(self):
        """Test event-driven workflow pattern."""
        task = ListenTask(
            event_id="payment_received",
            event_type="event",
            then="fulfillOrder"
        )
        
        result = task.to_dict()
        
        assert result["listen"]["to"]["one"]["with"]["id"] == "payment_received"
        assert result["listen"]["to"]["one"]["with"]["type"] == "event"
        assert result["then"] == "fulfillOrder"

    def test_multiple_signal_types(self):
        """Test that both signal and event types work correctly."""
        signals = [
            ListenTask(event_id="signal1", event_type="signal"),
            ListenTask(event_id="event1", event_type="event"),
        ]
        
        results = [s.to_dict() for s in signals]
        
        assert results[0]["listen"]["to"]["one"]["with"]["type"] == "signal"
        assert results[1]["listen"]["to"]["one"]["with"]["type"] == "event"
