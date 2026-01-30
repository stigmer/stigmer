---
name: Fix Error Enrichment Tests
overview: Fix the test import error by extracting `_enrich_error_message` into a standalone utility module, then run all tests and commit the verified changes.
todos:
  - id: extract-error-hints
    content: Create error_hints.py with enrich_error_message function extracted from authenticated_tool_node.py
    status: completed
  - id: update-imports
    content: Update authenticated_tool_node.py and test file imports to use the new module
    status: completed
  - id: run-verify-tests
    content: Run all 80+ tests and verify they pass
    status: completed
  - id: commit-changes
    content: Commit with conventional commit message
    status: completed
isProject: false
---

# Fix Error Enrichment Tests

## Current State

- **53 tests PASS**: `test_prompt_enhancement.py` (27 tests) and `test_config.py` (26 tests)
- **1 test file BLOCKED**: `test_error_enrichment.py` fails to import due to dependency chain
- **Implementation committed**: All code changes from the self-correction enhancement are already committed

## The Problem

`test_error_enrichment.py` imports `_enrich_error_message` from `authenticated_tool_node.py`, which triggers:

```
authenticated_tool_node.py:29
  from langchain_mcp_adapters import MultiServerMCPClient
ImportError: cannot import name 'MultiServerMCPClient'
```

The `_enrich_error_message` function has **no dependency on MCP** - it's a pure string transformation function that got bundled into a module with heavy dependencies.

## Solution: Extract to Utility Module

Move `_enrich_error_message` to a new `[error_hints.py](backend/libs/python/graphton/src/graphton/core/error_hints.py)` module with zero external dependencies:

```python
# graphton/core/error_hints.py - Pure utility, no external deps
def enrich_error_message(tool_name: str, error: str) -> str:
    """Add contextual recovery hints based on error patterns."""
    ...
```

## Implementation Steps

### Step 1: Create error_hints.py (~15 min)

Extract the `_enrich_error_message` function (lines 34-119 of `authenticated_tool_node.py`) into:

- **New file**: `backend/libs/python/graphton/src/graphton/core/error_hints.py`
- **Export as public**: `enrich_error_message` (remove underscore prefix)
- **Add to `__init__.py**`: Export from core module

### Step 2: Update authenticated_tool_node.py (~5 min)

Replace the local function with an import:

```python
from graphton.core.error_hints import enrich_error_message
```

### Step 3: Update test imports (~5 min)

Change test file import:

```python
# Before
from graphton.core.authenticated_tool_node import _enrich_error_message

# After  
from graphton.core.error_hints import enrich_error_message
```

### Step 4: Run all tests (~10 min)

```bash
cd backend/libs/python/graphton
poetry run pytest tests/core/test_prompt_enhancement.py \
                  tests/core/test_config.py \
                  tests/core/test_error_enrichment.py -v
```

Expected: All 80+ tests pass (53 existing + 27 error enrichment tests)

### Step 5: Commit changes (~5 min)

Commit with conventional commit message:
`refactor(graphton): extract error_hints to standalone testable module`

## Key Files

- **Create**: `[error_hints.py](backend/libs/python/graphton/src/graphton/core/error_hints.py)`
- **Modify**: `[authenticated_tool_node.py](backend/libs/python/graphton/src/graphton/core/authenticated_tool_node.py)`
- **Modify**: `[test_error_enrichment.py](backend/libs/python/graphton/tests/core/test_error_enrichment.py)`
- **Modify**: `[__init__.py](backend/libs/python/graphton/src/graphton/core/__init__.py)`

## Estimated Time: 45-60 minutes

This is a focused refactoring task that improves code architecture while unblocking tests.