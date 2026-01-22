# E2E Test Infrastructure: Build Tags & Option 1 Architecture

**Date**: 2026-01-22  
**Type**: Infrastructure  
**Impact**: Test infrastructure, CI/CD strategy  
**Status**: Complete

---

## Summary

Implemented a production-ready E2E test strategy using Go build tags to separate E2E tests from unit tests. Tests now connect to existing `stigmer server` instance (Option 1 architecture) instead of managing Docker infrastructure, making tests faster, simpler, and more debuggable.

---

## Context

### The Challenge

After completing Phase 1 E2E tests (smoke tests that verify CLI → Server → Database flow), we needed to:
1. Decide on infrastructure strategy for Phase 2 (full execution with LLM)
2. Determine how to handle E2E tests in CI/CD
3. Choose between Docker-managed infrastructure vs. existing local setup

### User Requirements

User expressed clear preferences:
- "Why use Docker when we have local binaries?"
- "I want to see test data in Temporal UI for debugging"
- "Can't we use the same Temporal instance as local development?"
- "E2E tests shouldn't run in CI initially"

---

## What Changed

### 1. Architecture Decision: Option 1

**Chose**: Connect to existing `stigmer server` instance  
**Rejected**: Docker Compose with isolated Temporal

**Rationale**:
- ✅ Simpler (no lifecycle management)
- ✅ Faster (no Docker startup overhead)
- ✅ Debuggable (inspect in Temporal UI)
- ✅ Matches local dev workflow
- ⚠️ Trade-off: Requires infrastructure running (acceptable for local dev)

**Implementation**:
- Tests assume Temporal on `localhost:7233`
- Tests assume Ollama on `localhost:11434`
- Tests assume `stigmer server` manages both
- No Docker management in test harness

### 2. Build Tags for Test Separation

**Pattern**: Go build tags

```go
//go:build e2e
// +build e2e

package e2e
```

**Result**:
- `go test` → No E2E tests run (unit tests only)
- `go test -tags=e2e` → E2E tests run

**Files updated** (11 total):
- `suite_test.go`
- `e2e_apply_test.go`
- `e2e_run_test.go`
- `e2e_run_full_test.go`
- `smoke_test.go`
- `harness_test.go`
- `helpers_test.go`
- `prereqs_test.go`
- `cli_runner_test.go`
- `database_test.go`
- `standalone_test.go`

### 3. Simplified Test Harness

**Removed**:
```go
// No longer needed:
type TestHarness struct {
    DockerComposeCmd *exec.Cmd
    DockerEnabled    bool
}

func (h *TestHarness) startDockerServices() error { /* ... */ }
func (h *TestHarness) stopDockerServices() { /* ... */ }
func (h *TestHarness) waitForTemporal() bool { /* ... */ }
func (h *TestHarness) waitForAgentRunner() bool { /* ... */ }
```

**Kept**:
```go
type TestHarness struct {
    ServerCmd  *exec.Cmd  // stigmer-server (isolated DB)
    ServerPort int        // Random port (test isolation)
    TempDir    string     // Isolated database
    
    // Assumes external instances:
    TemporalAddr      string  // localhost:7233
    TemporalReady     bool    // Detected on startup
    AgentRunnerReady  bool    // Managed by stigmer server
}
```

**Benefits**:
- ~200 lines of Docker management code removed
- Faster test startup (no Docker overhead)
- Simpler debugging (one less layer)

### 4. Makefile Updates

**New targets**:
```makefile
test:        # Unit tests only (CI-friendly)
test-e2e:    # E2E tests (requires infrastructure)
test-all:    # Both (local comprehensive testing)
```

**Prerequisites checking**:
```bash
# test-e2e verifies Temporal and Ollama before running
$ make test-e2e
# Checks localhost:7233 (Temporal)
# Checks localhost:11434 (Ollama)
# Clear error messages if prerequisites missing
```

### 5. Comprehensive Documentation

**Created `test/e2e/README.md` (312 lines)**:
- Prerequisites explanation
- Running instructions (both make and go test)
- Debugging guide (Temporal UI inspection)
- CI/CD strategy
- Architecture overview
- Test isolation patterns
- Contributing guidelines
- Common troubleshooting

**Created `CICD-STRATEGY.md`**:
- Explains why E2E tests are excluded from CI
- Industry examples (Kubernetes, Docker, Temporal, HashiCorp)
- Future CI integration options
- Decision matrix

