"""Unit tests for RaiseTask."""

import pytest

from stigmer.exceptions import ValidationError
from stigmer.tasks.raise_task import RaiseTask


class TestRaiseTaskCreation:
    """Test RaiseTask creation and validation."""

    def test_create_simple_raise_task(self):
        """Test creating a simple raise task."""
        task = RaiseTask(
            error_type="ValidationError",
            status=400,
            title="Invalid Input",
            detail="userId is required"
        )
        
        assert task.error_type == "ValidationError"
        assert task.status == 400
        assert task.title == "Invalid Input"
        assert task.detail == "userId is required"
        assert task.then is None

    def test_create_raise_task_with_then(self):
        """Test creating a raise task with flow control (then)."""
        task = RaiseTask(
            error_type="BusinessError",
            status=422,
            title="Rule Violation",
            detail="Insufficient balance",
            then="handleError"
        )
        
        assert task.error_type == "BusinessError"
        assert task.status == 422
        assert task.then == "handleError"

    def test_create_raise_task_server_error(self):
        """Test creating a raise task with server error status."""
        task = RaiseTask(
            error_type="InternalError",
            status=500,
            title="Server Error",
            detail="Database connection failed"
        )
        
        assert task.status == 500
        assert task.error_type == "InternalError"

    def test_empty_error_type_raises_error(self):
        """Test that empty error_type raises ValidationError."""
        with pytest.raises(ValidationError, match="error_type must be a non-empty string"):
            RaiseTask(error_type="", status=400, title="Error", detail="Detail")

    def test_invalid_status_type_raises_error(self):
        """Test that invalid status type raises ValidationError."""
        with pytest.raises(ValidationError, match="status must be an integer"):
            RaiseTask(error_type="Error", status="400", title="Error", detail="Detail")

    def test_empty_title_raises_error(self):
        """Test that empty title raises ValidationError."""
        with pytest.raises(ValidationError, match="title must be a non-empty string"):
            RaiseTask(error_type="Error", status=400, title="", detail="Detail")

    def test_empty_detail_raises_error(self):
        """Test that empty detail raises ValidationError."""
        with pytest.raises(ValidationError, match="detail must be a non-empty string"):
            RaiseTask(error_type="Error", status=400, title="Error", detail="")

    def test_none_error_type_raises_error(self):
        """Test that None error_type raises ValidationError."""
        with pytest.raises(ValidationError, match="error_type must be a non-empty string"):
            RaiseTask(error_type=None, status=400, title="Error", detail="Detail")


class TestRaiseTaskToDict:
    """Test RaiseTask to_dict() method."""

    def test_to_dict_basic_structure(self):
        """Test basic YAML structure generation."""
        task = RaiseTask(
            error_type="ValidationError",
            status=400,
            title="Invalid Input",
            detail="userId is required"
        )
        
        result = task.to_dict()
        
        assert "raise" in result
        assert "error" in result["raise"]
        assert result["raise"]["error"]["type"] == "ValidationError"
        assert result["raise"]["error"]["status"] == 400
        assert result["raise"]["error"]["title"] == "Invalid Input"
        assert result["raise"]["error"]["detail"] == "userId is required"
        assert "then" not in result

    def test_to_dict_with_then(self):
        """Test YAML structure with flow control."""
        task = RaiseTask(
            error_type="BusinessError",
            status=422,
            title="Rule Violation",
            detail="Insufficient balance",
            then="errorHandler"
        )
        
        result = task.to_dict()
        
        assert result["raise"]["error"]["type"] == "BusinessError"
        assert result["raise"]["error"]["status"] == 422
        assert result["then"] == "errorHandler"

    def test_to_dict_different_status_codes(self):
        """Test YAML generation with different status codes."""
        task1 = RaiseTask(error_type="E1", status=400, title="T", detail="D")
        task2 = RaiseTask(error_type="E2", status=404, title="T", detail="D")
        task3 = RaiseTask(error_type="E3", status=500, title="T", detail="D")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        result3 = task3.to_dict()
        
        assert result1["raise"]["error"]["status"] == 400
        assert result2["raise"]["error"]["status"] == 404
        assert result3["raise"]["error"]["status"] == 500

    def test_to_dict_complete_structure(self):
        """Test complete YAML structure."""
        task = RaiseTask(
            error_type="ValidationError",
            status=400,
            title="Invalid Input",
            detail="userId is required"
        )
        
        result = task.to_dict()
        
        assert isinstance(result["raise"], dict)
        assert isinstance(result["raise"]["error"], dict)

    def test_to_dict_complete_example(self):
        """Test complete realistic example."""
        task = RaiseTask(
            error_type="AuthorizationError",
            status=403,
            title="Access Denied",
            detail="User does not have permission to access this resource",
            then="redirectToLogin"
        )
        
        result = task.to_dict()
        
        expected = {
            "raise": {
                "error": {
                    "type": "AuthorizationError",
                    "status": 403,
                    "title": "Access Denied",
                    "detail": "User does not have permission to access this resource"
                }
            },
            "then": "redirectToLogin"
        }
        
        assert result == expected

    def test_to_dict_preserves_all_fields(self):
        """Test that all fields are preserved exactly."""
        task = RaiseTask(
            error_type="CustomError",
            status=418,  # I'm a teapot
            title="Custom Title",
            detail="Custom Detail"
        )
        
        result = task.to_dict()
        
        assert result["raise"]["error"]["type"] == "CustomError"
        assert result["raise"]["error"]["status"] == 418
        assert result["raise"]["error"]["title"] == "Custom Title"
        assert result["raise"]["error"]["detail"] == "Custom Detail"


