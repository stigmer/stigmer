# Fix CI Pipeline and Test Suite Failures

**Date**: May 7, 2026

## Summary

Resolved three distinct failures affecting the CI pipeline and local test suite: a missing `react-virtuoso` dependency breaking the site build, a stale test assertion in the agent-runner status builder tests, and a test-ordering pollution issue causing `temporalio` import failures across 7 MongoDB validation tests.

## Problem Statement

The `release.website` CI workflow and `make check` were both failing, blocking development workflow.

### Pain Points

- CI `pages-build` job failing with `Module not found: Can't resolve 'react-virtuoso'` during Next.js site build
- `test_task_tool_subject_generated_via_llm` failing due to test assertion not matching updated production code signature
- All 7 `TestValidateMongoDBConnectivity` tests failing with `AttributeError: module 'temporalio' has no attribute 'workflow'` when run in the full suite (but passing in isolation)

## Solution

Three targeted fixes, one per root cause:

1. **Site build**: Added `react-virtuoso` as a direct dependency of the site, satisfying the optional peer dependency from `@stigmer/react`
2. **Status builder test**: Updated the mock assertion to include the `execution_id` keyword argument that was added to the production `_generate_sub_agent_subject` call
3. **MongoDB tests**: Added module-level cleanup in `test_worker_mongodb_validation.py` that purges stale `MagicMock` stubs for `temporalio.*` from `sys.modules` before tests run

## Implementation Details

### `site/package.json`

Added `"react-virtuoso": "^4.18.6"` to dependencies. The `VirtualizedThread.tsx` component in `@stigmer/react` imports from `react-virtuoso`, which is declared as an optional peer dependency of the SDK. Since the site consumes the SDK via `file:../sdk/react`, Next.js resolves the import transitively and requires the package to be installed.

### `test_status_builder.py`

Added `execution_id="test-execution-123"` to `mock_gen.assert_called_once_with(...)`. The production code was updated to pass `execution_id=sb.execution_id` to `_generate_sub_agent_subject`, but the test assertion was not updated to match.

### `test_worker_mongodb_validation.py`

Added a module-level cleanup block that identifies and removes any `temporalio.*` entries in `sys.modules` that are `MagicMock` instances. Three other test files (`test_connect_workflow_short_circuit.py`, `test_proxy_scope_headers.py`, `test_sub_agent_scope_header.py`) inject mock temporalio modules at import time for isolation purposes but never restore them. When the MongoDB tests run later in the suite, the stale mocks prevent the real `temporalio.worker` from loading.

## Benefits

- CI `release.website` pipeline unblocked
- `make check` passes clean (0 failures, 1393 Python tests pass)
- No more test-ordering sensitivity in the agent-runner test suite

## Impact

- **CI**: Site build and deployment restored
- **Developer experience**: `make check` is green again for all contributors
- **Test reliability**: MongoDB validation tests no longer depend on execution order

## Related Work

- Previous make check fixes: `2026-05-07-120141-make-check-fixes.md`

---

**Status**: ✅ Production Ready