**Created checkpoint**:
- `checkpoints/07-option-1-build-tags-complete.md`
- Comprehensive summary of implementation
- Design decisions and rationale

---

## Technical Details

### Option 1 Architecture

**Test Flow**:
```
Developer Terminal 1:
  $ stigmer server
  → Starts Temporal Lite (localhost:7233)
  → Starts stigmer-server (localhost:50051)
  → Starts agent-runner worker

Developer Terminal 2:
  $ make test-e2e
  → Tests connect to existing Temporal
  → Tests start isolated stigmer-server instances (random ports)
  → Tests write to shared Temporal with e2e-test- prefixes
```

**Test Isolation**:
- Each test: Fresh temp directory + random port
- Shared: Temporal instance (test prefixes for isolation)
- Shared: Ollama instance
- Result: Fast, isolated, inspectable

### Build Tags vs. Alternatives

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Build Tags** | Clean, standard Go practice | Requires `-tags` flag | ✅ Chosen |
| Env Variables | Simple to add | Runtime check overhead | ❌ Rejected |
| Test Skip Logic | No build tag | Scattered in code | ❌ Rejected |

**Implementation**:
```go
// Every E2E test file:
//go:build e2e
// +build e2e

package e2e
```

**Verification**:
```bash
$ cd test/e2e && go test
# build constraints exclude all Go files ✅

$ cd test/e2e && go test -tags=e2e -list=.
# TestE2E, TestFullExecution, etc. ✅
```

### Industry Alignment

**Pattern used by**:
- Kubernetes: `//go:build e2e`
- Docker: Skip if daemon unavailable
- Temporal: Separate make targets
- HashiCorp: `//go:build acceptance`

**Our implementation**:
- Follows Kubernetes pattern (most common)
- Clean compile-time separation
- Works with all go tools

---

## Why This Matters

### For Developers

**Fast feedback**:
```bash
$ make test
# Runs in ~10 seconds
# No prerequisites needed
# Perfect for PR checks
```

**Comprehensive testing when needed**:
```bash
$ stigmer server  # Terminal 1
$ make test-e2e   # Terminal 2
# Full integration testing
# LLM execution tests
# Temporal UI inspection
```

### For CI/CD

**Reliable pipelines**:
- No flaky Docker setup
- Fast test execution
- Predictable results

**Resource efficient**:
- No Temporal/Ollama in CI
- Cheaper compute costs
- Faster PR feedback

### For Debugging

**Easy inspection**:
```bash
# Tests write to your local Temporal
open http://localhost:8233
# Filter workflows by: e2e-test-
```

**Real environment**:
- Same as local development
- Easy to reproduce issues
- Can manually test alongside

---

## File Changes

### Modified

```
test/e2e/
  README.md                    (312 lines - comprehensive guide)
  suite_test.go                (added build tag)
  e2e_apply_test.go           (added build tag)
  e2e_run_test.go             (added build tag)
  e2e_run_full_test.go        (added build tag, simplified harness calls)
  smoke_test.go               (added build tag)
  harness_test.go             (added build tag, removed Docker code ~200 lines)
  helpers_test.go             (added build tag)
  prereqs_test.go             (added build tag)
  cli_runner_test.go          (added build tag)
  database_test.go            (added build tag)
  standalone_test.go          (added build tag)

Makefile                       (added test-e2e target with prerequisites check)

_projects/2026-01/20260122.05.e2e-integration-testing/
  CICD-STRATEGY.md             (complete CI/CD strategy document)
  checkpoints/07-*.md          (comprehensive checkpoint)
```

### Statistics

- **11 files**: Added build tags
- **1 file**: Removed ~200 lines of Docker management code
- **1 file**: Added `test-e2e` Makefile target
- **3 files**: Created comprehensive documentation

---

## Testing & Verification

### Build Tags Work

```bash
$ cd test/e2e && go test -v
# github.com/stigmer/stigmer/test/e2e
# package github.com/stigmer/stigmer/test/e2e: 
#   build constraints exclude all Go files
✅ Correctly skips E2E tests without build tag
```

```bash
$ cd test/e2e && go test -tags=e2e -list=.
TestDatabaseReadWrite
TestFullExecution
TestStandalone
TestE2E
ok      github.com/stigmer/stigmer/test/e2e     1.184s
✅ Lists E2E tests with build tag
```

### Tests Compile

```bash
$ cd test/e2e && go test -tags=e2e -list=.
ok      github.com/stigmer/stigmer/test/e2e     1.184s
✅ All E2E tests compile successfully
```

### Makefile Target Works

