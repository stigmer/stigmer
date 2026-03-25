# Agent Runner: MongoDB Startup Validation

**Date**: March 25, 2026

## Summary

Added a fail-fast MongoDB connectivity check at agent-runner startup in cloud mode. When the checkpointer type is `mongodb`, the worker now pings the MongoDB instance during initialization -- before the Temporal worker begins polling for tasks -- to surface authentication and network issues immediately with actionable error messages.

## Problem Statement

When the `stigmer-app` MongoDB user was missing or misconfigured, the agent-runner would start normally and begin accepting Temporal tasks. The first agent execution would then fail deep inside the LangGraph checkpointer initialization with a generic `pymongo.errors.OperationFailure: Authentication failed` error. This made diagnosis difficult because:

- The error appeared only on first execution, not at startup
- The error message gave no guidance on how to fix the issue
- Operators had to trace through checkpointer factory logs to understand the root cause

## Solution

Added `_validate_mongodb_connectivity()` to the `AgentRunner` class, following the existing pattern of `_initialize_redis()` and `_initialize_daytona_volume()` -- cloud-mode infrastructure validated once at worker startup.

## Implementation Details

### Startup Validation (`worker/worker.py`)

The `_validate_mongodb_connectivity` method:
- Skips silently for non-mongodb checkpointer types (`memory`, `sqlite`)
- Creates a temporary `pymongo.MongoClient` with a 5-second `serverSelectionTimeoutMS`
- Runs `client.admin.command("ping")` to verify both connectivity and authentication
- On `ConnectionFailure`: raises `RuntimeError` with network troubleshooting guidance
- On `OperationFailure`: raises `RuntimeError` referencing the `mongodb-app-user-provisioning` Job
- Always closes the client in a `finally` block

Called from `AgentRunner.__init__` after Redis and Daytona initialization:

```python
if not config.is_local_mode():
    self._initialize_redis()
    self._initialize_daytona_volume()
    self._validate_mongodb_connectivity()
```

### Test Coverage (`tests/test_worker_mongodb_validation.py`)

7 tests covering:
- Successful ping (no exception, client closed)
- `ConnectionFailure` raises `RuntimeError` with "unreachable" message
- `OperationFailure` raises `RuntimeError` with "authentication failed" message
- Skipped for `memory` checkpointer type
- Skipped for `sqlite` checkpointer type
- Missing URI raises `ValueError`
- Client closed even on unexpected exceptions

## Benefits

- **Fail-fast**: Operator knows within seconds of startup if MongoDB is misconfigured
- **Actionable errors**: Error messages reference the specific Job to run for provisioning
- **Consistent pattern**: Follows the same startup validation pattern as Redis and Daytona

## Impact

- **Cloud mode, mongodb checkpointer**: Worker will refuse to start if MongoDB is unreachable or credentials are invalid
- **Local mode / non-mongodb**: No behavior change

## Files Changed

**Modified** (1 file):
- `backend/services/agent-runner/worker/worker.py`

**Created** (1 file):
- `backend/services/agent-runner/tests/test_worker_mongodb_validation.py`

## Related Work

- Follows from the MongoDB checkpointer upstream API migration (same day)
- Complements the MongoDB app user provisioning Job (stigmer-cloud)

---

**Status**: Production Ready
