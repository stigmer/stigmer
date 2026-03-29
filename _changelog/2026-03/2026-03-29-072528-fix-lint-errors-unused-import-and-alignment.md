# Fix Lint Errors: Unused Import and Struct Alignment

**Date**: March 29, 2026

## Summary

Resolved lint errors caught by `make check` — removed an unused protobuf import in the HITL contracts test suite and fixed struct field alignment in the approval field preserver.

## Problem Statement

`make check` on the stigmer repo was failing with exit code 2 due to a Python lint violation.

### Pain Points

- `AgentMessage` was imported but never used in `test_hitl_contracts.py`, causing a Ruff F401 error
- Struct field alignment in `preserve.go` was inconsistent (cosmetic, caught by `gofmt`)

## Solution

- Removed the unused `AgentMessage` import from `test_hitl_contracts.py`
- Aligned struct field declarations in `approvalSnapshot` to satisfy `gofmt`

## Impact

- `make check` now passes cleanly on both `stigmer` and `stigmer-cloud` repos
- All 1359 Python tests and full TypeScript/Go build+test pipeline pass

---

**Status**: ✅ Production Ready
