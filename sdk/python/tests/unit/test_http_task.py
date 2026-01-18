"""Unit tests for HttpTask."""

import pytest

from stigmer.tasks.http import HttpTask


class TestHttpTaskCreation:
    """Test HttpTask initialization."""

    def test_http_task_get_basic(self):
        """Test creating a basic GET request."""
        task = HttpTask(method="GET", uri="https://api.example.com/data")
        
        assert task.method == "GET"
        assert task.uri == "https://api.example.com/data"
        assert task.body is None
        assert task.headers is None
        assert task.then is None

    def test_http_task_post_with_body(self):
        """Test creating a POST request with body."""
        body = {"userId": 123, "message": "Hello"}
        task = HttpTask(
            method="POST",
            uri="https://api.example.com/messages",
            body=body
        )
        
        assert task.method == "POST"
        assert task.body == body

    def test_http_task_with_headers(self):
        """Test creating request with custom headers."""
        headers = {"Authorization": "Bearer token123", "X-Custom": "value"}
        task = HttpTask(
            method="GET",
            uri="https://api.example.com/data",
            headers=headers
        )
        
        assert task.headers == headers

    def test_http_task_with_then(self):
        """Test creating request with flow control."""
        task = HttpTask(
            method="GET",
            uri="https://api.example.com/data",
            then="nextTask"
        )
        
        assert task.then == "nextTask"

    def test_http_method_case_insensitive(self):
        """Test HTTP method is normalized to uppercase."""
        task = HttpTask(method="get", uri="https://api.example.com/data")
        assert task.method == "GET"
        
        task = HttpTask(method="Post", uri="https://api.example.com/data")
        assert task.method == "POST"

    def test_invalid_http_method(self):
        """Test that invalid HTTP methods raise ValueError."""
        with pytest.raises(ValueError, match="Invalid HTTP method"):
            HttpTask(method="INVALID", uri="https://api.example.com/data")
        
        with pytest.raises(ValueError, match="Invalid HTTP method"):
            HttpTask(method="HEAD", uri="https://api.example.com/data")

    def test_all_valid_http_methods(self):
        """Test all valid HTTP methods are accepted."""
        valid_methods = ["GET", "POST", "PUT", "DELETE", "PATCH"]
        
        for method in valid_methods:
            task = HttpTask(method=method, uri="https://api.example.com/data")
            assert task.method == method


class TestHttpTaskToDict:
    """Test HttpTask to_dict() conversion."""

    def test_to_dict_get_simple(self):
        """Test GET request conversion to dictionary."""
        task = HttpTask(method="GET", uri="https://api.example.com/posts/7")
        result = task.to_dict()
        
        assert result == {
            "call": "http",
            "with": {
                "method": "GET",
                "endpoint": {
                    "uri": "https://api.example.com/posts/7"
                }
            }
        }

    def test_to_dict_post_with_body(self):
        """Test POST request with body conversion."""
        task = HttpTask(
            method="POST",
            uri="https://api.example.com/posts",
            body={
                "category": "premium",
                "userId": "${ $context.userId }",
                "message": "Test message"
            }
        )
        result = task.to_dict()
        
        assert result["call"] == "http"
        assert result["with"]["method"] == "POST"
        assert result["with"]["body"]["category"] == "premium"
        assert result["with"]["body"]["userId"] == "${ $context.userId }"

    def test_to_dict_with_headers(self):
        """Test request with headers conversion."""
        task = HttpTask(
            method="GET",
            uri="https://api.example.com/data",
            headers={
                "Authorization": "Bearer token123",
                "Content-Type": "application/json"
            }
        )
        result = task.to_dict()
        
        assert "headers" in result["with"]
        assert result["with"]["headers"]["Authorization"] == "Bearer token123"
        assert result["with"]["headers"]["Content-Type"] == "application/json"

    def test_to_dict_with_export(self):
        """Test request with export expression."""
        task = HttpTask(method="GET", uri="https://api.example.com/data")
        task.export_as("${ . }")
        result = task.to_dict()
        
        assert "export" in result
        assert result["export"]["as"] == "${ . }"

    def test_to_dict_with_then(self):
        """Test request with flow control."""
        task = HttpTask(
            method="GET",
            uri="https://api.example.com/data",
            then="processData"
        )
        result = task.to_dict()
        
        assert result["then"] == "processData"

    def test_to_dict_with_all_options(self):
        """Test request with all optional parameters."""
        task = HttpTask(
            method="POST",
            uri="https://api.example.com/data",
            body={"key": "value"},
            headers={"Authorization": "Bearer token"},
            then="nextTask"
        )
        task.export_as("${ .data }")
        result = task.to_dict()
        
        assert result["call"] == "http"
        assert result["with"]["method"] == "POST"
        assert result["with"]["body"] == {"key": "value"}
        assert result["with"]["headers"]["Authorization"] == "Bearer token"
        assert result["export"]["as"] == "${ .data }"
        assert result["then"] == "nextTask"


class TestHttpTaskExportAs:
    """Test HttpTask export_as() method."""

    def test_export_as_returns_self(self):
        """Test export_as() returns self for method chaining."""
        task = HttpTask(method="GET", uri="https://api.example.com/data")
        result = task.export_as("${ . }")
        
        assert result is task

    def test_export_as_sets_expression(self):
        """Test export_as() sets the export expression."""
        task = HttpTask(method="GET", uri="https://api.example.com/data")
        task.export_as("${ .data.items }")
        
        assert task._export == "${ .data.items }"

    def test_export_as_chainable(self):
        """Test export_as() can be chained with constructor."""
        task = HttpTask(method="GET", uri="https://api.example.com/data").export_as("${ . }")
        
        assert task._export == "${ . }"
        assert task.method == "GET"


class TestHttpTaskExpressions:
    """Test HttpTask with runtime expressions."""

    def test_uri_with_expression(self):
        """Test URI can contain runtime expressions."""
        task = HttpTask(
            method="GET",
            uri="https://api.example.com/users/${ $data.userId }"
        )
        result = task.to_dict()
        
        assert result["with"]["endpoint"]["uri"] == "https://api.example.com/users/${ $data.userId }"

    def test_body_with_expressions(self):
        """Test body can contain runtime expressions."""
        task = HttpTask(
            method="POST",
            uri="https://api.example.com/posts",
            body={
                "userId": "${ $data.userId }",
                "postId": "${ $context.id }",
                "staticValue": "constant"
            }
        )
        result = task.to_dict()
        
        assert result["with"]["body"]["userId"] == "${ $data.userId }"
        assert result["with"]["body"]["postId"] == "${ $context.id }"
        assert result["with"]["body"]["staticValue"] == "constant"
