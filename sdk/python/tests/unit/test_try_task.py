"""Unit tests for TryTask."""

import pytest

from stigmer.tasks.http import HttpTask
from stigmer.tasks.set import SetTask
from stigmer.tasks.try_task import TryTask


class TestTryTaskCreation:
    """Test TryTask creation and validation."""

    def test_create_simple_try_task(self):
        """Test creating a simple try task."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"trying": True}))],
            catch_as="error",
            catch_tasks=[("handle", SetTask({"caught": True}))]
        )
        
        assert len(task.try_tasks) == 1
        assert task.try_tasks[0][0] == "attempt"
        assert isinstance(task.try_tasks[0][1], SetTask)
        assert task.catch_as == "error"
        assert len(task.catch_tasks) == 1
        assert task.catch_tasks[0][0] == "handle"
        assert task.then is None

    def test_create_try_task_with_multiple_try_tasks(self):
        """Test creating a try task with multiple tasks in try block."""
        task = TryTask(
            try_tasks=[
                ("step1", SetTask({"started": True})),
                ("step2", HttpTask(method="GET", uri="https://api.example.com/data")),
                ("step3", SetTask({"completed": True}))
            ],
            catch_as="error",
            catch_tasks=[("handle", SetTask({"failed": True}))]
        )
        
        assert len(task.try_tasks) == 3
        assert task.try_tasks[0][0] == "step1"
        assert task.try_tasks[1][0] == "step2"
        assert task.try_tasks[2][0] == "step3"

    def test_create_try_task_with_multiple_catch_tasks(self):
        """Test creating a try task with multiple tasks in catch block."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"trying": True}))],
            catch_as="err",
            catch_tasks=[
                ("logError", SetTask({"logged": True})),
                ("notifyAdmin", HttpTask(method="POST", uri="https://api.example.com/notify"))
            ]
        )
        
        assert task.catch_as == "err"
        assert len(task.catch_tasks) == 2
        assert task.catch_tasks[0][0] == "logError"
        assert task.catch_tasks[1][0] == "notifyAdmin"

    def test_create_try_task_with_then(self):
        """Test creating a try task with flow control (then)."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"x": 1}))],
            catch_as="error",
            catch_tasks=[("handle", SetTask({"y": 2}))],
            then="finalizeOperation"
        )
        
        assert task.then == "finalizeOperation"

    def test_empty_try_tasks_raises_error(self):
        """Test that empty try_tasks list raises ValueError."""
        with pytest.raises(ValueError, match="'try_tasks' must contain at least one task"):
            TryTask(
                try_tasks=[],
                catch_as="error",
                catch_tasks=[("handle", SetTask({"x": 1}))]
            )

    def test_empty_catch_as_raises_error(self):
        """Test that empty catch_as parameter raises ValueError."""
        with pytest.raises(ValueError, match="'catch_as' parameter must be non-empty"):
            TryTask(
                try_tasks=[("attempt", SetTask({"x": 1}))],
                catch_as="",
                catch_tasks=[("handle", SetTask({"y": 1}))]
            )

    def test_empty_catch_tasks_raises_error(self):
        """Test that empty catch_tasks list raises ValueError."""
        with pytest.raises(ValueError, match="'catch_tasks' must contain at least one task"):
            TryTask(
                try_tasks=[("attempt", SetTask({"x": 1}))],
                catch_as="error",
                catch_tasks=[]
            )


class TestTryTaskToDict:
    """Test TryTask to_dict() method for YAML generation."""

    def test_simple_try_to_dict(self):
        """Test to_dict() for simple try task."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"trying": True}))],
            catch_as="error",
            catch_tasks=[("handle", SetTask({"caught": True}))]
        )
        
        result = task.to_dict()
        
        assert "try" in result
        assert isinstance(result["try"], list)
        assert len(result["try"]) == 1
        assert "attempt" in result["try"][0]
        assert result["try"][0]["attempt"]["set"]["trying"] is True
        
        assert "catch" in result
        assert result["catch"]["as"] == "error"
        assert "do" in result["catch"]
        assert len(result["catch"]["do"]) == 1
        assert "handle" in result["catch"]["do"][0]
        assert result["catch"]["do"][0]["handle"]["set"]["caught"] is True

    def test_try_with_http_task_to_dict(self):
        """Test to_dict() for try task with HTTP task."""
        task = TryTask(
            try_tasks=[
                ("riskyCall", HttpTask(
                    method="POST",
                    uri="https://api.example.com/risky",
                    body={"action": "process"}
                ))
            ],
            catch_as="error",
            catch_tasks=[
                ("logError", HttpTask(
                    method="POST",
                    uri="https://api.example.com/log",
                    body={"error": "${ .error }"}
                ))
            ]
        )
        
        result = task.to_dict()
        
        # Check try block
        try_task = result["try"][0]["riskyCall"]
        assert try_task["call"] == "http"
        assert try_task["with"]["method"] == "POST"
        assert try_task["with"]["endpoint"]["uri"] == "https://api.example.com/risky"
        assert try_task["with"]["body"]["action"] == "process"
        
        # Check catch block
        catch_task = result["catch"]["do"][0]["logError"]
        assert catch_task["call"] == "http"
        assert catch_task["with"]["body"]["error"] == "${ .error }"

    def test_try_with_multiple_tasks_to_dict(self):
        """Test to_dict() for try task with multiple tasks in both blocks."""
        task = TryTask(
            try_tasks=[
                ("step1", SetTask({"started": True})),
                ("step2", HttpTask(method="GET", uri="https://api.example.com/data")),
                ("step3", SetTask({"completed": True}))
            ],
            catch_as="err",
            catch_tasks=[
                ("logError", SetTask({"error": "${ .err.message }"})),
                ("notifyAdmin", HttpTask(method="POST", uri="https://api.example.com/notify"))
            ]
        )
        
        result = task.to_dict()
        
        # Check try block has 3 tasks
        assert len(result["try"]) == 3
        assert "step1" in result["try"][0]
        assert "step2" in result["try"][1]
        assert "step3" in result["try"][2]
        
        # Check catch block has 2 tasks
        assert result["catch"]["as"] == "err"
        assert len(result["catch"]["do"]) == 2
        assert "logError" in result["catch"]["do"][0]
        assert "notifyAdmin" in result["catch"]["do"][1]

    def test_try_with_then_to_dict(self):
        """Test to_dict() includes 'then' for flow control."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"x": 1}))],
            catch_as="error",
            catch_tasks=[("handle", SetTask({"y": 2}))],
            then="cleanup"
        )
        
        result = task.to_dict()
        
        assert result["then"] == "cleanup"

    def test_try_without_then_to_dict(self):
        """Test to_dict() excludes 'then' when not provided."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"x": 1}))],
            catch_as="error",
            catch_tasks=[("handle", SetTask({"y": 2}))]
        )
        
        result = task.to_dict()
        
        assert "then" not in result


