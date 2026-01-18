"""Unit tests for SwitchTask and SwitchCase."""

import pytest

from stigmer.tasks.switch import SwitchCase, SwitchTask


class TestSwitchCaseCreation:
    """Test SwitchCase initialization."""

    def test_switch_case_with_condition(self):
        """Test creating a case with a condition."""
        case = SwitchCase("premiumUser", "${ $context.tier == 'premium' }", "premiumFlow")
        
        assert case.name == "premiumUser"
        assert case.when == "${ $context.tier == 'premium' }"
        assert case.then == "premiumFlow"

    def test_switch_case_default(self):
        """Test creating a default case (no condition)."""
        case = SwitchCase("defaultCase", None, "fallbackFlow")
        
        assert case.name == "defaultCase"
        assert case.when is None
        assert case.then == "fallbackFlow"


class TestSwitchCaseToDict:
    """Test SwitchCase to_dict() conversion."""

    def test_to_dict_with_condition(self):
        """Test case with condition conversion."""
        case = SwitchCase("highValue", "${ $context.userId > 5 }", "highValueTask")
        result = case.to_dict()
        
        assert result == {
            "highValue": {
                "when": "${ $context.userId > 5 }",
                "then": "highValueTask"
            }
        }

    def test_to_dict_default_case(self):
        """Test default case conversion (no 'when' field)."""
        case = SwitchCase("defaultCase", None, "fallbackTask")
        result = case.to_dict()
        
        assert result == {
            "defaultCase": {
                "then": "fallbackTask"
            }
        }
        # Verify 'when' is not present
        assert "when" not in result["defaultCase"]

    def test_to_dict_complex_expression(self):
        """Test case with complex condition expression."""
        case = SwitchCase(
            "complexCase",
            "${ $context.user.age >= 18 && $context.user.verified == true }",
            "adultVerifiedFlow"
        )
        result = case.to_dict()
        
        assert result["complexCase"]["when"] == "${ $context.user.age >= 18 && $context.user.verified == true }"
        assert result["complexCase"]["then"] == "adultVerifiedFlow"


class TestSwitchTaskCreation:
    """Test SwitchTask initialization."""

    def test_switch_task_basic(self):
        """Test creating a basic switch task."""
        cases = [
            SwitchCase("case1", "${ x > 5 }", "task1"),
            SwitchCase("case2", "${ x <= 5 }", "task2")
        ]
        task = SwitchTask(cases)
        
        assert len(task.cases) == 2
        assert task.cases[0].name == "case1"
        assert task.cases[1].name == "case2"

    def test_switch_task_with_default(self):
        """Test creating switch task with default case."""
        cases = [
            SwitchCase("case1", "${ x > 5 }", "task1"),
            SwitchCase("defaultCase", None, "fallback")
        ]
        task = SwitchTask(cases)
        
        assert len(task.cases) == 2
        assert task.cases[1].when is None  # Default case

    def test_switch_task_empty_cases_raises(self):
        """Test that empty cases list raises ValueError."""
        with pytest.raises(ValueError, match="requires at least one case"):
            SwitchTask([])

    def test_switch_task_single_case(self):
        """Test switch task with single case."""
        cases = [SwitchCase("onlyCase", "${ true }", "task1")]
        task = SwitchTask(cases)
        
        assert len(task.cases) == 1

    def test_switch_task_then_is_none(self):
        """Test that switch tasks don't use 'then' parameter."""
        cases = [SwitchCase("case1", "${ x > 5 }", "task1")]
        task = SwitchTask(cases)
        
        assert task.then is None


class TestSwitchTaskToDict:
    """Test SwitchTask to_dict() conversion."""

    def test_to_dict_basic(self):
        """Test basic switch task conversion."""
        cases = [
            SwitchCase("case1", "${ x > 5 }", "task1"),
            SwitchCase("case2", "${ x <= 5 }", "task2")
        ]
        task = SwitchTask(cases)
        result = task.to_dict()
        
        assert "switch" in result
        assert len(result["switch"]) == 2
        assert result["switch"][0] == {"case1": {"when": "${ x > 5 }", "then": "task1"}}
        assert result["switch"][1] == {"case2": {"when": "${ x <= 5 }", "then": "task2"}}

    def test_to_dict_with_default(self):
        """Test switch task with default case conversion."""
        cases = [
            SwitchCase("case1", "${ x > 5 }", "task1"),
            SwitchCase("defaultCase", None, "fallback")
        ]
        task = SwitchTask(cases)
        result = task.to_dict()
        
        # First case has 'when'
        assert "when" in result["switch"][0]["case1"]
        # Default case has no 'when'
        assert "when" not in result["switch"][1]["defaultCase"]
        assert result["switch"][1]["defaultCase"]["then"] == "fallback"

    def test_to_dict_complex_workflow(self):
        """Test switch task from golden test 02 structure."""
        cases = [
            SwitchCase("highValueCase", "${ $context.userId > 5 }", "highValueUser"),
            SwitchCase("regularUserCase", "${ $context.userId <= 5 }", "regularUser"),
            SwitchCase("defaultCase", None, "unknownUser")
        ]
        task = SwitchTask(cases)
        result = task.to_dict()
        
        assert len(result["switch"]) == 3
        
        # Verify structure matches golden test 02
        high_value = result["switch"][0]["highValueCase"]
        assert high_value["when"] == "${ $context.userId > 5 }"
        assert high_value["then"] == "highValueUser"
        
        regular = result["switch"][1]["regularUserCase"]
        assert regular["when"] == "${ $context.userId <= 5 }"
        assert regular["then"] == "regularUser"
        
        default = result["switch"][2]["defaultCase"]
        assert "when" not in default
        assert default["then"] == "unknownUser"


