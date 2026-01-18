"""Unit tests for ForTask."""

import pytest

from stigmer.tasks.for_task import ForTask
from stigmer.tasks.http import HttpTask
from stigmer.tasks.set import SetTask


class TestForTaskCreation:
    """Test ForTask creation and validation."""

    def test_create_simple_for_task(self):
        """Test creating a simple for task with one nested task."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[("step1", SetTask({"processed": True}))]
        )
        
        assert task.each == "item"
        assert task.in_collection == "${ $data.items }"
        assert len(task.do) == 1
        assert task.do[0][0] == "step1"
        assert isinstance(task.do[0][1], SetTask)
        assert task.then is None

    def test_create_for_task_with_multiple_tasks(self):
        """Test creating a for task with multiple nested tasks."""
        task = ForTask(
            each="user",
            in_collection="${ $data.users }",
            do=[
                ("validateUser", SetTask({"validated": True})),
                ("notifyUser", HttpTask(method="POST", uri="https://api.example.com/notify"))
            ]
        )
        
        assert task.each == "user"
        assert task.in_collection == "${ $data.users }"
        assert len(task.do) == 2
        assert task.do[0][0] == "validateUser"
        assert task.do[1][0] == "notifyUser"

    def test_create_for_task_with_then(self):
        """Test creating a for task with flow control (then)."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[("step1", SetTask({"done": True}))],
            then="finalizeResults"
        )
        
        assert task.then == "finalizeResults"

    def test_empty_each_raises_error(self):
        """Test that empty 'each' parameter raises ValueError."""
        with pytest.raises(ValueError, match="'each' parameter must be non-empty"):
            ForTask(
                each="",
                in_collection="${ $data.items }",
                do=[("step1", SetTask({"x": 1}))]
            )

    def test_empty_in_collection_raises_error(self):
        """Test that empty 'in_collection' parameter raises ValueError."""
        with pytest.raises(ValueError, match="'in_collection' parameter must be non-empty"):
            ForTask(
                each="item",
                in_collection="",
                do=[("step1", SetTask({"x": 1}))]
            )

    def test_empty_do_raises_error(self):
        """Test that empty 'do' list raises ValueError."""
        with pytest.raises(ValueError, match="'do' must contain at least one task"):
            ForTask(
                each="item",
                in_collection="${ $data.items }",
                do=[]
            )


class TestForTaskToDict:
    """Test ForTask to_dict() method for YAML generation."""

    def test_simple_for_to_dict(self):
        """Test to_dict() for simple for task."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[("processItem", SetTask({"status": "processed"}))]
        )
        
        result = task.to_dict()
        
        assert "for" in result
        assert result["for"]["each"] == "item"
        assert result["for"]["in"] == "${ $data.items }"
        assert "do" in result
        assert len(result["do"]) == 1
        assert "processItem" in result["do"][0]
        assert result["do"][0]["processItem"]["set"]["status"] == "processed"

    def test_for_with_http_task_to_dict(self):
        """Test to_dict() for for task with HTTP task."""
        task = ForTask(
            each="user",
            in_collection="${ $data.users }",
            do=[
                ("sendEmail", HttpTask(
                    method="POST",
                    uri="https://api.example.com/email",
                    body={"userId": "${ $data.user.id }"}
                ))
            ]
        )
        
        result = task.to_dict()
        
        assert result["for"]["each"] == "user"
        assert result["for"]["in"] == "${ $data.users }"
        assert len(result["do"]) == 1
        assert "sendEmail" in result["do"][0]
        
        http_task = result["do"][0]["sendEmail"]
        assert http_task["call"] == "http"
        assert http_task["with"]["method"] == "POST"
        assert http_task["with"]["endpoint"]["uri"] == "https://api.example.com/email"
        assert http_task["with"]["body"]["userId"] == "${ $data.user.id }"

    def test_for_with_multiple_tasks_to_dict(self):
        """Test to_dict() for for task with multiple nested tasks."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[
                ("initialize", SetTask({"started": True})),
                ("process", HttpTask(method="POST", uri="https://api.example.com/process")),
                ("finalize", SetTask({"completed": True}))
            ]
        )
        
        result = task.to_dict()
        
        assert len(result["do"]) == 3
        assert "initialize" in result["do"][0]
        assert "process" in result["do"][1]
        assert "finalize" in result["do"][2]

    def test_for_with_then_to_dict(self):
        """Test to_dict() includes 'then' for flow control."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[("step1", SetTask({"x": 1}))],
            then="aggregateResults"
        )
        
        result = task.to_dict()
        
        assert result["then"] == "aggregateResults"

    def test_for_without_then_to_dict(self):
        """Test to_dict() excludes 'then' when not provided."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[("step1", SetTask({"x": 1}))]
        )
        
        result = task.to_dict()
        
        assert "then" not in result