class TestRaiseTaskExpressions:
    """Test RaiseTask with runtime expressions."""

    def test_error_type_with_expression(self):
        """Test error_type can contain runtime expressions."""
        task = RaiseTask(
            error_type="${ $data.errorType }",
            status=400,
            title="Dynamic Error",
            detail="Error details"
        )
        
        result = task.to_dict()
        
        assert result["raise"]["error"]["type"] == "${ $data.errorType }"

    def test_detail_with_expression(self):
        """Test detail can contain runtime expressions."""
        task = RaiseTask(
            error_type="ValidationError",
            status=400,
            title="Invalid Input",
            detail="Field ${ $data.fieldName } is required"
        )
        
        result = task.to_dict()
        
        assert "${ $data.fieldName }" in result["raise"]["error"]["detail"]

    def test_title_with_expression(self):
        """Test title can contain runtime expressions."""
        task = RaiseTask(
            error_type="Error",
            status=400,
            title="Error: ${ $data.errorCode }",
            detail="An error occurred"
        )
        
        result = task.to_dict()
        
        assert "${ $data.errorCode }" in result["raise"]["error"]["title"]


class TestRaiseTaskIntegration:
    """Test RaiseTask integration scenarios."""

    def test_input_validation_pattern(self):
        """Test input validation error pattern."""
        task = RaiseTask(
            error_type="ValidationError",
            status=400,
            title="Invalid Input",
            detail="Email address is required but was not provided"
        )
        
        result = task.to_dict()
        
        assert result["raise"]["error"]["type"] == "ValidationError"
        assert result["raise"]["error"]["status"] == 400

    def test_business_rule_violation_pattern(self):
        """Test business rule violation pattern."""
        task = RaiseTask(
            error_type="BusinessRuleError",
            status=422,
            title="Insufficient Balance",
            detail="Account balance must be at least $100 to complete this transaction"
        )
        
        result = task.to_dict()
        
        assert result["raise"]["error"]["type"] == "BusinessRuleError"
        assert result["raise"]["error"]["status"] == 422

    def test_authorization_error_pattern(self):
        """Test authorization error pattern."""
        task = RaiseTask(
            error_type="AuthorizationError",
            status=403,
            title="Access Denied",
            detail="User does not have admin privileges"
        )
        
        result = task.to_dict()
        
        assert result["raise"]["error"]["status"] == 403
        assert "Access Denied" in result["raise"]["error"]["title"]

    def test_multiple_error_scenarios(self):
        """Test multiple error scenarios."""
        errors = [
            RaiseTask(error_type="ValidationError", status=400, title="Bad Request", detail="Invalid input"),
            RaiseTask(error_type="NotFoundError", status=404, title="Not Found", detail="Resource not found"),
            RaiseTask(error_type="ServerError", status=500, title="Server Error", detail="Internal error"),
        ]
        
        results = [e.to_dict() for e in errors]
        
        assert results[0]["raise"]["error"]["status"] == 400
        assert results[1]["raise"]["error"]["status"] == 404
        assert results[2]["raise"]["error"]["status"] == 500
