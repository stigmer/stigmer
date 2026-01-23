# CI/CD Strategy for E2E Tests

**Question**: Can we skip E2E tests in CI/CD? How do people handle such E2E systems?

**Answer**: **YES**, we absolutely can and should skip them initially. This is standard industry practice.

---

## Our Approach: Build Tags

We use **Go build tags** to cleanly separate test types:

### Unit Tests (Run Everywhere)
```bash
# No prerequisites, fast, always run
make test
go test ./...
```

### E2E Tests (Manual/Local Only)
```bash
# Requires infrastructure (Temporal, Ollama)
make test-e2e
go test -tags=e2e ./test/e2e
```

---

## How It Works

### 1. Build Tags Added to All E2E Files

```go
//go:build e2e
// +build e2e

package e2e

func TestFullExecution(t *testing.T) {
    // Test code...
}
```

### 2. Automatic Exclusion in CI

**Without build tag** (default CI behavior):
```bash
$ go test ./...
# E2E tests: ❌ Skipped (build constraints exclude all Go files)
# Unit tests: ✅ Run normally
```

**With build tag** (local development):
```bash
$ go test -tags=e2e ./test/e2e
# E2E tests: ✅ Run (with prerequisites)
```

### 3. Makefile Targets

```makefile
test:        # Unit tests only (CI-friendly)
test-e2e:    # E2E tests (requires infrastructure)
test-all:    # Both (local comprehensive testing)
```

---

## Industry Examples

### How Major Projects Handle E2E Tests

#### 1. **Kubernetes**
```go
// test/e2e/framework/framework.go
//go:build e2e
// +build e2e
```
- **Approach**: Separate E2E binary
- **CI**: Dedicated jobs with cluster setup
- **Local**: Developers run manually

#### 2. **Docker**
```go
func TestDockerRun(t *testing.T) {
    if _, err := exec.LookPath("docker"); err != nil {
        t.Skip("Docker daemon not available")
    }
}
```
- **Approach**: Skip if daemon unavailable
- **CI**: Runs in Docker-in-Docker
- **Local**: Works if Docker installed

#### 3. **Temporal**
```makefile
test-unit:          # Fast tests
test-integration:   # Integration tests
test-e2e:           # Full E2E tests
```
- **Approach**: Separate make targets
- **CI**: Different workflows for different test suites
- **Local**: Developers choose what to run

#### 4. **HashiCorp (Terraform)**
```go
//go:build acceptance
// +build acceptance

func TestAccProvider(t *testing.T) {
    if os.Getenv("TF_ACC") != "1" {
        t.Skip("Set TF_ACC=1 to run acceptance tests")
    }
}
```
- **Approach**: Build tag + env var
- **CI**: Dedicated acceptance test jobs
- **Local**: Opt-in with environment variable

---

## Our Implementation

### Local Development Workflow

```bash
# Terminal 1: Start infrastructure
stigmer server

# Terminal 2: Run E2E tests
make test-e2e
```

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Unit Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
      - name: Run Tests
        run: make test  # ✅ Only unit tests

# E2E tests intentionally excluded (no build tag)
```

---

## Benefits of Our Approach

### ✅ For Developers

**Fast feedback**:
```bash
$ make test
# Runs in ~10 seconds, no prerequisites
```

**Comprehensive testing when needed**:
```bash
$ make test-all
# Runs both unit and E2E tests
```

### ✅ For CI/CD

**Reliable pipelines**:
- No flaky infrastructure setup
- Fast test execution
- Predictable results

**Resource efficient**:
- No Temporal/Ollama in CI
- Cheaper compute costs
- Faster PR feedback

### ✅ For Debugging

**Easy inspection**:
```bash
# Tests write to your local Temporal instance
# Just open Temporal UI: http://localhost:8233
# Filter workflows by: e2e-test-
```

**Real environment**:
- Same setup as local development
- Easy to reproduce issues
- Can manually test alongside automated tests

---

## Future: E2E in CI (When Ready)

### Option A: Self-Hosted E2E Environment

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on:
  push:
    branches: [main]  # Only on main
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Start Stigmer Server
        run: |
          stigmer server &
          sleep 10  # Wait for startup
      - name: Run E2E Tests
        run: make test-e2e
        timeout-minutes: 10
```

### Option B: Temporal Cloud

```yaml
env:
  TEMPORAL_ADDR: cloud.temporal.io:7233
  TEMPORAL_NAMESPACE: ci-e2e-tests
  TEMPORAL_CERT: ${{ secrets.TEMPORAL_CERT }}
```

**Benefits**:
- No Temporal startup time
- Persistent history
- Centralized monitoring

### Option C: Scheduled E2E Runs

```yaml
# .github/workflows/e2e-nightly.yml
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
```

**Benefits**:
- Don't block PRs
- Catch integration issues
- Test against production-like setup

---

## Decision Matrix

| Approach | Setup Complexity | CI Cost | Debug Ease | Maintenance |
|----------|------------------|---------|------------|-------------|
| **Build Tags (Ours)** | Low | Low | Easy | Low |
| Environment Variables | Low | Low | Easy | Medium |
| Skip in Code | Medium | Low | Medium | Medium |
| Separate Repository | High | Medium | Hard | High |
| Always Run | Very High | High | Hard | Very High |

---

## Recommendations

### Now (Phase 1)

✅ **Use build tags** (implemented)  
✅ **Run E2E locally** (developers)  
✅ **Unit tests in CI** (fast feedback)

### Near Term (Phase 2)

✅ **Add full execution tests**  
✅ **Document test patterns**  
⏳ **Nightly E2E runs** (optional)

### Long Term (Phase 3)

⏳ **Temporal Cloud integration**  
⏳ **PR-based E2E** (on-demand)  
⏳ **Performance benchmarks**

---

## Summary

### Your Questions Answered

**Q: Can we skip E2E tests in CI/CD?**  
**A**: ✅ Yes! We use build tags. E2E tests are automatically excluded unless explicitly requested with `-tags=e2e`.

**Q: How do people handle such E2E systems?**  
**A**: Industry-standard approaches:
- **Build tags** (Kubernetes, Go projects)
- **Environment checks** (Docker)
- **Separate targets** (Temporal)
- **Opt-in flags** (Terraform)

We use **build tags** because:
- ✅ Clean compile-time separation
- ✅ Standard Go practice
- ✅ Works with all go tools
- ✅ Easy to understand

### What We Built

**✅ Build tags on all E2E test files**  
**✅ Makefile targets** (`test` vs `test-e2e`)  
**✅ Prerequisites checking** (Temporal, Ollama)  
**✅ Comprehensive documentation**  
**✅ CI-friendly** (unit tests only)  
**✅ Debug-friendly** (Temporal UI inspection)

### What You Can Do

**Run unit tests** (fast, no setup):
```bash
make test
```

**Run E2E tests** (with stigmer server running):
```bash
stigmer server  # Terminal 1
make test-e2e   # Terminal 2
```

**Inspect test data**:
```bash
open http://localhost:8233  # Temporal UI
# Filter: e2e-test-
```

---

**Status**: ✅ Ready for Phase 2 (Full Execution Testing)  
**Next**: Implement agent execution tests with LLM calls  
**Documentation**: See `test/e2e/README.md` for complete guide