class TestTryTaskErrorVariableBinding:
    """Test TryTask error variable binding in catch block."""

    def test_error_variable_in_catch_body(self):
        """Test that error variable is used in catch block expressions."""
        task = TryTask(
            try_tasks=[("attempt", HttpTask(method="POST", uri="https://api.example.com/data"))],
            catch_as="error",
            catch_tasks=[
                ("logError", HttpTask(
                    method="POST",
                    uri="https://api.example.com/log",
                    body={
                        "message": "${ .error.message }",
                        "code": "${ .error.code }",
                        "timestamp": "${ now() }"
                    }
                ))
            ]
        )
        
        result = task.to_dict()
        
        catch_body = result["catch"]["do"][0]["logError"]["with"]["body"]
        assert catch_body["message"] == "${ .error.message }"
        assert catch_body["code"] == "${ .error.code }"

    def test_custom_error_variable_name(self):
        """Test using custom error variable name."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"x": 1}))],
            catch_as="exception",
            catch_tasks=[("handle", SetTask({"error_msg": "${ .exception.message }"}))]
        )
        
        result = task.to_dict()
        
        assert result["catch"]["as"] == "exception"
        catch_set = result["catch"]["do"][0]["handle"]["set"]
        assert catch_set["error_msg"] == "${ .exception.message }"

    def test_error_variable_in_set_task(self):
        """Test error variable binding in SetTask."""
        task = TryTask(
            try_tasks=[("attempt", SetTask({"trying": True}))],
            catch_as="err",
            catch_tasks=[
                ("captureError", SetTask({
                    "errorMessage": "${ .err.message }",
                    "errorType": "${ .err.type }",
                    "failed": True
                }))
            ]
        )
        
        result = task.to_dict()
        
        catch_set = result["catch"]["do"][0]["captureError"]["set"]
        assert catch_set["errorMessage"] == "${ .err.message }"
        assert catch_set["errorType"] == "${ .err.type }"
        assert catch_set["failed"] is True


class TestTryTaskMixedTasks:
    """Test TryTask with various task type combinations."""

    def test_try_with_set_and_http_tasks(self):
        """Test try task with mixed SetTask and HttpTask in both blocks."""
        task = TryTask(
            try_tasks=[
                ("init", SetTask({"started": True})),
                ("callApi", HttpTask(method="POST", uri="https://api.example.com/process")),
                ("complete", SetTask({"done": True}))
            ],
            catch_as="error",
            catch_tasks=[
                ("logFailure", SetTask({"failed": True})),
                ("notifyError", HttpTask(method="POST", uri="https://api.example.com/error"))
            ]
        )
        
        result = task.to_dict()
        
        # Check try block
        assert "set" in result["try"][0]["init"]
        assert "call" in result["try"][1]["callApi"]
        assert "set" in result["try"][2]["complete"]
        
        # Check catch block
        assert "set" in result["catch"]["do"][0]["logFailure"]
        assert "call" in result["catch"]["do"][1]["notifyError"]


class TestTryTaskIntegration:
    """Integration tests for TryTask in realistic scenarios."""

    def test_api_call_with_error_handling(self):
        """Test try task for API call with comprehensive error handling."""
        task = TryTask(
            try_tasks=[
                ("prepareRequest", SetTask({
                    "endpoint": "https://api.example.com/users",
                    "timestamp": "${ now() }"
                })),
                ("makeRequest", HttpTask(
                    method="POST",
                    uri="https://api.example.com/users",
                    body={
                        "name": "${ $data.userName }",
                        "email": "${ $data.userEmail }"
                    }
                ).export_as("${ . }")),
                ("recordSuccess", SetTask({"success": True}))
            ],
            catch_as="error",
            catch_tasks=[
                ("logError", HttpTask(
                    method="POST",
                    uri="https://api.example.com/logs",
                    body={
                        "level": "ERROR",
                        "message": "${ .error.message }",
                        "code": "${ .error.code }",
                        "timestamp": "${ now() }"
                    }
                )),
                ("recordFailure", SetTask({
                    "success": False,
                    "errorMessage": "${ .error.message }"
                }))
            ],
            then="finalizeOperation"
        )
        
        result = task.to_dict()
        
        # Validate try block structure
        assert len(result["try"]) == 3
        assert "prepareRequest" in result["try"][0]
        assert "makeRequest" in result["try"][1]
        assert "recordSuccess" in result["try"][2]
        
        # Validate catch block structure
        assert result["catch"]["as"] == "error"
        assert len(result["catch"]["do"]) == 2
        assert "logError" in result["catch"]["do"][0]
        assert "recordFailure" in result["catch"]["do"][1]
        
        # Validate error variable usage
        log_body = result["catch"]["do"][0]["logError"]["with"]["body"]
        assert log_body["message"] == "${ .error.message }"
        assert log_body["code"] == "${ .error.code }"
        
        # Validate flow control
        assert result["then"] == "finalizeOperation"
        
        # Validate export in try block
        assert "export" in result["try"][1]["makeRequest"]

    def test_database_operation_with_retry_logic(self):
        """Test try task simulating database operation with error handling."""
        task = TryTask(
            try_tasks=[
                ("connectDB", SetTask({"dbConnected": True})),
                ("executeQuery", HttpTask(
                    method="POST",
                    uri="https://api.example.com/db/query",
                    body={
                        "query": "${ $data.sqlQuery }",
                        "params": "${ $data.queryParams }"
                    }
                ).export_as("${ . }")),
                ("closeConnection", SetTask({"dbClosed": True}))
            ],
            catch_as="dbError",
            catch_tasks=[
                ("logDBError", SetTask({
                    "errorType": "DATABASE_ERROR",
                    "errorMessage": "${ .dbError.message }",
                    "query": "${ $data.sqlQuery }"
                })),
                ("notifyDBA", HttpTask(
                    method="POST",
                    uri="https://api.example.com/notify/dba",
                    body={
                        "alert": "Database operation failed",
                        "error": "${ .dbError }",
                        "severity": "HIGH"
                    }
                ))
            ]
        )
        
        result = task.to_dict()
        
        # Validate complete structure
        assert len(result["try"]) == 3
        assert result["catch"]["as"] == "dbError"
        assert len(result["catch"]["do"]) == 2
        
        # Validate error handling uses correct variable
        notify_body = result["catch"]["do"][1]["notifyDBA"]["with"]["body"]
        assert notify_body["error"] == "${ .dbError }"
