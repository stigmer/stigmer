# Checkpoint 07: Option 1 Implementation - Build Tags & CI/CD Strategy

**Date**: 2026-01-22  
**Status**: ✅ COMPLETE  
**Decision**: Option 1 (Use Existing stigmer server Instance)

---

## Summary

Implemented a clean E2E test strategy using **build tags** to separate E2E tests from unit tests. Tests now assume `stigmer server` is already running and connect to existing Temporal/Ollama instances.

---

## Key Decisions

### Test Strategy: Option 1

**Chosen Approach**: Use existing `stigmer server` instance (simplest)

**Tests assume**:
- Temporal is running on `localhost:7233`
- Ollama is running on `localhost:11434`
- `stigmer server` (or equivalent) manages infrastructure

**Benefits**:
- ✅ **Simplest** - No Temporal lifecycle management in tests
- ✅ **Fast** - Tests start immediately
- ✅ **Inspectable** - View all test data in Temporal UI
- ✅ **Realistic** - Uses actual dev environment

**Trade-offs**:
- ⚠️ Requires infrastructure running before tests
- ⚠️ Shared state (acceptable for local development)
- ⚠️ Not suitable for CI/CD initially

### Build Tag Strategy

**Pattern**: Use Go build tags to separate test types

```go
//go:build e2e
// +build e2e

package e2e
```

**Result**:
- **Without tag**: `go test` → No E2E tests run (unit tests only)
- **With tag**: `go test -tags=e2e` → E2E tests run

---

## Implementation Changes

### 1. Added Build Tags to All E2E Test Files

Files modified:
- ✅ `suite_test.go`
- ✅ `e2e_apply_test.go`
- ✅ `e2e_run_test.go`
- ✅ `e2e_run_full_test.go`
- ✅ `smoke_test.go`
- ✅ `harness_test.go`
- ✅ `helpers_test.go`
- ✅ `prereqs_test.go`
- ✅ `cli_runner_test.go`
- ✅ `database_test.go`
- ✅ `standalone_test.go`

### 2. Simplified Test Harness

**Removed**:
- Docker Compose management
- Temporal lifecycle management
- agent-runner container management

**Kept**:
- stigmer-server startup (isolated DB + random port)
- Test isolation (temp directories)
- API verification helpers

**New Structure**:
```go
type TestHarness struct {
    ServerCmd  *exec.Cmd  // stigmer-server process
    ServerPort int        // Random port (isolation)
    TempDir    string     // Isolated database
    
    // Assumes external instances
    TemporalAddr      string  // localhost:7233
    TemporalReady     bool    // Detected on startup
    AgentRunnerReady  bool    // Managed by stigmer server
}
```

### 3. Updated Makefile

**New targets**:
```makefile
# Unit tests only (no infrastructure, runs in CI)
make test

# E2E tests (requires infrastructure)
make test-e2e

# All tests (unit + E2E)
make test-all
```

**Prerequisite checking**:
- `make test-e2e` verifies Temporal and Ollama are running
- Clear error messages if prerequisites missing

### 4. Comprehensive Documentation

Created `test/e2e/README.md` with:
- ✅ Prerequisites explanation
- ✅ Running instructions
- ✅ Debugging guide
- ✅ CI/CD strategy
- ✅ Architecture overview
- ✅ Contributing guidelines

---

## Usage

### Running E2E Tests Locally

**Step 1**: Start infrastructure (Terminal 1)
```bash
stigmer server
```

**Step 2**: Run E2E tests (Terminal 2)
```bash
# Using make
make test-e2e

# Or directly
cd test/e2e && go test -v -tags=e2e -timeout 60s
```

### Running Unit Tests (CI/CD)

```bash
# No prerequisites needed
make test

# Or via go test (skips E2E)
go test ./...
```

---

## CI/CD Strategy

### Current: E2E Tests Excluded from CI

**Why?**
- Require running infrastructure (Temporal, Ollama)
- Slower than unit tests (~60s vs ~10s)
- Best run locally or in dedicated E2E environment

**How it works**:
```bash
# In CI pipeline (GitHub Actions)
go test ./...  # ✅ Unit tests run
# E2E tests skipped (no build tag)
```

### Future: Dedicated E2E Infrastructure

When ready for CI integration:

**Option A: Managed Infrastructure**
```yaml
# .github/workflows/e2e.yml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - name: Start Stigmer Server
        run: |
          stigmer server &
          sleep 10
      - name: Run E2E Tests
        run: make test-e2e
```

