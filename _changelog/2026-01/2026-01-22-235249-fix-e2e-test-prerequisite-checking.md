# Fix E2E Test Prerequisite Checking

**Date**: 2026-01-22  
**Type**: Bug Fix  
**Scope**: E2E Tests  
**Impact**: Test Infrastructure

## Summary

Fixed E2E test prerequisite checking by moving validation from Makefile to test suite and correcting the Temporal port check. Tests now properly validate infrastructure requirements using Go testing patterns.

## Problem

The E2E test prerequisite checking in the Makefile had two issues:

1. **Wrong port check**: Checked port 7233 via HTTP, but that's Temporal's gRPC port, not HTTP
2. **Wrong separation of concerns**: Makefiles should run tests, not validate prerequisites

```bash
# Makefile was doing:
curl -s http://localhost:7233  # ❌ Fails - gRPC port, not HTTP
```

This caused `make test-e2e` to fail even though:
- Temporal WAS running on port 7233 (gRPC)
- Temporal Web UI WAS running on port 8233 (HTTP)
- All infrastructure was healthy

## What Changed

### 1. Added Test Suite Prerequisite Checking

**File**: `test/e2e/suite_test.go`

Added `SetupSuite()` method that runs **once before all tests**:

```go
func (s *E2ESuite) SetupSuite() {
    s.T().Log("Checking E2E test prerequisites...")
    
    // Check Temporal (via Web UI on port 8233)
    if err := checkTemporal(); err != nil {
        s.T().Fatalf(`Temporal is not running or not accessible.
        
Required for: Workflow orchestration

Setup:
  Start stigmer server (includes Temporal):
    stigmer server

To verify Temporal is running:
  curl http://localhost:8233

Error: %v`, err)
    }
    s.T().Log("✓ Temporal detected at localhost:7233")
    
    // Check Ollama
    if err := checkOllama(); err != nil {
        s.T().Fatalf(`Ollama is not running...`)
    }
    s.T().Log("✓ Ollama detected at localhost:11434")
    
    s.T().Log("All prerequisites met, starting E2E tests...")
}
```

### 2. Added checkTemporal() Function

**File**: `test/e2e/prereqs_test.go`

New function that checks Temporal **Web UI on port 8233** (HTTP):

```go
// checkTemporal verifies Temporal server is running (checks Web UI on port 8233)
func checkTemporal() error {
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    // Check Temporal Web UI (port 8233) instead of gRPC port (7233)
    req, err := http.NewRequestWithContext(ctx, "GET", "http://localhost:8233", nil)
    if err != nil {
        return fmt.Errorf("failed to create request: %w", err)
    }

    client := &http.Client{Timeout: 3 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        return fmt.Errorf("failed to connect to Temporal (is stigmer server running?): %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("Temporal returned status %d (expected 200)", resp.StatusCode)
    }

    return nil
}
```

### 3. Simplified Makefile

**File**: `Makefile`

Removed prerequisite checking logic:

```makefile
test-e2e: ## Run E2E integration tests (requires: stigmer server + ollama running)
    @echo "============================================"
    @echo "Running E2E Integration Tests"
    @echo "============================================"
    @echo ""
    @echo "Prerequisites (checked by tests):"
    @echo "  1. Stigmer server: stigmer server"
    @echo "  2. Ollama: ollama serve"
    @echo ""
    cd test/e2e && go test -v -tags=e2e -timeout 60s ./...
    @echo ""
    @echo "============================================"
    @echo "✓ E2E Tests Complete!"
    @echo "============================================"
```

## Why This Is Better

### Standard Go Testing Practice
- Prerequisites checked in test initialization (SetupSuite)
- Not in build tools (Makefile)
- Follows testify/suite patterns

### Better Error Messages
- Tests provide context-specific guidance
- Include setup instructions
- Show exactly what to run

### Works with Any Test Runner
- Not tied to Make
- Works with `go test` directly
- Works in IDEs

### Correct Check
- Uses HTTP endpoint (port 8233) for Web UI
- Not gRPC endpoint (port 7233)
- More reliable validation

### Graceful Handling
- Tests can fail with helpful messages
- Clear prerequisites shown
- Easy to debug

### Single Source of Truth
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
    ... tests run successfully ...
```

## Port Reference

For future reference:

| Service | Port | Protocol | Check Method |
|---------|------|----------|--------------|
| Temporal gRPC | 7233 | gRPC | Can't use HTTP |
| Temporal Web UI | 8233 | HTTP | `curl http://localhost:8233` ✅ |
| Ollama API | 11434 | HTTP | `curl http://localhost:11434/api/version` ✅ |

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

## Files Changed

```
test/e2e/suite_test.go          - Added SetupSuite() with prerequisite checking
test/e2e/prereqs_test.go        - Added checkTemporal() function
Makefile                        - Removed prerequisite checking logic
```

## Related

- E2E test README already documents prerequisites
- Tests now enforce what documentation describes
- Consistent prerequisite checking across all tests
