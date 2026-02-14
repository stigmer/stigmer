# Fix: 'Connection' object has no attribute 'is_alive' Bug

**Date**: February 14, 2026

## Summary

Resolved a critical upstream dependency bug causing agent executions to fail with `'Connection' object has no attribute 'is_alive'` error. Upgraded `langgraph-checkpoint-sqlite` from 2.0.10 to 3.0.3, which includes the upstream fix from LangGraph maintainers.

## Problem Statement

Agent executions were failing immediately with an `AttributeError` when attempting to create SQLite checkpointers. The error prevented any agent from running in local mode, blocking all development and testing workflows.

### Root Cause

This was a dependency incompatibility issue:

1. **aiosqlite 0.22.0** released with a breaking change - the `Connection` class no longer inherits from `threading.Thread`, removing the `is_alive()` method
2. **langgraph-checkpoint-sqlite 2.0.10** called `self.conn.is_alive()` during checkpointer setup
3. The combination of these versions created an immediate crash on any SQLite checkpointer initialization

### Pain Points

- **Development blocked**: Unable to run agents locally with SQLite persistence
- **No workarounds**: MemorySaver incompatible with HITL approval flows (requires persistence)
- **Silent failure**: Error occurred during worker startup, not immediately visible to users
- **Upstream issue**: Bug was in external dependency, requiring upstream fix

## Solution

Updated the `langgraph-checkpoint-sqlite` dependency specification from `^2.0.0` to `^3.0.0` in the agent-runner service.

### Why This Fix Works

LangGraph maintainers released version 3.0.3 on January 19, 2026 ([PR #6699](https://github.com/langchain-ai/langgraph/pull/6699)) that handles the aiosqlite breaking change in a backwards-compatible way. The fix removes reliance on the `is_alive()` method.

## Implementation Details

### Changes Made

**File: `backend/services/agent-runner/pyproject.toml`**
```diff
- langgraph-checkpoint-sqlite = "^2.0.0"
+ langgraph-checkpoint-sqlite = "^3.0.0"
```

**Dependency Resolution:**
- `langgraph-checkpoint-sqlite`: 2.0.10 → 3.0.3
- `aiosqlite`: 0.22.1 (unchanged, now compatible)
- `langgraph-checkpoint`: 3.0.1 (satisfies new requirement: `>=3,<5.0.0`)

### Testing Performed

1. **Direct Python test**: Verified `AsyncSqliteSaver.from_conn_string()` works with both in-memory and file-based databases
2. **Dependency verification**: Confirmed only `langgraph-checkpoint-sqlite` changed in lock file
3. **API compatibility**: Verified existing usage in `checkpointer/factory.py` remains unchanged

### Why the Version Bump is Safe

- **No API changes**: The `AsyncSqliteSaver.from_conn_string()` API used by Stigmer is unchanged
- **Aligned versioning**: The 2.x → 3.x bump aligns with `langgraph-checkpoint` 3.x series, not due to breaking changes
- **New dependency**: Adds `sqlite-vec >=0.1.6` (SQLite vector extension) which installs cleanly
- **Verified in test**: Confirmed checkpointer creation works correctly with new version

## Benefits

- **Unblocks development**: Agent executions work again in local mode
- **Future-proof**: Compatible with latest aiosqlite versions going forward
- **Production-ready**: Fix verified by upstream and tested in our environment
- **Minimal change**: Single-line dependency update with no code changes required

## Impact

### Who's Affected

- **Local development**: All developers running agents with SQLite checkpointer (default for MODE=local)
- **Agent executions**: Any execution requiring HITL approval or conversation persistence
- **CI/CD**: Automated testing using SQLite checkpointers

### Services Impacted

- `backend/services/agent-runner` - Primary impact (uses SQLite checkpointer in local mode)

### Blast Radius

**Positive**: Fixes a complete blocker for agent execution
**Risk**: Very low - upstream fix, API-compatible, isolated to checkpointer dependency

## Related Work

- **Upstream Issue**: [langchain-ai/langgraph#6583](https://github.com/langchain-ai/langgraph/issues/6583)
- **Upstream Fix**: [langchain-ai/langgraph#6699](https://github.com/langchain-ai/langgraph/pull/6699)
- **Breaking Change**: [aiosqlite#368](https://github.com/omnilib/aiosqlite/issues/368)

### Previous Related Changes

- **2026-02-14**: Fixed SQLite checkpointer context manager bug (separate issue, also checkpointer-related)

---

**Status**: ✅ Production Ready  
**Timeline**: Identified and fixed within single session (< 2 hours)  
**Verification**: Direct Python tests confirm fix resolves issue
