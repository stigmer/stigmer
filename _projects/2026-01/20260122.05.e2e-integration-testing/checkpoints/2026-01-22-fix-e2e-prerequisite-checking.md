# Fix E2E Test Prerequisite Checking

**Date**: 2026-01-22  
**Project**: E2E Integration Testing Framework  
**Milestone**: Test Infrastructure Improvement

---

## Summary

Fixed E2E test prerequisite checking by moving validation from Makefile to test suite and correcting the Temporal port check. Tests now properly validate infrastructure requirements using standard Go testing patterns.

## Problem Identified

User reported: "I'm trying to run E2E tests, and it says it can't find Temporal, but the Stigmer server says it is running."

Investigation revealed two issues:

1. **Wrong port/protocol**: Makefile checked port 7233 via HTTP, but that's Temporal's **gRPC port**
2. **Wrong architecture**: Prerequisite checks belonged in test suite, not Makefile

```bash
# What was happening:
$ make test-e2e
Checking prerequisites...
❌ ERROR: Temporal not detected on localhost:7233  # HTTP check on gRPC port!

# Reality:
$ lsof -i :7233
temporal 23344 ... TCP localhost:7233 (LISTEN)  # Temporal WAS running!

$ lsof -i :8233
temporal 23344 ... TCP *:8233 (LISTEN)  # Web UI on port 8233!
```

## Solution

### 1. Added Test Suite Prerequisite Checking

**File**: `test/e2e/suite_test.go`

- Added `SetupSuite()` method (runs once before all tests)
- Checks Temporal via Web UI (port 8233 HTTP)
- Checks Ollama via API (port 11434 HTTP)
- Provides clear error messages with setup instructions

### 2. Created checkTemporal() Function

**File**: `test/e2e/prereqs_test.go`

- New function that checks Temporal **Web UI on port 8233** (correct HTTP endpoint)
- 3-second timeout
- Clear error messages

### 3. Simplified Makefile

**File**: `Makefile`

- Removed all prerequisite checking logic
- Just mentions what's needed
- Delegates validation to tests (proper separation of concerns)

## Port Reference

| Service | Port | Protocol | Check Method |
|---------|------|----------|--------------|
| Temporal gRPC | 7233 | gRPC | ❌ Can't use HTTP |
| Temporal Web UI | 8233 | HTTP | ✅ `curl http://localhost:8233` |
| Ollama API | 11434 | HTTP | ✅ `curl http://localhost:11434/api/version` |

## Why This Is Better

### ✅ Standard Go Testing Practice
- Prerequisites checked in test initialization (`SetupSuite`)
- Follows testify/suite patterns
- Not in build tools (Makefile)

### ✅ Better Error Messages
- Tests provide context-specific guidance
- Include setup instructions  
- Show exactly what to run

### ✅ Works with Any Test Runner
- Not tied to Make
- Works with `go test` directly
- Works in IDEs

### ✅ Correct Check
- Uses HTTP endpoint (port 8233) for Web UI
- Not gRPC endpoint (port 7233)
- More reliable validation

### ✅ Single Source of Truth
- One place for prerequisite logic (`prereqs_test.go`)
- No duplication between Makefile and tests
- Easier to maintain

## Testing

Verified the fix works:

```bash
$ cd test/e2e
$ go test -v -tags=e2e -timeout 60s

=== RUN   TestE2E
    suite_test.go:23: Checking E2E test prerequisites...
    suite_test.go:43: ✓ Temporal detected at localhost:7233
    suite_test.go:61: ✓ Ollama detected at localhost:11434
    suite_test.go:63: All prerequisites met, starting E2E tests...
=== RUN   TestE2E/TestApplyBasicAgent
    suite_test.go:74: Test temp directory: /var/.../stigmer-e2e-1263548771
    harness_test.go:87: Started stigmer-server on port 50028
    ... tests run successfully ...
```

## Files Changed

```
test/e2e/suite_test.go          - Added SetupSuite() with prerequisite checking
test/e2e/prereqs_test.go        - Added checkTemporal() function  
Makefile                        - Removed prerequisite checking logic
```

## Impact

**Benefits**:
- ✅ Tests now run successfully when infrastructure is healthy
- ✅ Better error messages for debugging
- ✅ Standard Go testing patterns
- ✅ Works with any test runner
- ✅ No Makefile dependency for prerequisite checking

**No Breaking Changes**:
- `make test-e2e` still works
- Test execution unchanged
- Infrastructure requirements unchanged

## Next Steps

Test infrastructure is now more robust and follows Go best practices. Ready to continue with additional test scenarios or Phase 3 planning.

## Related

- Changelog: `_changelog/2026-01/2026-01-22-235249-fix-e2e-test-prerequisite-checking.md`
- E2E test README already documents prerequisites
- Tests now enforce what documentation describes
