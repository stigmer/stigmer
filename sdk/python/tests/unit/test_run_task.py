"""Unit tests for RunTask."""

import pytest

from stigmer.exceptions import ValidationError
from stigmer.tasks.run_task import RunTask


class TestRunTaskCreation:
    """Test RunTask creation and validation."""

    def test_create_simple_run_task(self):
        """Test creating a simple run task."""
        task = RunTask(
            workflow_id="data-processor",
            workflow_version="1.0.0"
        )
        
        assert task.workflow_id == "data-processor"
        assert task.workflow_version == "1.0.0"
        assert task.with_params == {}
        assert task.then is None

    def test_create_run_task_with_params(self):
        """Test creating a run task with parameters."""
        task = RunTask(
            workflow_id="data-processor",
            workflow_version="1.0.0",
            with_params={"userId": "${ $data.userId }", "mode": "batch"}
        )
        
        assert task.workflow_id == "data-processor"
        assert task.workflow_version == "1.0.0"
        assert task.with_params == {"userId": "${ $data.userId }", "mode": "batch"}

    def test_create_run_task_with_then(self):
        """Test creating a run task with flow control (then)."""
        task = RunTask(
            workflow_id="data-processor",
            workflow_version="1.0.0",
            then="processResults"
        )
        
        assert task.workflow_id == "data-processor"
        assert task.workflow_version == "1.0.0"
        assert task.then == "processResults"

    def test_empty_workflow_id_raises_error(self):
        """Test that empty workflow_id raises ValidationError."""
        with pytest.raises(ValidationError, match="workflow_id must be a non-empty string"):
            RunTask(workflow_id="", workflow_version="1.0.0")

    def test_empty_workflow_version_raises_error(self):
        """Test that empty workflow_version raises ValidationError."""
        with pytest.raises(ValidationError, match="workflow_version must be a non-empty string"):
            RunTask(workflow_id="test", workflow_version="")

    def test_none_workflow_id_raises_error(self):
        """Test that None workflow_id raises ValidationError."""
        with pytest.raises(ValidationError, match="workflow_id must be a non-empty string"):
            RunTask(workflow_id=None, workflow_version="1.0.0")

    def test_invalid_with_params_type_raises_error(self):
        """Test that invalid with_params type raises ValidationError."""
        with pytest.raises(ValidationError, match="with_params must be a dictionary"):
            RunTask(workflow_id="test", workflow_version="1.0.0", with_params="invalid")


class TestRunTaskToDict:
    """Test RunTask to_dict() method."""

    def test_to_dict_basic_structure(self):
        """Test basic YAML structure generation."""
        task = RunTask(
            workflow_id="data-processor",
            workflow_version="1.0.0"
        )
        
        result = task.to_dict()
        
        assert "run" in result
        assert "subflow" in result["run"]
        assert result["run"]["subflow"]["id"] == "data-processor"
        assert result["run"]["subflow"]["version"] == "1.0.0"
        assert "with" not in result
        assert "then" not in result

    def test_to_dict_with_params(self):
        """Test YAML structure with parameters."""
        task = RunTask(
            workflow_id="data-processor",
            workflow_version="1.0.0",
            with_params={"userId": "${ $data.userId }"}
        )
        
        result = task.to_dict()
        
        assert result["run"]["subflow"]["id"] == "data-processor"
        assert result["with"]["userId"] == "${ $data.userId }"

    def test_to_dict_with_then(self):
        """Test YAML structure with flow control."""
        task = RunTask(
            workflow_id="data-processor",
            workflow_version="1.0.0",
            then="processResults"
        )
        
        result = task.to_dict()
        
        assert result["run"]["subflow"]["id"] == "data-processor"
        assert result["then"] == "processResults"

    def test_to_dict_complete_example(self):
        """Test complete realistic example."""
        task = RunTask(
            workflow_id="user-registration",
            workflow_version="2.1.0",
            with_params={
                "email": "${ $data.email }",
                "firstName": "${ $data.firstName }",
                "lastName": "${ $data.lastName }"
            },
            then="sendWelcomeEmail"
        )
        
        result = task.to_dict()
        
        expected = {
            "run": {
                "subflow": {
                    "id": "user-registration",
                    "version": "2.1.0"
                }
            },
            "with": {
                "email": "${ $data.email }",
                "firstName": "${ $data.firstName }",
                "lastName": "${ $data.lastName }"
            },
            "then": "sendWelcomeEmail"
        }
        
        assert result == expected

    def test_to_dict_empty_params(self):
        """Test YAML structure with empty params."""
        task = RunTask(
            workflow_id="simple-workflow",
            workflow_version="1.0.0",
            with_params={}
        )
        
        result = task.to_dict()
        
        # Empty params should not be included
        assert "with" not in result

    def test_to_dict_different_versions(self):
        """Test YAML generation with different versions."""
        task1 = RunTask(workflow_id="wf", workflow_version="1.0.0")
        task2 = RunTask(workflow_id="wf", workflow_version="2.0.0")
        task3 = RunTask(workflow_id="wf", workflow_version="1.5.3")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        result3 = task3.to_dict()
        
        assert result1["run"]["subflow"]["version"] == "1.0.0"
        assert result2["run"]["subflow"]["version"] == "2.0.0"
        assert result3["run"]["subflow"]["version"] == "1.5.3"


