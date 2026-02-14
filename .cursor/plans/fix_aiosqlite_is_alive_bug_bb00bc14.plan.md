---
name: Fix aiosqlite is_alive bug
overview: The execution failure (`'Connection' object has no attribute 'is_alive'`) is caused by an incompatibility between `langgraph-checkpoint-sqlite` 2.0.10 and `aiosqlite` 0.22.x. The fix is a dependency version bump to the upstream-patched version.
todos:
  - id: bump-dep
    content: Update `langgraph-checkpoint-sqlite` from `^2.0.0` to `^3.0.0` in `backend/services/agent-runner/pyproject.toml`
    status: completed
  - id: lock-install
    content: Run `poetry lock && poetry install` in `backend/services/agent-runner/`
    status: completed
  - id: verify-versions
    content: Verify resolved versions in lock file (langgraph-checkpoint-sqlite >= 3.0.3)
    status: completed
  - id: test-execution
    content: Re-run the agent-drafter command to verify the execution no longer crashes
    status: completed
isProject: false
---

# Fix: `'Connection' object has no attribute 'is_alive'`

## Root Cause

This is a **known upstream bug** ([langchain-ai/langgraph#6583](https://github.com/langchain-ai/langgraph/issues/6583)), not a bug in Stigmer code.

**Chain of events:**

1. `aiosqlite` released version 0.22.0 with a breaking change: the `Connection` class [no longer inherits from `threading.Thread](https://github.com/omnilib/aiosqlite/issues/368)`, removing the `is_alive()` method.
2. `langgraph-checkpoint-sqlite` 2.0.10 calls `self.conn.is_alive()` inside `AsyncSqliteSaver.setup()` ([source](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/aio.py#L284)).
3. Since the project has `aiosqlite` 0.22.1 (transitive dependency) and `langgraph-checkpoint-sqlite` 2.0.10, every SQLite checkpointer creation crashes.

**Current locked versions** (from [poetry.lock](backend/services/agent-runner/poetry.lock)):

- `langgraph-checkpoint-sqlite`: **2.0.10** (has the bug)
- `aiosqlite`: **0.22.1** (has the breaking change)
- `langgraph-checkpoint`: **3.0.1**

**Fixed upstream:** LangGraph merged [PR #6699](https://github.com/langchain-ai/langgraph/pull/6699) on 2026-01-19, released as `langgraph-checkpoint-sqlite` **3.0.3**.

## The Fix

Update the `langgraph-checkpoint-sqlite` dependency from `^2.0.0` to `^3.0.0` in [backend/services/agent-runner/pyproject.toml](backend/services/agent-runner/pyproject.toml).

**File:** `backend/services/agent-runner/pyproject.toml`, line 20

```
# Before
langgraph-checkpoint-sqlite = "^2.0.0"

# After
langgraph-checkpoint-sqlite = "^3.0.0"
```

Then regenerate the lock file and install.

## Why This Is Safe

- **API compatibility**: The factory code in [factory.py](backend/services/agent-runner/worker/checkpointer/factory.py) uses `AsyncSqliteSaver.from_conn_string()` -- this API is unchanged in 3.x.
- **Checkpoint base compatibility**: `langgraph-checkpoint-sqlite` 3.0.3 requires `langgraph-checkpoint >=3,<5.0.0`. The project already has `langgraph-checkpoint` 3.0.1, which satisfies this.
- **The 2.x to 3.x major bump** was to align version numbers with the `langgraph-checkpoint` 3.x series, not due to breaking API changes in the SQLite checkpointer surface used by this project.
- **New transitive dependency**: 3.x adds `sqlite-vec >=0.1.6` (a SQLite vector extension), which installs cleanly via pip.

## Steps

1. Edit `pyproject.toml` line 20: change `"^2.0.0"` to `"^3.0.0"`
2. Run `poetry lock` then `poetry install` in the `backend/services/agent-runner/` directory
3. Verify the lock file resolves `langgraph-checkpoint-sqlite` to 3.0.3 and `aiosqlite` to 0.22.x (no need to pin aiosqlite anymore)
4. Re-run `command.sh` to verify the execution succeeds

