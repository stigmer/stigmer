"""Unit tests for GrpcTask."""

import pytest

from stigmer.exceptions import ValidationError
from stigmer.tasks.grpc_task import GrpcTask


class TestGrpcTaskCreation:
    """Test GrpcTask creation and validation."""

    def test_create_simple_grpc_task(self):
        """Test creating a simple gRPC task."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser"
        )
        
        assert task.service == "user.UserService"
        assert task.method == "GetUser"
        assert task.arguments == {}
        assert task.then is None

    def test_create_grpc_task_with_arguments(self):
        """Test creating a gRPC task with arguments."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser",
            arguments={"userId": "${ $data.userId }"}
        )
        
        assert task.service == "user.UserService"
        assert task.method == "GetUser"
        assert task.arguments == {"userId": "${ $data.userId }"}

    def test_create_grpc_task_with_then(self):
        """Test creating a gRPC task with flow control (then)."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser",
            then="processUser"
        )
        
        assert task.service == "user.UserService"
        assert task.method == "GetUser"
        assert task.then == "processUser"

    def test_empty_service_raises_error(self):
        """Test that empty service raises ValidationError."""
        with pytest.raises(ValidationError, match="service must be a non-empty string"):
            GrpcTask(service="", method="GetUser")

    def test_empty_method_raises_error(self):
        """Test that empty method raises ValidationError."""
        with pytest.raises(ValidationError, match="method must be a non-empty string"):
            GrpcTask(service="user.UserService", method="")

    def test_none_service_raises_error(self):
        """Test that None service raises ValidationError."""
        with pytest.raises(ValidationError, match="service must be a non-empty string"):
            GrpcTask(service=None, method="GetUser")

    def test_invalid_arguments_type_raises_error(self):
        """Test that invalid arguments type raises ValidationError."""
        with pytest.raises(ValidationError, match="arguments must be a dictionary"):
            GrpcTask(service="user.UserService", method="GetUser", arguments="invalid")


class TestGrpcTaskToDict:
    """Test GrpcTask to_dict() method."""

    def test_to_dict_basic_structure(self):
        """Test basic YAML structure generation."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser"
        )
        
        result = task.to_dict()
        
        assert result["call"] == "grpc"
        assert "with" in result
        assert result["with"]["service"] == "user.UserService"
        assert result["with"]["method"] == "GetUser"
        assert "arguments" not in result["with"]
        assert "then" not in result

    def test_to_dict_with_arguments(self):
        """Test YAML structure with arguments."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser",
            arguments={"userId": "${ $data.userId }"}
        )
        
        result = task.to_dict()
        
        assert result["call"] == "grpc"
        assert result["with"]["service"] == "user.UserService"
        assert result["with"]["method"] == "GetUser"
        assert result["with"]["arguments"]["userId"] == "${ $data.userId }"

    def test_to_dict_with_then(self):
        """Test YAML structure with flow control."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser",
            then="processUser"
        )
        
        result = task.to_dict()
        
        assert result["call"] == "grpc"
        assert result["with"]["service"] == "user.UserService"
        assert result["then"] == "processUser"

    def test_to_dict_complete_example(self):
        """Test complete realistic example."""
        task = GrpcTask(
            service="order.OrderService",
            method="CreateOrder",
            arguments={
                "customerId": "${ $data.customerId }",
                "items": "${ $data.items }",
                "total": "${ $data.total }"
            },
            then="confirmOrder"
        )
        
        result = task.to_dict()
        
        expected = {
            "call": "grpc",
            "with": {
                "service": "order.OrderService",
                "method": "CreateOrder",
                "arguments": {
                    "customerId": "${ $data.customerId }",
                    "items": "${ $data.items }",
                    "total": "${ $data.total }"
                }
            },
            "then": "confirmOrder"
        }
        
        assert result == expected

    def test_to_dict_empty_arguments(self):
        """Test YAML structure with empty arguments."""
        task = GrpcTask(
            service="health.HealthService",
            method="Check",
            arguments={}
        )
        
        result = task.to_dict()
        
        # Empty arguments should not be included
        assert "arguments" not in result["with"]

    def test_to_dict_different_services(self):
        """Test YAML generation with different services."""
        task1 = GrpcTask(service="user.UserService", method="GetUser")
        task2 = GrpcTask(service="order.OrderService", method="CreateOrder")
        task3 = GrpcTask(service="payment.PaymentService", method="ProcessPayment")
        
        result1 = task1.to_dict()
        result2 = task2.to_dict()
        result3 = task3.to_dict()
        
        assert result1["with"]["service"] == "user.UserService"
        assert result2["with"]["service"] == "order.OrderService"
        assert result3["with"]["service"] == "payment.PaymentService"