class TestSwitchTaskFromTuples:
    """Test SwitchTask.from_tuples() factory method."""

    def test_from_tuples_basic(self):
        """Test creating switch task from tuples."""
        task = SwitchTask.from_tuples([
            ("case1", "${ x > 5 }", "task1"),
            ("case2", "${ x <= 5 }", "task2")
        ])
        
        assert len(task.cases) == 2
        assert task.cases[0].name == "case1"
        assert task.cases[0].when == "${ x > 5 }"
        assert task.cases[0].then == "task1"

    def test_from_tuples_with_default(self):
        """Test from_tuples with default case (None condition)."""
        task = SwitchTask.from_tuples([
            ("case1", "${ x > 5 }", "task1"),
            ("defaultCase", None, "fallback")
        ])
        
        assert task.cases[0].when == "${ x > 5 }"
        assert task.cases[1].when is None

    def test_from_tuples_golden_test_02(self):
        """Test from_tuples with golden test 02 structure."""
        task = SwitchTask.from_tuples([
            ("highValueCase", "${ $context.userId > 5 }", "highValueUser"),
            ("regularUserCase", "${ $context.userId <= 5 }", "regularUser"),
            ("defaultCase", None, "unknownUser")
        ])
        
        result = task.to_dict()
        assert len(result["switch"]) == 3
        
        # Verify it produces correct YAML structure
        assert result["switch"][0]["highValueCase"]["when"] == "${ $context.userId > 5 }"
        assert result["switch"][1]["regularUserCase"]["when"] == "${ $context.userId <= 5 }"
        assert "when" not in result["switch"][2]["defaultCase"]

    def test_from_tuples_returns_switch_task(self):
        """Test from_tuples returns SwitchTask instance."""
        task = SwitchTask.from_tuples([
            ("case1", "${ x > 5 }", "task1")
        ])
        
        assert isinstance(task, SwitchTask)

    def test_from_tuples_empty_raises(self):
        """Test from_tuples with empty list raises ValueError."""
        with pytest.raises(ValueError, match="requires at least one case"):
            SwitchTask.from_tuples([])


class TestSwitchTaskExpressions:
    """Test SwitchTask with various runtime expressions."""

    def test_simple_comparison(self):
        """Test switch with simple comparison expressions."""
        cases = [
            SwitchCase("greaterThan", "${ $context.value > 10 }", "highPath"),
            SwitchCase("lessThanOrEqual", "${ $context.value <= 10 }", "lowPath")
        ]
        task = SwitchTask(cases)
        result = task.to_dict()
        
        assert result["switch"][0]["greaterThan"]["when"] == "${ $context.value > 10 }"
        assert result["switch"][1]["lessThanOrEqual"]["when"] == "${ $context.value <= 10 }"

    def test_string_comparison(self):
        """Test switch with string comparison expressions."""
        cases = [
            SwitchCase("isPremium", "${ $context.tier == 'premium' }", "premiumFlow"),
            SwitchCase("isStandard", "${ $context.tier == 'standard' }", "standardFlow")
        ]
        task = SwitchTask(cases)
        result = task.to_dict()
        
        assert result["switch"][0]["isPremium"]["when"] == "${ $context.tier == 'premium' }"

    def test_complex_boolean_expression(self):
        """Test switch with complex boolean expressions."""
        cases = [
            SwitchCase(
                "complexCondition",
                "${ $context.age >= 18 && $context.verified == true }",
                "adultVerified"
            )
        ]
        task = SwitchTask(cases)
        result = task.to_dict()
        
        assert result["switch"][0]["complexCondition"]["when"] == "${ $context.age >= 18 && $context.verified == true }"