```bash
$ make test-e2e
# (Without stigmer server running)
❌ ERROR: Temporal not detected on localhost:7233
✅ Prerequisites check works

$ stigmer server  # Terminal 1
$ make test-e2e   # Terminal 2
✅ Tests run with infrastructure
```

---

## What's Next

### Phase 2: Full Execution Testing

Now ready to implement:
1. Complete agent execution tests (LLM calls)
2. Workflow execution tests
3. Log streaming tests

**Approach**:
- Connect to existing `stigmer server`
- Agent executions appear in Temporal UI
- Easy to debug and inspect

### Future Enhancements

**Test isolation** (if needed):
- Use test namespaces in Temporal
- Add cleanup jobs
- Test data lifecycle management

**CI integration** (when ready):
- Dedicated E2E environment
- GitHub Actions workflow
- Temporal Cloud option

---

## Lessons Learned

### 1. Option 1 is the Right Choice

**Why it works**:
- Matches local development workflow
- Minimal complexity
- Fast test execution
- Easy debugging

**Trade-off acceptable**:
- Tests require external infrastructure
- Developers already run `stigmer server`
- CI can skip E2E initially
- Future CI integration straightforward

### 2. Build Tags > Environment Variables

**Advantages**:
- Clean compile-time separation
- No runtime checks
- Standard Go practice
- Works with all go tools

### 3. Documentation is Critical

**Why README matters**:
- Explains prerequisites clearly
- Shows exact commands
- Troubleshooting guide
- Documents design decisions

**Result**:
- Developers can start testing immediately
- Clear understanding of architecture
- Easy to contribute new tests

### 4. Simplicity Wins

**Before**: Docker Compose + Temporal + agent-runner containers  
**After**: Connect to existing stigmer server

**Benefits**:
- ~200 lines of code removed
- Faster test startup
- Easier debugging
- Less maintenance

---

## Impact Assessment

### Positive Impacts

✅ **E2E tests separate from unit tests** (clean CI/CD)  
✅ **Fast local development** (no Docker overhead)  
✅ **Easy debugging** (Temporal UI inspection)  
✅ **Simple architecture** (~200 lines code removed)  
✅ **Comprehensive documentation** (312 line README)  
✅ **CI-friendly** (unit tests run fast, E2E skipped)  
✅ **Industry-standard pattern** (build tags)

### Trade-offs

⚠️ **Requires running infrastructure** for E2E tests  
→ Acceptable: Developers already run `stigmer server` for local dev

⚠️ **Shared Temporal state** (tests write to same instance)  
→ Mitigated: Test prefixes (`e2e-test-`) for isolation

⚠️ **No E2E in CI initially**  
→ Acceptable: Can add dedicated CI environment later

### Risk Mitigation

**Risk**: Tests fail if Temporal not running  
**Mitigation**: Prerequisites check with clear error messages

**Risk**: Test data collisions  
**Mitigation**: Test prefixes + timestamp in IDs

**Risk**: Developers forget prerequisites  
**Mitigation**: Comprehensive README + Makefile checks

---

## References

### Implementation Files

- `test/e2e/README.md` - Complete guide (312 lines)
- `test/e2e/harness_test.go` - Simplified harness
- `_projects/.../CICD-STRATEGY.md` - CI/CD strategy
- `checkpoints/07-*.md` - Full implementation checkpoint

### Related Conversations

- Phase 1 completion: All smoke tests passing
- Option 1 vs Docker discussion: User preference for simplicity
- Build tags research: Industry standard patterns

### External References

- [Go Build Tags](https://pkg.go.dev/go/build#hdr-Build_Constraints)
- [Kubernetes E2E Tests](https://github.com/kubernetes/kubernetes/tree/master/test/e2e)
- [Temporal Testing Best Practices](https://docs.temporal.io/docs/go/testing)

---

## Quality Checklist

- [x] All E2E test files have build tags
- [x] Build tags verified (tests skipped without tag)
- [x] Tests compile successfully with tag
- [x] Makefile target added with prerequisites check
- [x] Comprehensive README created (312 lines)
- [x] CI/CD strategy documented
- [x] Checkpoint captures full implementation
- [x] Docker management code removed (~200 lines)
- [x] Test harness simplified
- [x] Prerequisites checking works
- [x] Documentation follows Stigmer standards

---

**Status**: ✅ Complete  
**Ready for**: Phase 2 (Full Execution Testing)  
**Documentation**: Comprehensive  
**Next**: Implement agent execution tests with LLM calls
