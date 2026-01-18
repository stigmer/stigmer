"""Unit tests for CallActivityTask."""

import pytest

from stigmer.exceptions import ValidationError
from stigmer.tasks.call_activity_task import CallActivityTask


class TestCallActivityTaskCreation:
    """Test CallActivityTask creation and validation."""

    def test_create_simple_call_activity_task(self):
        """Test creating a simple call activity task."""
        task = CallActivityTask(activity_name="DataProcessor")
        
        assert task.activity_name == "DataProcessor"
        assert task.with_params == {}
        assert task.then is None

    def test_create_call_activity_task_with_params(self):
        """Test creating a call activity task with parameters."""
        task = CallActivityTask(
            activity_name="DataProcessor",
            with_params={"data": "${ $data.rawData }"}
        )
        
        assert task.activity_name == "DataProcessor"
        assert task.with_params == {"data": "${ $data.rawData }"}

    def test_create_call_activity_task_with_then(self):
        """Test creating a call activity task with flow control (then)."""
        task = CallActivityTask(
            activity_name="DataProcessor",
            then="finalizeProcessing"
        )
        
        assert task.activity_name == "DataProcessor"
        assert task.then == "finalizeProcessing"

    def test_empty_activity_name_raises_error(self):
        """Test that empty activity_name raises ValidationError."""
        with pytest.raises(ValidationError, match="activity_name must be a non-empty string"):
            CallActivityTask(activity_name="")

    def test_none_activity_name_raises_error(self):
        """Test that None activity_name raises ValidationError."""
        with pytest.raises(ValidationError, match="activity_name must be a non-empty string"):
            CallActivityTask(activity_name=None)

    def test_invalid_with_params_type_raises_error(self):
        """Test that invalid with_params type raises ValidationError."""
        with pytest.raises(ValidationError, match="with_params must be a dictionary"):
            CallActivityTask(activity_name="DataProcessor", with_params="invalid")


class TestCallActivityTaskToDict:
    """Test CallActivityTask to_dict() method."""

    def test_to_dict_basic_structure(self):
        """Test basic YAML structure generation."""
        task = CallActivityTask(activity_name="DataProcessor")
        
        result = task.to_dict()
        
        assert result["call"] == "activity"
        assert "with" in result
        assert result["with"]["activityName"] == "DataProcessor"
        assert "input" not in result["with"]
        assert "then" not in result

    def test_to_dict_with_params(self):
        """Test YAML structure with parameters."""
        task = CallActivityTask(
            activity_name="DataProcessor",
            with_params={"data": "${ $data.rawData }"}
        )
        
        result = task.to_dict()
        
        assert result["call"] == "activity"
        assert result["with"]["activityName"] == "DataProcessor"
        assert result["with"]["input"]["data"] == "${ $data.rawData }"

    def test_to_dict_with_then(self):
        """Test YAML structure with flow control."""
        task = CallActivityTask(
            activity_name="DataProcessor",
            then="finalizeProcessing"
        )
        
        result = task.to_dict()
        
        assert result["call"] == "activity"
        assert result["with"]["activityName"] == "DataProcessor"
        assert result["then"] == "finalizeProcessing"

    def test_to_dict_complete_example(self):
        """Test complete realistic example."""
        task = CallActivityTask(
            activity_name="EmailSender",
            with_params={
                "to": "${ $data.userEmail }",
                "subject": "Welcome!",
                "body": "${ $data.emailBody }",
                "priority": "high"
            },
            then="logEmailSent"
        )
        
        result = task.to_dict()
        
        expected = {
            "call": "activity",
            "with": {
                "activityName": "EmailSender",
                "input": {
                    "to": "${ $data.userEmail }",
                    "subject": "Welcome!",
                    "body": "${ $data.emailBody }",
                    "priority": "high"
                }
            },
            "then": "logEmailSent"
        }
        
        assert result == expected

    def test_to_dict_empty_params(self):
        """Test YAML structure with empty params."""
        task = CallActivityTask(
            activity_name="SimpleActivity",
            with_params={}
        )
        
        result = task.to_dict()
        
        # Empty params should not be included
        assert "input" not in result["with"]

    def test_to_dict_different_activities(self):
        """Test YAML generation with different activities."""
        task1 = CallActivityTask(activity_name="DataProcessor")
        task2 = CallActivityTask(activity_name="EmailSender")
        task3 = CallActivityTask(activity_name="FileUploader")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        result3 = task3.to_dict()
        
        assert result1["with"]["activityName"] == "DataProcessor"
        assert result2["with"]["activityName"] == "EmailSender"
        assert result3["with"]["activityName"] == "FileUploader"


class TestCallActivityTaskExpressions:
    """Test CallActivityTask with runtime expressions."""

    def test_params_with_expressions(self):
        """Test with_params can contain runtime expressions."""
        task = CallActivityTask(
            activity_name="DataProcessor",
            with_params={
                "data": "${ $data.rawData }",
                "timestamp": "${ $context.start.time }"
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["input"]["data"] == "${ $data.rawData }"
        assert result["with"]["input"]["timestamp"] == "${ $context.start.time }"

    def test_complex_params(self):
        """Test complex parameter structures."""
        task = CallActivityTask(
            activity_name="OrderProcessor",
            with_params={
                "order": {
                    "id": "${ $data.orderId }",
                    "items": "${ $data.items }"
                },
                "customer": {
                    "id": "${ $data.customerId }",
                    "email": "${ $data.email }"
                },
                "options": {
                    "async": True,
                    "timeout": 30
                }
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["input"]["order"]["id"] == "${ $data.orderId }"
        assert result["with"]["input"]["customer"]["id"] == "${ $data.customerId }"
        assert result["with"]["input"]["options"]["async"] is True

    def test_array_params(self):
        """Test array parameters."""
        task = CallActivityTask(
            activity_name="BatchProcessor",
            with_params={
                "items": ["${ $data.item1 }", "${ $data.item2 }", "${ $data.item3 }"]
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["input"]["items"] == [
            "${ $data.item1 }",
            "${ $data.item2 }",
            "${ $data.item3 }"
        ]


class TestCallActivityTaskIntegration:
    """Test CallActivityTask integration scenarios."""

    def test_temporal_activity_pattern(self):
        """Test Temporal activity pattern."""
        task = CallActivityTask(
            activity_name="SendEmail",
            with_params={
                "to": "${ $data.recipientEmail }",
                "subject": "Order Confirmation",
                "body": "Your order has been confirmed"
            },
            then="updateEmailStatus"
        )
        
        result = task.to_dict()
        
        assert result["call"] == "activity"
        assert result["with"]["activityName"] == "SendEmail"
        assert result["with"]["input"]["to"] == "${ $data.recipientEmail }"
        assert result["then"] == "updateEmailStatus"

    def test_long_running_operation_pattern(self):
        """Test long-running operation pattern."""
        task = CallActivityTask(
            activity_name="ProcessLargeDataset",
            with_params={
                "datasetId": "${ $data.datasetId }",
                "processingMode": "batch",
                "chunkSize": 1000
            },
            then="notifyCompletion"
        )
        
        result = task.to_dict()
        
        assert result["with"]["activityName"] == "ProcessLargeDataset"
        assert result["with"]["input"]["processingMode"] == "batch"
        assert result["then"] == "notifyCompletion"

    def test_external_system_integration(self):
        """Test external system integration pattern."""
        task = CallActivityTask(
            activity_name="SyncToExternalSystem",
            with_params={
                "entityId": "${ $data.entityId }",
                "entityType": "user",
                "syncMode": "full"
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["activityName"] == "SyncToExternalSystem"
        assert result["with"]["input"]["entityType"] == "user"

    def test_multiple_activities(self):
        """Test calling multiple activities."""
        activities = [
            CallActivityTask("ValidateData", {"data": "${ $data.input }"}),
            CallActivityTask("TransformData", {"validated": "${ $context.validate.result }"}),
            CallActivityTask("SaveData", {"transformed": "${ $context.transform.result }"}),
        ]
        
        results = [a.to_dict() for a in activities]
        
        assert results[0]["with"]["activityName"] == "ValidateData"
        assert results[1]["with"]["activityName"] == "TransformData"
        assert results[2]["with"]["activityName"] == "SaveData"

    def test_activity_chaining_pattern(self):
        """Test activity chaining pattern."""
        task1 = CallActivityTask("Step1", {"input": "${ $data.initial }"}, then="step2")
        task2 = CallActivityTask("Step2", {"input": "${ $context.step1.output }"}, then="step3")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        
        assert result1["with"]["activityName"] == "Step1"
        assert result1["then"] == "step2"
        assert result2["with"]["activityName"] == "Step2"
        assert result2["then"] == "step3"