class TestRunTaskExpressions:
    """Test RunTask with runtime expressions."""

    def test_params_with_expressions(self):
        """Test with_params can contain runtime expressions."""
        task = RunTask(
            workflow_id="processor",
            workflow_version="1.0.0",
            with_params={
                "userId": "${ $data.userId }",
                "timestamp": "${ $context.start.time }"
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["userId"] == "${ $data.userId }"
        assert result["with"]["timestamp"] == "${ $context.start.time }"

    def test_complex_params(self):
        """Test complex parameter structures."""
        task = RunTask(
            workflow_id="processor",
            workflow_version="1.0.0",
            with_params={
                "user": {
                    "id": "${ $data.userId }",
                    "email": "${ $data.email }"
                },
                "options": {
                    "async": True,
                    "timeout": 30
                }
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["user"]["id"] == "${ $data.userId }"
        assert result["with"]["options"]["async"] is True

    def test_array_params(self):
        """Test array parameters."""
        task = RunTask(
            workflow_id="processor",
            workflow_version="1.0.0",
            with_params={
                "items": ["${ $data.item1 }", "${ $data.item2 }"]
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["items"] == ["${ $data.item1 }", "${ $data.item2 }"]


class TestRunTaskIntegration:
    """Test RunTask integration scenarios."""

    def test_workflow_composition_pattern(self):
        """Test workflow composition pattern."""
        task = RunTask(
            workflow_id="email-sender",
            workflow_version="1.0.0",
            with_params={
                "to": "${ $data.userEmail }",
                "subject": "Welcome!",
                "body": "${ $data.emailBody }"
            },
            then="logEmailSent"
        )
        
        result = task.to_dict()
        
        assert result["run"]["subflow"]["id"] == "email-sender"
        assert result["with"]["to"] == "${ $data.userEmail }"
        assert result["then"] == "logEmailSent"

    def test_nested_workflow_pattern(self):
        """Test nested workflow pattern."""
        task = RunTask(
            workflow_id="order-fulfillment",
            workflow_version="2.0.0",
            with_params={
                "orderId": "${ $data.orderId }",
                "priority": "high"
            }
        )
        
        result = task.to_dict()
        
        assert result["run"]["subflow"]["id"] == "order-fulfillment"
        assert result["with"]["priority"] == "high"

    def test_modular_workflow_design(self):
        """Test modular workflow design pattern."""
        workflows = [
            RunTask("auth-check", "1.0.0", {"userId": "${ $data.userId }"}),
            RunTask("data-validation", "1.0.0", {"data": "${ $data.input }"}),
            RunTask("business-logic", "1.0.0", {"validated": True}),
        ]
        
        results = [w.to_dict() for w in workflows]
        
        assert results[0]["run"]["subflow"]["id"] == "auth-check"
        assert results[1]["run"]["subflow"]["id"] == "data-validation"
        assert results[2]["run"]["subflow"]["id"] == "business-logic"

    def test_multiple_subworkflows(self):
        """Test calling multiple subworkflows."""
        task1 = RunTask("wf1", "1.0.0", then="step2")
        task2 = RunTask("wf2", "2.0.0", with_params={"x": 1}, then="step3")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        
        assert result1["run"]["subflow"]["id"] == "wf1"
        assert result2["run"]["subflow"]["id"] == "wf2"
        assert result2["with"]["x"] == 1
