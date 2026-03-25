# Fix MongoDB Checkpointer: Upstream API Migration

**Date**: March 25, 2026

## Summary

Fixed a production crash where every cloud agent execution failed with `ModuleNotFoundError: No module named 'langgraph.checkpoint.mongodb.aio'`. The root cause was an upstream API restructuring in `langgraph-checkpoint-mongodb` 0.3.x that removed the `aio` submodule and replaced `AsyncMongoDBSaver` with a unified `MongoDBSaver` class. Added a build-time import verification gate to prevent this class of breakage from reaching production in the future.

## Problem Statement

Agent executions in cloud mode were failing immediately at the checkpointer initialization stage. The `ExecuteGraphton` Temporal activity could not create a MongoDB checkpointer, causing every execution to enter the `FAILED` phase before the agent could start.

### Pain Points

- Every agent execution in cloud mode failed before the agent could even begin processing
- The error message ("package not installed") was misleading -- the package was installed, but the import path had changed
- No build-time gate existed to catch import failures for checkpointer backends, meaning the breakage was only discovered at runtime in production

## Solution

Updated the checkpointer factory to use the current `langgraph-checkpoint-mongodb` 0.3.1 API:

- **Old API**: `from langgraph.checkpoint.mongodb.aio import AsyncMongoDBSaver` (using `motor` async driver)
- **New API**: `from langgraph.checkpoint.mongodb import MongoDBSaver` (using `pymongo` sync driver with `run_in_executor` for async)

## Implementation Details

### Factory Migration (`worker/checkpointer/factory.py`)

The `_mongodb_checkpointer` function was updated to:
1. Import `MongoDBSaver` from `langgraph.checkpoint.mongodb` instead of the removed `aio` submodule
2. Use `pymongo.MongoClient` instead of `motor.motor_asyncio.AsyncIOMotorClient`
3. Pass the client as a positional argument (matching the new constructor signature)

The lifecycle management pattern (create client, yield saver, close client in `finally`) was preserved unchanged.

### Dependency Cleanup (`pyproject.toml`, `poetry.lock`)

- Removed `motor = "^3.0.0"` from dependencies -- no longer needed since `MongoDBSaver` uses `pymongo` internally
- `pymongo` is pulled transitively by `langgraph-checkpoint-mongodb`, so no explicit declaration is needed
- Regenerated `poetry.lock` to reflect the removal

### Build-Time Verification Gate (`Dockerfile`)

Added a new `RUN` step in the builder stage that imports all three checkpointer backends:
```
MemorySaver, AsyncSqliteSaver, MongoDBSaver
```
This follows the existing pattern used for the `deepagents` namespace collision workaround. If any future dependency upgrade breaks namespace package resolution across the `langgraph.checkpoint.*` namespace, the Docker build fails rather than the production pod.

### Test Updates (`tests/test_checkpointer_factory.py`)

All 5 MongoDB test cases were updated to mock the new API surface (`pymongo.MongoClient` and `MongoDBSaver`) instead of the old `motor`/`AsyncMongoDBSaver` mocks.

## Benefits

- Cloud agent executions are unblocked -- the MongoDB checkpointer initializes correctly
- Reduced dependency footprint -- `motor` and its transitive dependencies are removed
- Future-proofed -- the build-time verification gate catches import failures at build time, not in production

## Impact

- **Agent Runner** (Python, Temporal worker): Core fix in checkpointer factory
- **Cloud deployments**: All cloud agent executions were affected; fix unblocks them
- **Local/OSS mode**: No impact (uses `sqlite` checkpointer by default)
- **Dependency tree**: `motor` removed; `pymongo` retained as transitive dependency

## Related Work

- `9a62d45c` (Jan 30): Original checkpointer infrastructure implementation
- `da54acb2` (Mar 22): Added MongoDB checkpointer env vars to kustomize (activated the failing code path)

---

**Status**: Production Ready
**Timeline**: ~1 hour diagnosis and fix