class TestGrpcTaskExpressions:
    """Test GrpcTask with runtime expressions."""

    def test_arguments_with_expressions(self):
        """Test arguments can contain runtime expressions."""
        task = GrpcTask(
            service="user.UserService",
            method="GetUser",
            arguments={
                "userId": "${ $data.userId }",
                "timestamp": "${ $context.start.time }"
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["arguments"]["userId"] == "${ $data.userId }"
        assert result["with"]["arguments"]["timestamp"] == "${ $context.start.time }"

    def test_complex_arguments(self):
        """Test complex argument structures."""
        task = GrpcTask(
            service="order.OrderService",
            method="CreateOrder",
            arguments={
                "customer": {
                    "id": "${ $data.customerId }",
                    "email": "${ $data.email }"
                },
                "items": [
                    {"id": 1, "quantity": 2},
                    {"id": 2, "quantity": 1}
                ],
                "metadata": {
                    "source": "web",
                    "timestamp": "${ $context.start.time }"
                }
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["arguments"]["customer"]["id"] == "${ $data.customerId }"
        assert len(result["with"]["arguments"]["items"]) == 2
        assert result["with"]["arguments"]["metadata"]["source"] == "web"

    def test_array_arguments(self):
        """Test array arguments."""
        task = GrpcTask(
            service="batch.BatchService",
            method="ProcessBatch",
            arguments={
                "items": ["${ $data.item1 }", "${ $data.item2 }", "${ $data.item3 }"]
            }
        )
        
        result = task.to_dict()
        
        assert result["with"]["arguments"]["items"] == [
            "${ $data.item1 }",
            "${ $data.item2 }",
            "${ $data.item3 }"
        ]


class TestGrpcTaskIntegration:
    """Test GrpcTask integration scenarios."""

    def test_microservice_communication_pattern(self):
        """Test microservice communication pattern."""
        task = GrpcTask(
            service="inventory.InventoryService",
            method="CheckStock",
            arguments={
                "productId": "${ $data.productId }",
                "quantity": "${ $data.quantity }"
            },
            then="validateStock"
        )
        
        result = task.to_dict()
        
        assert result["call"] == "grpc"
        assert result["with"]["service"] == "inventory.InventoryService"
        assert result["with"]["method"] == "CheckStock"
        assert result["then"] == "validateStock"

    def test_service_mesh_integration(self):
        """Test service mesh integration pattern."""
        task = GrpcTask(
            service="auth.AuthService",
            method="ValidateToken",
            arguments={
                "token": "${ $data.authToken }"
            },
            then="authorizeRequest"
        )
        
        result = task.to_dict()
        
        assert result["with"]["service"] == "auth.AuthService"
        assert result["with"]["arguments"]["token"] == "${ $data.authToken }"

    def test_multiple_grpc_calls(self):
        """Test multiple gRPC calls in sequence."""
        tasks = [
            GrpcTask("user.UserService", "GetUser", {"id": "1"}),
            GrpcTask("order.OrderService", "GetOrders", {"userId": "${ $context.getUser.id }"}),
            GrpcTask("payment.PaymentService", "GetPayments", {"orderId": "${ $context.getOrders.id }"}),
        ]
        
        results = [t.to_dict() for t in tasks]
        
        assert results[0]["with"]["service"] == "user.UserService"
        assert results[1]["with"]["service"] == "order.OrderService"
        assert results[2]["with"]["service"] == "payment.PaymentService"

    def test_health_check_pattern(self):
        """Test health check pattern."""
        task = GrpcTask(
            service="health.HealthService",
            method="Check",
            arguments={}
        )
        
        result = task.to_dict()
        
        assert result["call"] == "grpc"
        assert result["with"]["service"] == "health.HealthService"
        assert result["with"]["method"] == "Check"
        assert "arguments" not in result["with"]
