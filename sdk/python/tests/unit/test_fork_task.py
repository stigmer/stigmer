"""Unit tests for ForkTask."""

import pytest

from stigmer.tasks.fork import ForkTask
from stigmer.tasks.http import HttpTask
from stigmer.tasks.set import SetTask


class TestForkTaskCreation:
    """Test ForkTask creation and validation."""

    def test_create_simple_fork_task(self):
        """Test creating a simple fork task with two branches."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"x": 1}))],
                "branch2": [("task2", SetTask({"y": 2}))]
            }
        )
        
        assert len(task.branches) == 2
        assert "branch1" in task.branches
        assert "branch2" in task.branches
        assert len(task.branches["branch1"]) == 1
        assert len(task.branches["branch2"]) == 1
        assert task.then is None

    def test_create_fork_task_with_multiple_tasks_per_branch(self):
        """Test creating a fork task with multiple tasks in each branch."""
        task = ForkTask(
            branches={
                "emailBranch": [
                    ("sendEmail", HttpTask(method="POST", uri="https://api.example.com/email")),
                    ("logEmail", SetTask({"sent": True}))
                ],
                "smsBranch": [
                    ("sendSMS", HttpTask(method="POST", uri="https://api.example.com/sms")),
                    ("logSMS", SetTask({"sent": True}))
                ]
            }
        )
        
        assert len(task.branches["emailBranch"]) == 2
        assert len(task.branches["smsBranch"]) == 2
        assert task.branches["emailBranch"][0][0] == "sendEmail"
        assert task.branches["emailBranch"][1][0] == "logEmail"

    def test_create_fork_task_with_then(self):
        """Test creating a fork task with flow control (then)."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"done": True}))]
            },
            then="aggregateResults"
        )
        
        assert task.then == "aggregateResults"

    def test_create_fork_task_with_many_branches(self):
        """Test creating a fork task with multiple branches."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"x": 1}))],
                "branch2": [("task2", SetTask({"y": 2}))],
                "branch3": [("task3", SetTask({"z": 3}))],
                "branch4": [("task4", SetTask({"w": 4}))]
            }
        )
        
        assert len(task.branches) == 4
        assert all(name in task.branches for name in ["branch1", "branch2", "branch3", "branch4"])

    def test_empty_branches_raises_error(self):
        """Test that empty branches dict raises ValueError."""
        with pytest.raises(ValueError, match="'branches' must contain at least one branch"):
            ForkTask(branches={})

    def test_empty_branch_name_raises_error(self):
        """Test that empty branch name raises ValueError."""
        with pytest.raises(ValueError, match="branch names must be non-empty"):
            ForkTask(
                branches={
                    "": [("task1", SetTask({"x": 1}))]
                }
            )

    def test_empty_branch_task_list_raises_error(self):
        """Test that empty branch task list raises ValueError."""
        with pytest.raises(ValueError, match="branch 'branch1' must contain at least one task"):
            ForkTask(
                branches={
                    "branch1": []
                }
            )


class TestForkTaskToDict:
    """Test ForkTask to_dict() method for YAML generation."""

    def test_simple_fork_to_dict(self):
        """Test to_dict() for simple fork task."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"status": "done"}))],
                "branch2": [("task2", SetTask({"status": "done"}))]
            }
        )
        
        result = task.to_dict()
        
        assert "fork" in result
        assert "branches" in result["fork"]
        assert len(result["fork"]["branches"]) == 2
        assert "branch1" in result["fork"]["branches"]
        assert "branch2" in result["fork"]["branches"]
        
        # Check branch1 structure
        branch1 = result["fork"]["branches"]["branch1"]
        assert "do" in branch1
        assert len(branch1["do"]) == 1
        assert "task1" in branch1["do"][0]
        assert branch1["do"][0]["task1"]["set"]["status"] == "done"
        
        # Check branch2 structure
        branch2 = result["fork"]["branches"]["branch2"]
        assert "do" in branch2
        assert len(branch2["do"]) == 1
        assert "task2" in branch2["do"][0]

    def test_fork_with_http_tasks_to_dict(self):
        """Test to_dict() for fork task with HTTP tasks."""
        task = ForkTask(
            branches={
                "apiBranch": [
                    ("callApi1", HttpTask(method="POST", uri="https://api.example.com/endpoint1")),
                    ("callApi2", HttpTask(method="POST", uri="https://api.example.com/endpoint2"))
                ]
            }
        )
        
        result = task.to_dict()
        
        branch = result["fork"]["branches"]["apiBranch"]
        assert len(branch["do"]) == 2
        
        task1 = branch["do"][0]["callApi1"]
        assert task1["call"] == "http"
        assert task1["with"]["method"] == "POST"
        assert task1["with"]["endpoint"]["uri"] == "https://api.example.com/endpoint1"
        
        task2 = branch["do"][1]["callApi2"]
        assert task2["call"] == "http"
        assert task2["with"]["endpoint"]["uri"] == "https://api.example.com/endpoint2"

    def test_fork_with_multiple_branches_to_dict(self):
        """Test to_dict() for fork task with multiple branches."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"x": 1}))],
                "branch2": [("task2", SetTask({"y": 2}))],
                "branch3": [("task3", SetTask({"z": 3}))]
            }
        )
        
        result = task.to_dict()
        
        assert len(result["fork"]["branches"]) == 3
        assert all(name in result["fork"]["branches"] for name in ["branch1", "branch2", "branch3"])

    def test_fork_with_then_to_dict(self):
        """Test to_dict() includes 'then' for flow control."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"x": 1}))]
            },
            then="mergeResults"
        )
        
        result = task.to_dict()
        
        assert result["then"] == "mergeResults"

    def test_fork_without_then_to_dict(self):
        """Test to_dict() excludes 'then' when not provided."""
        task = ForkTask(
            branches={
                "branch1": [("task1", SetTask({"x": 1}))]
            }
        )
        
        result = task.to_dict()
        
        assert "then" not in result