**Option B: Use Temporal Cloud**
- Connect to shared Temporal Cloud instance
- Use test namespaces for isolation
- Faster than local Temporal startup

---

## Test Verification

### Build Tag Works

```bash
$ cd test/e2e && go test -v
# github.com/stigmer/stigmer/test/e2e
package github.com/stigmer/stigmer/test/e2e: build constraints exclude all Go files
✅ Correctly skips E2E tests
```

```bash
$ cd test/e2e && go test -tags=e2e -list=.
TestDatabaseReadWrite
TestFullExecution
TestStandalone
TestE2E
✅ Lists E2E tests with build tag
```

### Tests Compile Successfully

```bash
$ cd test/e2e && go test -tags=e2e -list=.
ok      github.com/stigmer/stigmer/test/e2e     1.184s
✅ All E2E tests compile successfully
```

---

## What's Next

### Phase 2: Full Execution Testing

Now that infrastructure is simplified, we can focus on Phase 2:

**Ready to implement**:
1. Complete agent execution tests (LLM calls)
2. Workflow execution tests
3. Log streaming tests

**Approach**:
- Tests connect to existing `stigmer server` instance
- Agent executions appear in Temporal UI with `e2e-test-` prefix
- Easy to debug and inspect

### Future Enhancements

**Test isolation** (if needed):
- Use test namespaces in Temporal
- Add cleanup jobs to remove test data
- Implement test data lifecycle management

**CI integration** (when ready):
- Set up dedicated E2E environment
- Add E2E workflow to GitHub Actions
- Use Temporal Cloud for faster tests

---

## Files Changed

### Created

```
test/e2e/README.md                     # Comprehensive documentation
_projects/.../checkpoints/07-*.md      # This checkpoint
```

### Modified

```
test/e2e/suite_test.go                 # Added build tag
test/e2e/e2e_apply_test.go             # Added build tag
test/e2e/e2e_run_test.go               # Added build tag
test/e2e/e2e_run_full_test.go          # Added build tag
test/e2e/smoke_test.go                 # Added build tag
test/e2e/harness_test.go               # Simplified, added build tag
test/e2e/helpers_test.go               # Added build tag
test/e2e/prereqs_test.go               # Added build tag
test/e2e/cli_runner_test.go            # Added build tag
test/e2e/database_test.go              # Added build tag
test/e2e/standalone_test.go            # Added build tag
Makefile                               # Added test-e2e target
```

---

## Common Patterns in the Industry

### How Other Projects Handle E2E Tests

**Kubernetes**:
- Separate E2E binary (`test/e2e/e2e.test`)
- Dedicated CI jobs with cluster setup
- Uses environment variables for test selection

**Docker**:
- E2E tests require Docker daemon
- Skipped automatically if daemon unavailable
- Uses build tags + environment checks

**Temporal**:
- Integration tests in separate directories
- Make targets for different test suites
- Uses test namespaces for isolation

**HashiCorp (Terraform)**:
- Acceptance tests use build tags
- `TF_ACC=1` environment variable required
- Clear separation from unit tests

**Our approach**: Combination of best practices from all above.

---

## Lessons Learned

### 1. Option 1 is the Right Choice

**Why it works**:
- Minimal complexity (no lifecycle management)
- Fast test execution (no startup overhead)
- Easy debugging (Temporal UI inspection)
- Matches local development workflow

**Trade-off**: Tests require external infrastructure, but that's acceptable because:
- Developers already run `stigmer server` for local dev
- CI/CD can skip E2E tests initially
- Future CI integration is straightforward

### 2. Build Tags > Environment Variables

**Advantages**:
- Clean separation at compile time
- No runtime checks needed
- Standard Go practice
- Works with all go tools (`go test`, `go list`, etc.)

### 3. Documentation is Critical

**Why README matters**:
- Explains prerequisites clearly
- Shows exact commands to run
- Provides troubleshooting guide
- Documents design decisions

---

## Success Metrics

✅ **All E2E tests compile** with build tag  
✅ **No E2E tests run** without build tag  
✅ **Makefile targets** work correctly  
✅ **README** provides complete guide  
✅ **CI-friendly** (unit tests separate)

---

**Next Action**: Proceed with Phase 2 full execution testing  
**Estimated Time**: 2-3 hours  
**Confidence**: HIGH (95%) - Infrastructure is now simple and reliable
