---
name: Fix SQLite Checkpointer Bug
overview: "Fix the `AsyncSqliteSaver.from_conn_string()` misuse in the checkpointer factory that causes both the \"Invalid checkpointer provided\" error and the cascading \"messages: at least one message is required\" error during HITL approval resume."
todos:
  - id: fix-factory
    content: Refactor create_checkpointer in factory.py to @asynccontextmanager that properly enters AsyncSqliteSaver.from_conn_string() and manages resource lifecycle for all checkpointer types
    status: completed
  - id: fix-caller
    content: Update execute_graphton.py to use AsyncExitStack for checkpointer lifecycle management
    status: completed
  - id: update-init
    content: Update __init__.py module docstring to reflect async context manager usage
    status: completed
  - id: update-tests
    content: Update test_checkpointer_factory.py to use async with pattern and verify SQLite returns a proper BaseCheckpointSaver
    status: completed
isProject: false
---

# Fix AsyncSqliteSaver Context Manager Bug in Checkpointer Factory

## Root Cause Analysis

Both errors in the logs trace to a single root cause in `factory.py`:

```177:186:backend/services/agent-runner/worker/checkpointer/factory.py
        # Create the checkpointer
        # Note: from_conn_string is an async context manager in some versions
        # We handle both cases
        checkpointer = AsyncSqliteSaver.from_conn_string(config.sqlite_path)
        
        logger.info(
            f"Created AsyncSqliteSaver checkpointer "
            f"(persistent, file={config.sqlite_path})"
        )
        return checkpointer  # type: ignore[return-value]  # from_conn_string returns context manager usable as checkpointer
```

`AsyncSqliteSaver.from_conn_string()` is an `@asynccontextmanager` -- it returns an `_AsyncGeneratorContextManager`, **not** a `BaseCheckpointSaver`. It must be used with `async with` to yield the actual saver. The `# type: ignore` comment masked this type error.

**Error 2** ("Invalid checkpointer provided. Received _AsyncGeneratorContextManager"): LangGraph correctly rejects the un-entered context manager object.

**Error 1** ("messages: at least one message is required"): Same root cause. With a broken checkpointer, the initial execution's state (messages, tool calls) is never persisted. When Temporal re-invokes the activity for HITL approval resume, `Command(resume=...)` finds no checkpoint, so the LLM receives zero messages and the Anthropic API returns 400.

## The Fix

Refactor `create_checkpointer` from an `async def` returning a `BaseCheckpointSaver` to an `@asynccontextmanager` that **yields** a `BaseCheckpointSaver`. This:

- Properly enters `AsyncSqliteSaver.from_conn_string()` (fixing the bug)
- Gives proper lifecycle management (connection cleanup) to **all** checkpointer types
- Also fixes the existing resource leak in the MongoDB path (Motor client never closed)

Use `contextlib.AsyncExitStack` in `execute_graphton.py` to enter the context manager without re-indenting 1200+ lines of existing code.

## File Changes

### 1. [factory.py](backend/services/agent-runner/worker/checkpointer/factory.py) -- Core fix

- Add `from contextlib import asynccontextmanager`
- Change `create_checkpointer` signature from `async def ... -> BaseCheckpointSaver` to `@asynccontextmanager async def ... -> AsyncIterator[BaseCheckpointSaver]`
- Memory path: `yield MemorySaver()` (no cleanup needed)
- SQLite path: `async with AsyncSqliteSaver.from_conn_string(...) as saver: yield saver` (connection properly managed)
- MongoDB path: create Motor client, yield saver, close client in `finally`
- Remove the misleading `# type: ignore` comment
- Internal helper functions (`_create_sqlite_checkpointer`, `_create_mongodb_checkpointer`) become context managers or are inlined

### 2. [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) -- Caller update

- Add `import contextlib` at top
- Before Step 2.5 (~line 387), create: `exit_stack = contextlib.AsyncExitStack()`
- At line 398, change:
  - From: `checkpointer = await create_checkpointer(worker_config.checkpointer)`
  - To: `checkpointer = await exit_stack.enter_async_context(create_checkpointer(worker_config.checkpointer))`
- Add cleanup in the `except` block (line ~1512) or via a wrapping `try/finally`: `await exit_stack.aclose()`
- This approach avoids re-indenting the ~1200 lines between checkpointer creation and function exit

### 3. **[init**.py](backend/services/agent-runner/worker/checkpointer/__init__.py) -- Docstring update

- Update the usage example in the module docstring to show the `async with` pattern

### 4. [test_checkpointer_factory.py](backend/services/agent-runner/tests/test_checkpointer_factory.py) -- Test updates

- Update all tests to use `async with create_checkpointer(config) as checkpointer:` pattern
- Fix the SQLite mock test (line 138) which currently mocks `from_conn_string.return_value` -- needs to mock the context manager yield instead
- Add a test that verifies the SQLite checkpointer is a proper `BaseCheckpointSaver` instance (not a context manager)

## What This Does NOT Change

- The Graphton agent library (`graphton/core/agent.py`) -- the `checkpointer` parameter type stays `BaseCheckpointSaver | None`
- The `CheckpointerConfig` dataclass or its validation
- The HITL resume logic (`Command(resume=...)`) -- that code is correct, it just never worked because the checkpointer was broken
- The `deepagents` library integration

