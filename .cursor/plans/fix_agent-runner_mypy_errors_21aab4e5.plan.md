---
name: Fix agent-runner mypy errors
overview: Fix all 11 mypy type-checking errors in the agent-runner service that are failing the `lint-and-typecheck-agent-runner` CI job. The errors span 4 files and involve type narrowing, variable shadowing, missing annotations, and type redefinitions.
todos:
  - id: fix-config
    content: "Fix config.py: add sandbox_root_dir None guard in local-mode branch"
    status: completed
  - id: fix-status-builder
    content: "Fix status_builder.py: replace pop(..., None) with pop(..., datetime.utcnow())"
    status: completed
  - id: fix-session-subject
    content: "Fix generate_session_subject.py: narrow response.content with isinstance check"
    status: completed
  - id: fix-execute-graphton
    content: "Fix execute_graphton.py: all 8 errors (type annotation, variable rename, no-redef, cast)"
    status: completed
  - id: verify-mypy
    content: Run mypy locally to verify all 11 errors are resolved
    status: completed
isProject: false
---

# Fix Agent-Runner MyPy Type-Checking Errors

The `lint-and-typecheck-agent-runner` CI job is failing with 11 mypy errors across 4 Python files in `backend/services/agent-runner/`. All errors are legitimate type safety issues that need proper fixes -- not suppression.

## Error Inventory

All files under `backend/services/agent-runner/`:


| #   | File | Line | Error | Category |
| --- | ---- | ---- | ----- | -------- |


1. `worker/config.py:529` -- `Path(self.sandbox_root_dir)` where `sandbox_root_dir: str | None` [arg-type]
2. `worker/activities/graphton/status_builder.py:1488` -- `dict.pop(key, None)` default type mismatch [arg-type]
3. `worker/activities/generate_session_subject.py:170` -- `.strip()` on `str | list` [union-attr]
4. `worker/activities/execute_graphton.py:477` -- Missing annotation for `file_uploads = []` [var-annotated]
5. `worker/activities/execute_graphton.py:798` -- Variable `p` reused as `str` after being `PurePosixPath` [assignment]
6. `worker/activities/execute_graphton.py:801` -- Cascading from #5: `append(p)` where `p` typed wrong [arg-type]
7. `worker/activities/execute_graphton.py:808` -- Cascading from #5: same [arg-type]
8. `worker/activities/execute_graphton.py:912/916` -- `approval_decisions` annotated in both if/else branches [no-redef]
9. `worker/activities/execute_graphton.py:1913/1922` -- `sandbox_config_for_agent` annotated in both if/else branches [no-redef]
10. `worker/activities/execute_graphton.py:2819` -- `aget_state(config)` expects `RunnableConfig`, got `dict` [arg-type]
11. `worker/activities/execute_graphton.py:2822` -- `pending_approvals` re-annotated later in same function [no-redef]

## Fixes by File

### 1. [worker/config.py](backend/services/agent-runner/worker/config.py) -- 1 error

**Error**: `sandbox_root_dir` is `str | None`, but `Path(self.sandbox_root_dir)` at line 529 requires `str`. The code is inside the `if self.mode == "local":` branch where `sandbox_root_dir` is always set at init, but mypy cannot infer this invariant from the field type.

**Fix**: Add an explicit guard at the top of the `if self.mode == "local":` block that both narrows the type for mypy AND provides a clear runtime error if the invariant is ever violated:

```python
if self.mode == "local":
    if self.sandbox_root_dir is None:
        raise RuntimeError(
            "sandbox_root_dir must be configured in local mode"
        )
    root_dir = self.sandbox_root_dir
    if session_id:
        root_dir = str(Path(self.sandbox_root_dir) / "sessions" / session_id)
```

### 2. [worker/activities/graphton/status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py) -- 1 error

**Error**: `self._tool_start_times.pop(temp_id, None)` -- the `None` default doesn't match the dict value type `datetime`. The `or datetime.utcnow()` fallback is semantically equivalent to just using `datetime.utcnow()` as the default.

**Fix**: Replace the `pop(..., None) or fallback` pattern with the direct default:

```python
self._tool_start_times[run_id] = self._tool_start_times.pop(
    temp_id, datetime.utcnow()
)
```

This is both type-safe and semantically identical (datetime is never falsy, so the `or` branch was only triggered when `pop` returned `None`).

### 3. [worker/activities/generate_session_subject.py](backend/services/agent-runner/worker/activities/generate_session_subject.py) -- 1 error

**Error**: `response.content` from LangChain is typed as `str | list[str | dict]`, but `.strip()` is called directly on it. For simple text generation (session titles), the content is always `str`, but mypy can't know that.

**Fix**: Narrow with an isinstance check and handle the list case gracefully:

```python
content = response.content
if not isinstance(content, str):
    content = "".join(str(part) for part in content) if isinstance(content, list) else str(content)
subject = content.strip().strip('"').strip("'")
```

This is production-safe (no assertions that can be disabled) and handles the theoretical list-content case.

### 4. [worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) -- 8 errors

**Error #4 (line 477)**: `file_uploads = []` needs a type annotation. Since `FileUpload` is conditionally imported from `daytona`, use `Any`:

```python
file_uploads: list[Any] = []
```

**Errors #5, #6, #7 (lines 798, 801, 808)**: Variable `p` is first assigned as `PurePosixPath` (line 749) then reused as `str` in a `for` loop (line 798). These are in different branches of an if/else but mypy tracks the variable type across the function. Fix by renaming line 749's `p` to `sole_path`:

```python
if len(normalised) == 1:
    sole_path = PurePosixPath(normalised[0])
    if len(sole_path.parts) > 1:
        common_dir = str(sole_path.parent)
    else:
        common_dir = None
```

This resolves all three errors since `p` in the `for` loop is now independently typed as `str`.

**Error #8 (lines 912/916)**: `approval_decisions` has a type annotation in both the `if` and `else` branches. Remove the annotation from the `else` branch:

```python
else:
    approval_decisions = []
```

**Error #9 (lines 1913/1922)**: `sandbox_config_for_agent` has a type annotation in both branches. Remove the annotation from the `else` branch:

```python
else:
    sandbox_config_for_agent = {
        "type": "daytona",
        "sandbox_id": sandbox.id,
    }
```

**Error #10 (line 2819)**: `aget_state(config)` expects `RunnableConfig`, not a plain dict. Cast using `typing.cast`:

```python
from langchain_core.runnables import RunnableConfig
...
graph_state = await agent_graph.aget_state(cast(RunnableConfig, config))
```

Also needs `from typing import cast` (or verify it's already imported via `Any`).

**Error #11 (line 2822)**: `pending_approvals: list[PendingApproval] = []` re-annotates a variable already defined at line 2167 in the same function. Remove the annotation:

```python
pending_approvals = []
```

## Verification

After all fixes, run `poetry run mypy grpc_client/ worker/ --show-error-codes` locally (from `backend/services/agent-runner/`) to confirm 0 errors remain before committing.