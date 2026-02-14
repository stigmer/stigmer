---
name: Fix memory_backend parameter
overview: Fix the `create_deep_agent() got an unexpected keyword argument 'memory_backend'` error by reverting an incorrect parameter rename. The deepagents 0.4.x API still uses `backend`, not `memory_backend`.
todos:
  - id: fix-param
    content: Change `memory_backend=` to `backend=` at line 531 of `backend/libs/python/graphton/src/graphton/core/agent.py`
    status: completed
  - id: fix-comment
    content: Correct the misleading comment at lines 520-523 in the same file
    status: completed
  - id: fix-changelog
    content: Add errata to `_changelog/2026-02/2026-02-13-220513-fix-agent-execution-timeouts-and-upgrade-deepagents.md`
    status: completed
isProject: false
---

# Fix Incorrect `memory_backend` Parameter in Graphton Agent

## Root Cause

The error `create_deep_agent() got an unexpected keyword argument 'memory_backend'` is a regression introduced on 2026-02-13 during the deepagents 0.2.x to 0.4.x upgrade. The [changelog](_changelog/2026-02/2026-02-13-220513-fix-agent-execution-timeouts-and-upgrade-deepagents.md) incorrectly stated that deepagents 0.4.x renamed `backend` to `memory_backend`. This is **factually wrong**.

The [official LangChain reference for deepagents](https://reference.langchain.com/python/deepagents/graph/) confirms the parameter is still `backend`:

```python
create_deep_agent(
    ...,
    backend: BackendProtocol | BackendFactory | None = None,
    ...
)
```

There is no `memory_backend` parameter. There never was.

## Scope of the Fix

This is a **single-line code fix** with a comment correction and a changelog errata. No architectural changes, no new dependencies, no behavior changes.

## Changes

### 1. Fix the parameter name in graphton agent.py

**File**: [backend/libs/python/graphton/src/graphton/core/agent.py](backend/libs/python/graphton/src/graphton/core/agent.py)

At line 531, change:

```python
memory_backend=backend_for_deepagents,  # May be None if using approval-aware wrappers
```

to:

```python
backend=backend_for_deepagents,  # May be None if using approval-aware wrappers
```

### 2. Correct the misleading comment above the call

At lines 520-523 in the same file, the comment says:

```
# NOTE: In deepagents 0.4.x, 'backend' was renamed to 'memory_backend' and
# 'general_purpose_agent' was removed.
```

Correct it to remove the false claim about the rename. The `general_purpose_agent` removal part is accurate and should be kept.

### 3. Correct the changelog (errata)

**File**: [_changelog/2026-02/2026-02-13-220513-fix-agent-execution-timeouts-and-upgrade-deepagents.md](_changelog/2026-02/2026-02-13-220513-fix-agent-execution-timeouts-and-upgrade-deepagents.md)

Add an errata note or correct the lines that claim `backend` was renamed to `memory_backend`. The changelog is a historical record, so an errata annotation is the cleanest approach - it preserves the original entry while documenting the correction.

## What This Does NOT Change

- No changes to the `create_deep_agent` function signature in graphton (the public API never exposed `memory_backend`)
- No changes to any callers of graphton's `create_deep_agent`
- No changes to checkpointer, sandbox, or approval flow logic
- No dependency version changes