class TestForkTaskMixedTasks:
    """Test ForkTask with various task type combinations."""

    def test_fork_with_set_and_http_tasks(self):
        """Test fork task with mixed SetTask and HttpTask."""
        task = ForkTask(
            branches={
                "branch1": [
                    ("init", SetTask({"started": True})),
                    ("callApi", HttpTask(method="GET", uri="https://api.example.com/data")),
                    ("complete", SetTask({"done": True}))
                ]
            }
        )
        
        result = task.to_dict()
        
        branch = result["fork"]["branches"]["branch1"]
        assert len(branch["do"]) == 3
        assert "set" in branch["do"][0]["init"]
        assert "call" in branch["do"][1]["callApi"]
        assert "set" in branch["do"][2]["complete"]

    def test_fork_with_different_task_types_per_branch(self):
        """Test fork task where branches have different task types."""
        task = ForkTask(
            branches={
                "setBranch": [
                    ("set1", SetTask({"value": 1})),
                    ("set2", SetTask({"value": 2}))
                ],
                "httpBranch": [
                    ("http1", HttpTask(method="GET", uri="https://api.example.com/1")),
                    ("http2", HttpTask(method="GET", uri="https://api.example.com/2"))
                ]
            }
        )
        
        result = task.to_dict()
        
        # Check setBranch has SetTasks
        set_branch = result["fork"]["branches"]["setBranch"]
        assert all("set" in task[list(task.keys())[0]] for task in set_branch["do"])
        
        # Check httpBranch has HttpTasks
        http_branch = result["fork"]["branches"]["httpBranch"]
        assert all("call" in task[list(task.keys())[0]] for task in http_branch["do"])


