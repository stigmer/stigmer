# Fix Agent Runner Pytest Warnings and Missing Dependencies

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Area**: Agent Runner Tests  
**Impact**: Test Quality, Continuous Integration

## Summary

Fixed Python test warnings and missing dependencies in the agent-runner service tests. The tests were passing but generating pytest warnings about improper test patterns, and failing due to a missing `langchain-ollama` dependency.

## Problems Identified

### 1. Pytest Style Violations

The test functions in `test_graphton_integration.py` were returning boolean values (`return True`/`return False`) instead of using proper pytest assertions:

```python
# ❌ Before: Returns boolean instead of using assertions
def test_graphton_imports():
    try:
        from graphton import create_deep_agent, AgentConfig
        print("✅ All Graphton imports successful")
        return True
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False
```

This triggered pytest warnings:
```
PytestReturnNotNoneWarning: Test functions should return None, but test_graphton_integration.py::test_graphton_imports returned <class 'bool'>.
```

### 2. Missing Dependency

Tests were failing with:
```
ModuleNotFoundError: No module named 'langchain_ollama'
```

The graphton library (a local dependency) requires `langchain-ollama`, but it wasn't installed because the agent-runner's poetry lock file was out of sync.

## Solutions Implemented

### Fix 1: Remove Return Statements and Add Proper Assertions

Updated all four test functions to follow pytest best practices:

**test_graphton_imports():**
- Removed try/except blocks (pytest handles exceptions automatically)
- Removed `return True`/`return False` statements
- Tests fail automatically if imports raise exceptions

**test_agent_config():**
- Added explicit assertions: `assert config.model == "claude-sonnet-4-20250514"`
- Removed boolean return pattern

**test_template_utilities():**
- Already had assertions, just removed `return True` statements
- Removed unnecessary try/except wrapper

**test_sandbox_config():**
- Added assertions: `assert config.sandbox_config["type"] == "filesystem"`
- Removed boolean return pattern

```python
# ✅ After: Proper pytest pattern
def test_graphton_imports():
    """Test that all Graphton imports work."""
    from graphton import create_deep_agent, AgentConfig
    from graphton import extract_template_vars, has_templates, substitute_templates
    from graphton import McpToolsLoader
    
    # Test passes if no exceptions raised
```

### Fix 2: Update Dependencies

Ran `poetry update graphton` to sync the graphton dependencies:

```bash
cd backend/services/agent-runner
poetry update graphton --no-interaction
```

This installed:
- `ollama` (0.6.1)
- `langchain-ollama` (0.3.10)

Updated `poetry.lock` with the new dependencies.

## Files Changed

```
backend/services/agent-runner/
├── test_graphton_integration.py  # Fixed test patterns
└── poetry.lock                   # Added langchain-ollama dependency
```

## Test Results

**Before:**
```
============================== 4 passed, 4 warnings in 0.30s =========================
```

**After:**
```
============================== 4 passed in 1.03s ===============================
```

✅ All warnings eliminated  
✅ All tests passing  
✅ Clean test output

## Why This Matters

### Test Quality
- **Proper pytest patterns**: Tests now follow Python testing best practices
- **Clear failures**: When tests fail, pytest shows proper error messages
- **Maintainability**: Other developers understand test expectations immediately

### CI/CD Reliability
- **No warnings**: Clean test output makes real issues more visible
- **Dependency completeness**: Poetry lock file ensures reproducible test environments
- **Future-proof**: Tests will work correctly in CI pipelines

### Developer Experience
- **`make test` works cleanly**: Developers can run tests without confusion
- **Better debugging**: Proper assertions show what failed and why
- **Standard patterns**: New tests can follow these examples

## Testing Performed

Verified the fix with multiple test runs:

```bash
# Run all tests (Go + Python)
make test

# Run only Python tests
cd backend/services/agent-runner
poetry run pytest

# Run with verbose output
poetry run pytest -v
```

All tests pass without warnings or errors.

## Related Context

This fix addresses test quality issues that would have been caught in CI. The agent-runner service uses Graphton (a local Python library for agent creation) which depends on langchain-ollama for LLM integration. The dependency was declared in graphton's `pyproject.toml` but wasn't resolved in the agent-runner's lock file until we explicitly updated it.

The test pattern fix ensures that when tests fail, developers get clear pytest failure messages instead of confusing boolean return values.

## Next Steps

- ✅ Tests are clean and passing
- ✅ CI/CD will run without warnings
- ✅ Code is ready to commit

---

**Impact**: Low (test quality improvement, no functional changes)  
**Complexity**: Low (dependency update + test pattern fixes)  
**Risk**: None (only affects test code, all tests passing)
