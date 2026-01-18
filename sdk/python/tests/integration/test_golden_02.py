"""Integration test for golden test 02: Switch/Conditional Branching."""

from stigmer import Workflow
from stigmer.tasks import HttpTask, SwitchTask
from tests.utils import compare_yaml_dicts, load_golden_test, normalize_yaml


def test_golden_02_switch_conditional():
    """Test SDK generates YAML matching golden test 02.
    
    Golden test 02 tests conditional branching with switch, HTTP GET/POST,
    and data transformation. It demonstrates:
    - HTTP GET request to fetch data
    - Switch task for conditional branching based on userId
    - Multiple HTTP POST requests for different branches
    - Flow control with 'then: end'
    """
    # Load the golden test
    golden = load_golden_test("02-switch-conditional.yaml")
    
    # Create workflow using SDK
    wf = Workflow(
        name="switch-conditional-test",
        version="1.0.0",
        namespace="golden-tests",
        description="Fetches a post and classifies user based on userId with conditional branching"
    )
    
    # Step 1: Fetch post data from public API (GET request)
    wf.add_task("fetchPost",
        HttpTask(
            method="GET",
            uri="https://jsonplaceholder.typicode.com/posts/7"
        ).export_as("${ . }")
    )
    
    # Step 2: Conditional branching based on userId from fetched post
    wf.add_task("classifyUser",
        SwitchTask.from_tuples([
            ("highValueCase", "${ $context.userId > 5 }", "highValueUser"),
            ("regularUserCase", "${ $context.userId <= 5 }", "regularUser"),
            ("defaultCase", None, "unknownUser")
        ])
    )
    
    # Step 3a: High value user path (userId > 5)
    wf.add_task("highValueUser",
        HttpTask(
            method="POST",
            uri="https://jsonplaceholder.typicode.com/posts",
            body={
                "category": "premium",
                "userId": "${ $context.userId }",
                "postId": "${ $context.id }",
                "message": "High value user detected (userId > 5)"
            },
            then="end"
        )
    )
    
    # Step 3b: Regular user path (userId <= 5)
    wf.add_task("regularUser",
        HttpTask(
            method="POST",
            uri="https://jsonplaceholder.typicode.com/posts",
            body={
                "category": "standard",
                "userId": "${ $context.userId }",
                "postId": "${ $context.id }",
                "message": "Regular user detected (userId <= 5)"
            },
            then="end"
        )
    )
    
    # Step 3c: Unknown user fallback
    wf.add_task("unknownUser",
        HttpTask(
            method="POST",
            uri="https://jsonplaceholder.typicode.com/posts",
            body={
                "category": "unknown",
                "message": "Unable to classify user - userId missing"
            },
            then="end"
        )
    )
    
    # Generate YAML
    sdk_yaml = wf.synth()
    
    # Normalize both YAMLs for comparison
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Compare
    is_equal, diff = compare_yaml_dicts(sdk_dict, golden)
    
    # Assert equality with helpful error message
    assert is_equal, f"Generated YAML does not match golden test 02:\n{diff}"


def test_golden_02_http_task():
    """Test that HTTP task structure matches golden test 02."""
    golden = load_golden_test("02-switch-conditional.yaml")
    
    wf = Workflow(
        name="switch-conditional-test",
        version="1.0.0",
        namespace="golden-tests"
    )
    
    wf.add_task("fetchPost",
        HttpTask(
            method="GET",
            uri="https://jsonplaceholder.typicode.com/posts/7"
        ).export_as("${ . }")
    )
    
    sdk_yaml = wf.synth()
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Verify fetchPost task structure
    fetch_task = sdk_dict["do"][0]["fetchPost"]
    golden_fetch = golden["do"][0]["fetchPost"]
    
    assert fetch_task["call"] == golden_fetch["call"]
    assert fetch_task["with"]["method"] == golden_fetch["with"]["method"]
    assert fetch_task["with"]["endpoint"]["uri"] == golden_fetch["with"]["endpoint"]["uri"]
    assert fetch_task["export"]["as"] == golden_fetch["export"]["as"]


def test_golden_02_switch_task():
    """Test that switch task structure matches golden test 02."""
    golden = load_golden_test("02-switch-conditional.yaml")
    
    wf = Workflow(
        name="switch-conditional-test",
        version="1.0.0",
        namespace="golden-tests"
    )
    
    wf.add_task("classifyUser",
        SwitchTask.from_tuples([
            ("highValueCase", "${ $context.userId > 5 }", "highValueUser"),
            ("regularUserCase", "${ $context.userId <= 5 }", "regularUser"),
            ("defaultCase", None, "unknownUser")
        ])
    )
    
    sdk_yaml = wf.synth()
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Verify switch task structure
    switch_task = sdk_dict["do"][0]["classifyUser"]
    golden_switch = golden["do"][1]["classifyUser"]
    
    assert "switch" in switch_task
    assert len(switch_task["switch"]) == 3
    
    # Verify high value case
    high_value = switch_task["switch"][0]["highValueCase"]
    golden_high = golden_switch["switch"][0]["highValueCase"]
    assert high_value["when"] == golden_high["when"]
    assert high_value["then"] == golden_high["then"]
    
    # Verify regular case
    regular = switch_task["switch"][1]["regularUserCase"]
    golden_regular = golden_switch["switch"][1]["regularUserCase"]
    assert regular["when"] == golden_regular["when"]
    assert regular["then"] == golden_regular["then"]
    
    # Verify default case (no 'when')
    default = switch_task["switch"][2]["defaultCase"]
    golden_default = golden_switch["switch"][2]["defaultCase"]
    assert "when" not in default
    assert "when" not in golden_default
    assert default["then"] == golden_default["then"]


def test_golden_02_flow_control():
    """Test that flow control (then: end) works correctly."""
    golden = load_golden_test("02-switch-conditional.yaml")
    
    wf = Workflow(
        name="switch-conditional-test",
        version="1.0.0",
        namespace="golden-tests"
    )
    
    wf.add_task("highValueUser",
        HttpTask(
            method="POST",
            uri="https://jsonplaceholder.typicode.com/posts",
            body={"category": "premium"},
            then="end"
        )
    )
    
    sdk_yaml = wf.synth()
    sdk_dict = normalize_yaml(sdk_yaml)
    
    # Verify 'then: end' is present
    task = sdk_dict["do"][0]["highValueUser"]
    golden_task = golden["do"][2]["highValueUser"]
    
    assert task["then"] == "end"
    assert golden_task["then"] == "end"


def test_golden_02_task_count():
    """Test that the correct number of tasks are generated."""
    golden = load_golden_test("02-switch-conditional.yaml")
    
    # Golden test 02 has 5 tasks:
    # 1. fetchPost
    # 2. classifyUser
    # 3. highValueUser
    # 4. regularUser
    # 5. unknownUser
    assert len(golden["do"]) == 5