class TestForkTaskExpressions:
    """Test ForkTask with runtime expressions."""

    def test_fork_with_expression_in_http_body(self):
        """Test fork task with runtime expressions in HTTP task body."""
        task = ForkTask(
            branches={
                "branch1": [
                    ("sendNotification", HttpTask(
                        method="POST",
                        uri="https://api.example.com/notify",
                        body={
                            "userId": "${ $data.userId }",
                            "message": "${ $data.message }"
                        }
                    ))
                ]
            }
        )
        
        result = task.to_dict()
        
        http_task = result["fork"]["branches"]["branch1"]["do"][0]["sendNotification"]
        assert http_task["with"]["body"]["userId"] == "${ $data.userId }"
        assert http_task["with"]["body"]["message"] == "${ $data.message }"

    def test_fork_with_expression_in_set_task(self):
        """Test fork task with runtime expressions in SetTask."""
        task = ForkTask(
            branches={
                "branch1": [
                    ("compute", SetTask({
                        "result": "${ $data.value * 2 }",
                        "timestamp": "${ now() }"
                    }))
                ]
            }
        )
        
        result = task.to_dict()
        
        set_task = result["fork"]["branches"]["branch1"]["do"][0]["compute"]
        assert set_task["set"]["result"] == "${ $data.value * 2 }"
        assert set_task["set"]["timestamp"] == "${ now() }"


class TestForkTaskIntegration:
    """Integration tests for ForkTask in realistic scenarios."""

    def test_parallel_api_calls_workflow(self):
        """Test fork task for parallel API calls scenario."""
        task = ForkTask(
            branches={
                "fetchUsers": [
                    ("getUsers", HttpTask(
                        method="GET",
                        uri="https://api.example.com/users"
                    ).export_as("${ . }")),
                    ("logUserFetch", SetTask({"usersFetched": True}))
                ],
                "fetchProducts": [
                    ("getProducts", HttpTask(
                        method="GET",
                        uri="https://api.example.com/products"
                    ).export_as("${ . }")),
                    ("logProductFetch", SetTask({"productsFetched": True}))
                ],
                "fetchOrders": [
                    ("getOrders", HttpTask(
                        method="GET",
                        uri="https://api.example.com/orders"
                    ).export_as("${ . }")),
                    ("logOrderFetch", SetTask({"ordersFetched": True}))
                ]
            },
            then="aggregateData"
        )
        
        result = task.to_dict()
        
        # Validate structure
        assert len(result["fork"]["branches"]) == 3
        assert "fetchUsers" in result["fork"]["branches"]
        assert "fetchProducts" in result["fork"]["branches"]
        assert "fetchOrders" in result["fork"]["branches"]
        assert result["then"] == "aggregateData"
        
        # Validate each branch has export
        for branch_name in ["fetchUsers", "fetchProducts", "fetchOrders"]:
            branch = result["fork"]["branches"][branch_name]
            first_task = branch["do"][0]
            task_name = list(first_task.keys())[0]
            assert "export" in first_task[task_name]
            assert first_task[task_name]["export"]["as"] == "${ . }"

    def test_multi_channel_notification_workflow(self):
        """Test fork task for multi-channel notifications."""
        task = ForkTask(
            branches={
                "emailChannel": [
                    ("sendEmail", HttpTask(
                        method="POST",
                        uri="https://api.example.com/email",
                        body={
                            "to": "${ $data.user.email }",
                            "subject": "Notification",
                            "body": "${ $data.message }"
                        }
                    )),
                    ("logEmail", SetTask({"emailSent": True}))
                ],
                "smsChannel": [
                    ("sendSMS", HttpTask(
                        method="POST",
                        uri="https://api.example.com/sms",
                        body={
                            "to": "${ $data.user.phone }",
                            "message": "${ $data.message }"
                        }
                    )),
                    ("logSMS", SetTask({"smsSent": True}))
                ],
                "pushChannel": [
                    ("sendPush", HttpTask(
                        method="POST",
                        uri="https://api.example.com/push",
                        body={
                            "deviceId": "${ $data.user.deviceId }",
                            "message": "${ $data.message }"
                        }
                    )),
                    ("logPush", SetTask({"pushSent": True}))
                ]
            },
            then="notificationComplete"
        )
        
        result = task.to_dict()
        
        # Validate all channels present
        assert len(result["fork"]["branches"]) == 3
        assert all(channel in result["fork"]["branches"] 
                  for channel in ["emailChannel", "smsChannel", "pushChannel"])
        
        # Validate each channel has 2 tasks
        for branch in result["fork"]["branches"].values():
            assert len(branch["do"]) == 2
