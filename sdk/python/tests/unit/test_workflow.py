"""Unit tests for Workflow class."""

import pytest
import yaml

from stigmer import Workflow
from stigmer.exceptions import DuplicateTaskError, TaskNotFoundError
from stigmer.tasks import SetTask


def test_workflow_creation():
    """Test basic workflow creation."""
    wf = Workflow(name="test", version="1.0.0", namespace="test-ns")
    
    assert wf.document.name == "test"
    assert wf.document.version == "1.0.0"
    assert wf.document.namespace == "test-ns"
    assert wf.document.dsl == "1.0.0"
    assert wf.document.description is None


def test_workflow_with_description():
    """Test workflow creation with description."""
    wf = Workflow(
        name="test",
        version="1.0.0",
        namespace="test-ns",
        description="Test workflow"
    )
    
    assert wf.document.description == "Test workflow"


def test_add_task():
    """Test adding a task to workflow."""
    wf = Workflow(name="test", version="1.0.0")
    task = SetTask({"x": 1})
    
    result = wf.add_task("step1", task)
    
    assert result is wf  # Fluent API returns self
    assert wf.task_count == 1
    assert "step1" in wf.tasks


def test_add_duplicate_task():
    """Test that duplicate task names are rejected."""
    wf = Workflow(name="test", version="1.0.0")
    
    wf.add_task("step1", SetTask({"x": 1}))
    
    with pytest.raises(DuplicateTaskError) as exc_info:
        wf.add_task("step1", SetTask({"y": 2}))
    
    assert "step1" in str(exc_info.value)


def test_fluent_api():
    """Test method chaining (fluent API)."""
    wf = Workflow(name="test", version="1.0.0")
    
    result = (wf
        .add_task("step1", SetTask({"x": 1}))
        .add_task("step2", SetTask({"y": 2}))
        .add_task("step3", SetTask({"z": 3}))
    )
    
    assert result is wf
    assert wf.task_count == 3


def test_task_order_preserved():
    """Test that task order is preserved."""
    wf = Workflow(name="test", version="1.0.0")
    
    wf.add_task("first", SetTask({"x": 1}))
    wf.add_task("second", SetTask({"y": 2}))
    wf.add_task("third", SetTask({"z": 3}))
    
    task_names = list(wf.tasks.keys())
    assert task_names == ["first", "second", "third"]


def test_validate_invalid_then_reference():
    """Test validation catches invalid 'then' references."""
    wf = Workflow(name="test", version="1.0.0")
    
    wf.add_task("step1", SetTask({"x": 1}, then="nonexistent"))
    
    with pytest.raises(TaskNotFoundError) as exc_info:
        wf.validate()
    
    assert "nonexistent" in str(exc_info.value)
    assert "step1" in str(exc_info.value)


def test_validate_valid_then_reference():
    """Test validation passes for valid 'then' references."""
    wf = Workflow(name="test", version="1.0.0")
    
    wf.add_task("step1", SetTask({"x": 1}, then="step2"))
    wf.add_task("step2", SetTask({"y": 2}))
    
    assert wf.validate() is True


def test_validate_end_keyword():
    """Test that 'then: end' is allowed."""
    wf = Workflow(name="test", version="1.0.0")
    
    wf.add_task("step1", SetTask({"x": 1}, then="end"))
    
    assert wf.validate() is True


def test_synth_simple_workflow():
    """Test YAML synthesis for a simple workflow."""
    wf = Workflow(name="test", version="1.0.0", namespace="test-ns")
    
    wf.add_task("step1", SetTask({"x": 1}))
    wf.add_task("step2", SetTask({"y": 2}))
    
    yaml_output = wf.synth()
    
    # Parse YAML and verify structure
    parsed = yaml.safe_load(yaml_output)
    
    assert parsed["document"]["dsl"] == "1.0.0"
    assert parsed["document"]["name"] == "test"
    assert parsed["document"]["namespace"] == "test-ns"
    assert parsed["document"]["version"] == "1.0.0"
    
    assert len(parsed["do"]) == 2
    assert "step1" in parsed["do"][0]
    assert "step2" in parsed["do"][1]
    assert parsed["do"][0]["step1"]["set"] == {"x": 1}
    assert parsed["do"][1]["step2"]["set"] == {"y": 2}


def test_synth_with_description():
    """Test YAML synthesis includes description."""
    wf = Workflow(
        name="test",
        version="1.0.0",
        namespace="test-ns",
        description="Test workflow description"
    )
    
    wf.add_task("step1", SetTask({"x": 1}))
    
    yaml_output = wf.synth()
    parsed = yaml.safe_load(yaml_output)
    
    assert parsed["document"]["description"] == "Test workflow description"


def test_synth_with_then():
    """Test YAML synthesis with explicit flow control (then)."""
    wf = Workflow(name="test", version="1.0.0")
    
    wf.add_task("step1", SetTask({"x": 1}, then="step3"))
    wf.add_task("step2", SetTask({"y": 2}))
    wf.add_task("step3", SetTask({"z": 3}))
    
    yaml_output = wf.synth()
    parsed = yaml.safe_load(yaml_output)
    
    assert parsed["do"][0]["step1"]["then"] == "step3"
