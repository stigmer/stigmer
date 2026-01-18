"""Integration test for golden test 01: Basic Operation."""

from stigmer import Workflow
from stigmer.tasks import SetTask
from tests.utils import compare_yaml_dicts, load_golden_test, normalize_yaml


def test_golden_01_operation_basic():
    """Test SDK generates YAML matching golden test 01.
    
    Golden test 01 tests basic operation state with simple task execution.
    It uses only SetTask instances to set variables in the workflow context.
    """
    # Load the golden test
    golden = load_golden_test("01-operation-basic.yaml")
    
    # Create workflow using SDK
    wf = Workflow(
        name="operation-basic",
        version="1.0.0",
        namespace="golden-tests",
        description="Tests basic operation state with simple task execution"
    )
    
    # Add tasks matching golden test
    wf.add_task("initialize", SetTask({"workflow_started": True}))
    
    wf.add_task("hello", SetTask({
        "message": "Hello, Zigflow!",
        "status": "success",
        "executed": True
    }))
    
    wf.add_task("finalize", SetTask({"workflow_completed": True}))
    
    # Generate YAML
    sdk_yaml = wf.synth()
    
    # Normalize both YAMLs for comparison
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Compare
    is_equal, diff = compare_yaml_dicts(sdk_dict, golden)
    
    # Assert equality with helpful error message
    assert is_equal, f"Generated YAML does not match golden test 01:\n{diff}"


def test_golden_01_document_metadata():
    """Test that document metadata matches golden test 01."""
    golden = load_golden_test("01-operation-basic.yaml")
    
    wf = Workflow(
        name="operation-basic",
        version="1.0.0",
        namespace="golden-tests",
        description="Tests basic operation state with simple task execution"
    )
    
    sdk_yaml = wf.synth()
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Verify document section
    assert sdk_dict["document"]["dsl"] == golden["document"]["dsl"]
    assert sdk_dict["document"]["namespace"] == golden["document"]["namespace"]
    assert sdk_dict["document"]["name"] == golden["document"]["name"]
    assert sdk_dict["document"]["version"] == golden["document"]["version"]
    assert sdk_dict["document"]["description"] == golden["document"]["description"]


def test_golden_01_task_count():
    """Test that the correct number of tasks are generated."""
    golden = load_golden_test("01-operation-basic.yaml")
    
    wf = Workflow(
        name="operation-basic",
        version="1.0.0",
        namespace="golden-tests",
        description="Tests basic operation state with simple task execution"
    )
    
    wf.add_task("initialize", SetTask({"workflow_started": True}))
    wf.add_task("hello", SetTask({
        "message": "Hello, Zigflow!",
        "status": "success",
        "executed": True
    }))
    wf.add_task("finalize", SetTask({"workflow_completed": True}))
    
    sdk_yaml = wf.synth()
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Verify task count
    assert len(sdk_dict["do"]) == len(golden["do"])
    assert len(sdk_dict["do"]) == 3


def test_golden_01_task_order():
    """Test that tasks are generated in the correct order."""
    golden = load_golden_test("01-operation-basic.yaml")
    
    wf = Workflow(
        name="operation-basic",
        version="1.0.0",
        namespace="golden-tests",
        description="Tests basic operation state with simple task execution"
    )
    
    wf.add_task("initialize", SetTask({"workflow_started": True}))
    wf.add_task("hello", SetTask({
        "message": "Hello, Zigflow!",
        "status": "success",
        "executed": True
    }))
    wf.add_task("finalize", SetTask({"workflow_completed": True}))
    
    sdk_yaml = wf.synth()
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Extract task names in order
    sdk_task_names = [list(task.keys())[0] for task in sdk_dict["do"]]
    golden_task_names = [list(task.keys())[0] for task in golden["do"]]
    
    assert sdk_task_names == golden_task_names
    assert sdk_task_names == ["initialize", "hello", "finalize"]