class TestForTaskExpressions:
    """Test ForTask with runtime expressions."""

    def test_expression_in_collection(self):
        """Test that in_collection expression is preserved as-is."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[("step1", SetTask({"x": 1}))]
        )
        
        result = task.to_dict()
        
        assert result["for"]["in"] == "${ $data.items }"

    def test_complex_expression_in_collection(self):
        """Test complex expression in in_collection."""
        task = ForTask(
            each="user",
            in_collection="${ $data.users | filter(.active == true) }",
            do=[("step1", SetTask({"x": 1}))]
        )
        
        result = task.to_dict()
        
        assert result["for"]["in"] == "${ $data.users | filter(.active == true) }"

    def test_nested_task_with_expressions(self):
        """Test nested tasks can use loop variable in expressions."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[
                ("processItem", HttpTask(
                    method="POST",
                    uri="https://api.example.com/process",
                    body={
                        "itemId": "${ $data.item.id }",
                        "itemName": "${ $data.item.name }"
                    }
                ))
            ]
        )
        
        result = task.to_dict()
        
        http_body = result["do"][0]["processItem"]["with"]["body"]
        assert http_body["itemId"] == "${ $data.item.id }"
        assert http_body["itemName"] == "${ $data.item.name }"


class TestForTaskNested:
    """Test ForTask with various nested task combinations."""

    def test_for_with_set_tasks(self):
        """Test for task with multiple SetTask instances."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[
                ("step1", SetTask({"counter": "${ $data.counter + 1 }"})),
                ("step2", SetTask({"processed": True}))
            ]
        )
        
        result = task.to_dict()
        
        assert len(result["do"]) == 2
        assert result["do"][0]["step1"]["set"]["counter"] == "${ $data.counter + 1 }"
        assert result["do"][1]["step2"]["set"]["processed"] is True

    def test_for_with_http_tasks(self):
        """Test for task with multiple HttpTask instances."""
        task = ForTask(
            each="user",
            in_collection="${ $data.users }",
            do=[
                ("fetchProfile", HttpTask(method="GET", uri="https://api.example.com/profile")),
                ("updateStatus", HttpTask(method="PUT", uri="https://api.example.com/status"))
            ]
        )
        
        result = task.to_dict()
        
        assert len(result["do"]) == 2
        assert result["do"][0]["fetchProfile"]["call"] == "http"
        assert result["do"][1]["updateStatus"]["call"] == "http"

    def test_for_with_mixed_tasks(self):
        """Test for task with mixed task types."""
        task = ForTask(
            each="item",
            in_collection="${ $data.items }",
            do=[
                ("initialize", SetTask({"itemStarted": True})),
                ("callApi", HttpTask(
                    method="POST",
                    uri="https://api.example.com/items",
                    body={"item": "${ $data.item }"}
                )),
                ("finalize", SetTask({"itemCompleted": True}))
            ]
        )
        
        result = task.to_dict()
        
        assert len(result["do"]) == 3
        assert "set" in result["do"][0]["initialize"]
        assert "call" in result["do"][1]["callApi"]
        assert "set" in result["do"][2]["finalize"]


class TestForTaskIntegration:
    """Integration tests for ForTask in realistic scenarios."""

    def test_complete_for_workflow(self):
        """Test complete for task workflow structure."""
        task = ForTask(
            each="order",
            in_collection="${ $data.orders }",
            do=[
                ("validateOrder", SetTask({
                    "orderId": "${ $data.order.id }",
                    "validated": True
                })),
                ("processPayment", HttpTask(
                    method="POST",
                    uri="https://api.example.com/payments",
                    body={
                        "orderId": "${ $data.order.id }",
                        "amount": "${ $data.order.total }"
                    }
                )),
                ("sendConfirmation", HttpTask(
                    method="POST",
                    uri="https://api.example.com/notifications",
                    body={
                        "email": "${ $data.order.email }",
                        "message": "Order confirmed"
                    }
                ))
            ],
            then="summarizeOrders"
        )
        
        result = task.to_dict()
        
        # Validate structure
        assert result["for"]["each"] == "order"
        assert result["for"]["in"] == "${ $data.orders }"
        assert len(result["do"]) == 3
        assert result["then"] == "summarizeOrders"
        
        # Validate nested tasks
        assert "validateOrder" in result["do"][0]
        assert "processPayment" in result["do"][1]
        assert "sendConfirmation" in result["do"][2]
