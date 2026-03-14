# Fix make check Test Alignment After api_key and model_override Changes

**Date**: March 14, 2026

## Summary

Fixed 10 failing tests across Go and Python that broke `make check` after two recent production changes: adding `api_key` to the CLI type registry and adding `model_override` validation to the subagent transformer. All tests now pass and the CI gate is green.

## Problem Statement

`make check` was failing with 10 test failures across three test files, blocking the CI gate for the `feat/usage-metrics-and-cost-optimization` branch.

### Pain Points

- **Go CLI tests**: 4 failures — the `api_key` kind was added to `cliRelevantKinds` in `registry.go` (7 types total), but tests in `registry_test.go` and `routing_test.go` still hardcoded expectations for 6 types
- **Python agent-runner tests**: 7 failures — a new `model_override` validation in `subagent_transformer.py` checks the field against the `ModelRegistry`. Since all test mocks used `MagicMock()`, accessing `sub_agent.model_override` auto-created a truthy `MagicMock` object, which the registry rejected as an unknown model, causing every subagent to be skipped

## Solution

Aligned test expectations with the current production code:

1. **Go tests**: Updated type counts from 6→7 and added `ApiKey` / `api_key` to expected-types lists
2. **Python tests**: Explicitly set `model_override = ""` on all 10 mock sub-agents so the falsy empty string bypasses the validation gate, matching the behavior of a real proto sub-agent with no override set

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/types/registry_test.go` | Count 6→7, added `api_key` to expectedKinds, updated VerbGet/VerbList/VerbDelete counts |
| `client-apps/cli/cmd/stigmer/root/routing_test.go` | Count 6→7, added `"ApiKey"` to expectedTypes |
| `backend/services/agent-runner/tests/test_integration_subagent_pipeline.py` | Added `sub_agent.model_override = ""` to all 10 mock sub-agents across 9 test methods |

### Root Cause Analysis

The Go failures were a straightforward missed update — the `api_key` kind was added to the registry but tests weren't bumped.

The Python failures are a subtler `MagicMock` footgun: MagicMock auto-creates attributes on access, returning a truthy mock object. The new validation code checks `if sub_agent.model_override:` — which evaluates to `True` for a MagicMock, entering the validation path and failing because `MagicMock.__str__()` is not a registered model name.

## Benefits

- `make check` passes end-to-end (exit code 0, 1237 Python tests + all Go tests green)
- CI gate is unblocked for the usage-metrics branch
- Test mocks now explicitly declare `model_override`, making the validation contract visible in tests

## Impact

- **Developers**: CI gate is green again; no further action needed
- **Test reliability**: Mocks are now explicit about the `model_override` field, preventing future MagicMock attribute auto-creation surprises

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes
