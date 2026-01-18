"""Unit tests for SetTask."""

from stigmer.tasks import SetTask


def test_set_task_creation():
    """Test basic SetTask creation."""
    task = SetTask({"x": 1, "y": 2})
    
    assert task.variables == {"x": 1, "y": 2}
    assert task.then is None


def test_set_task_with_then():
    """Test SetTask with explicit flow control."""
    task = SetTask({"x": 1}, then="next_step")
    
    assert task.then == "next_step"


def test_set_task_to_dict():
    """Test SetTask to_dict conversion."""
    task = SetTask({"x": 1, "y": 2, "message": "Hello"})
    
    result = task.to_dict()
    
    assert result == {
        "set": {"x": 1, "y": 2, "message": "Hello"}
    }


def test_set_task_to_dict_with_then():
    """Test SetTask to_dict includes 'then' field."""
    task = SetTask({"x": 1}, then="next_step")
    
    result = task.to_dict()
    
    assert result == {
        "set": {"x": 1},
        "then": "next_step"
    }


def test_set_task_to_dict_with_export():
    """Test SetTask to_dict includes 'export' field."""
    task = SetTask({"x": 1})
    task.export_as("${ . }")
    
    result = task.to_dict()
    
    assert result == {
        "set": {"x": 1},
        "export": {"as": "${ . }"}
    }


def test_set_task_export_as_returns_self():
    """Test export_as returns self for chaining."""
    task = SetTask({"x": 1})
    
    result = task.export_as("${ . }")
    
    assert result is task
