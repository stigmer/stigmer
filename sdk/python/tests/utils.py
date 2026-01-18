"""Test utilities for loading and comparing golden tests."""

from pathlib import Path
from typing import Any

import yaml


def load_golden_test(filename: str) -> dict[str, Any]:
    """Load a golden test YAML file from workflow-runner.
    
    Args:
        filename: Golden test filename (e.g., "01-operation-basic.yaml")
    
    Returns:
        Parsed YAML as dictionary
    
    Example:
        >>> golden = load_golden_test("01-operation-basic.yaml")
        >>> assert golden["document"]["name"] == "operation-basic"
    """
    # Navigate from SDK to workflow-runner golden tests
    sdk_dir = Path(__file__).parent.parent
    workspace_root = sdk_dir.parent.parent
    golden_path = workspace_root / "backend/services/workflow-runner/test/golden" / filename
    
    with open(golden_path, "r") as f:
        return yaml.safe_load(f)


def normalize_yaml(yaml_str: str) -> dict[str, Any]:
    """Normalize YAML string to dictionary for comparison.
    
    This removes formatting differences and allows for structural comparison.
    
    Args:
        yaml_str: YAML content as string
    
    Returns:
        Normalized dictionary representation
    
    Example:
        >>> yaml1 = "key: value\\n"
        >>> yaml2 = "key:  value  \\n"
        >>> normalize_yaml(yaml1) == normalize_yaml(yaml2)
        True
    """
    return yaml.safe_load(yaml_str)


def compare_yaml_dicts(actual: dict[str, Any], expected: dict[str, Any]) -> tuple[bool, str]:
    """Compare two YAML dictionaries and return detailed differences.
    
    Args:
        actual: Actual generated dictionary
        expected: Expected dictionary (from golden test)
    
    Returns:
        Tuple of (is_equal, difference_message)
    
    Example:
        >>> actual = {"key": "value1"}
        >>> expected = {"key": "value2"}
        >>> is_equal, msg = compare_yaml_dicts(actual, expected)
        >>> assert not is_equal
        >>> assert "value1" in msg
    """
    if actual == expected:
        return True, ""
    
    # Generate detailed diff message
    diffs = []
    
    def find_diffs(path: str, act: Any, exp: Any) -> None:
        """Recursively find differences."""
        if type(act) != type(exp):
            diffs.append(f"{path}: type mismatch (actual={type(act).__name__}, expected={type(exp).__name__})")
            return
        
        if isinstance(act, dict):
            all_keys = set(act.keys()) | set(exp.keys())
            for key in all_keys:
                new_path = f"{path}.{key}" if path else key
                if key not in act:
                    diffs.append(f"{new_path}: missing in actual")
                elif key not in exp:
                    diffs.append(f"{new_path}: unexpected key in actual")
                else:
                    find_diffs(new_path, act[key], exp[key])
        elif isinstance(act, list):
            if len(act) != len(exp):
                diffs.append(f"{path}: length mismatch (actual={len(act)}, expected={len(exp)})")
                return
            for i, (a, e) in enumerate(zip(act, exp)):
                find_diffs(f"{path}[{i}]", a, e)
        elif act != exp:
            diffs.append(f"{path}: value mismatch (actual={repr(act)}, expected={repr(exp)})")
    
    find_diffs("", actual, expected)
    
    diff_message = "\n".join(diffs)
    return False, diff_message
