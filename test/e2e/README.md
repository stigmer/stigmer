# Stigmer E2E Integration Tests

End-to-end integration tests for the Stigmer platform using the **Ephemeral Harness** pattern.

## Overview

This test suite validates Stigmer's core functionality by:
- Starting a real `stigmer-server` instance with isolated storage
- Running CLI commands in-process (grey-box testing)
- Verifying database state and API responses
- Automatically cleaning up after each test

**Key Features:**
- ✅ **Full Isolation**: Each test gets a fresh temp directory and server instance
- ✅ **Fast Execution**: In-process CLI calls, no subprocess overhead
- ✅ **Automatic Cleanup**: Temp files and processes cleaned up automatically
- ✅ **Parallel-Safe**: Random ports prevent conflicts between test runs

## Architecture

### The Ephemeral Harness Pattern

```
┌─────────────────────────────────────────────────────┐
│                  Test Suite (testify)                │
│  ┌───────────────────────────────────────────────┐  │
│  │              SetupTest()                      │  │
│  │  1. Create temp dir                           │  │
│  │  2. Start stigmer-server (random port)        │  │
│  │  3. Wait for health check                     │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │              Test Method                      │  │
│  │  - Run CLI commands                           │  │
│  │  - Verify database state                      │  │
│  │  - Assert API responses                       │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │             TearDownTest()                    │  │
│  │  1. Stop stigmer-server                       │  │
│  │  2. Remove temp directory                     │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Components

#### 1. `helpers_test.go` - Utilities
- `GetFreePort()` - Finds available TCP port
- `WaitForPort()` - Health check with timeout

#### 2. `harness_test.go` - Server Management
- `TestHarness` - Manages stigmer-server lifecycle
- `StartHarness()` - Spawns server with isolated storage
- `Stop()` - Graceful shutdown with cleanup

#### 3. `suite_test.go` - Test Framework
- `E2ESuite` - Base test suite using testify
- `SetupTest()` - Per-test initialization
- `TearDownTest()` - Per-test cleanup

#### 4. `smoke_test.go` - Tests
- `TestServerStarts()` - Validates basic harness functionality

## Running Tests

### Run All Tests

```bash
cd test/e2e
go test -v
```

### Run Specific Test

```bash
go test -v -run TestServerStarts
```

### Run with Timeout

```bash
go test -v -timeout 30s
```

### Run with Race Detection

```bash
go test -v -race
```

## Current Status (Iteration 1)

**✅ Completed:**
- [x] Directory structure
- [x] Helper utilities
- [x] Server harness
- [x] Test suite framework
- [x] Minimal smoke test
- [x] Test passes successfully

**Test Execution Time:** ~1-2 seconds per test

**What Works:**
- Server starts with isolated BadgerDB
- Random port allocation
- Health check validation
- Automatic cleanup
- Parallel test support

## Next Steps (Iteration 2)

### Database Verification

Add helper to inspect BadgerDB:

```go
// GetFromDB reads a value from the test database
func GetFromDB(tempDir string, key string) ([]byte, error)
```

### CLI Runner (In-Process)

Add in-process CLI execution:

```go
// RunCLI executes CLI commands without spawning subprocess
func RunCLI(args ...string) (string, error)
```

### First Real Test

```go
func (s *E2ESuite) TestApplyBasicAgent() {
    // Apply agent configuration
    output, err := RunCLI("apply", "--config", "testdata/basic_agent.go")
    s.NoError(err)
    s.Contains(output, "Deployment successful")
    
    // Verify in database
    value, err := GetFromDB(s.TempDir, "agent:test-agent")
    s.NoError(err)
    s.NotNil(value)
}
```

## Test Data

Test fixtures go in `testdata/`:

```
testdata/
├── basic_agent.go       # Minimal agent definition
├── complex_workflow.go  # Multi-step workflow
└── invalid_config.go    # Error case testing
```

## Configuration

The test harness uses these environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `DB_PATH` | BadgerDB storage location | `{tempDir}/stigmer.db` |
| `GRPC_PORT` | Server gRPC port | Random free port |
| `ENV` | Environment mode | `local` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Troubleshooting

### Port Already in Use

The harness automatically finds free ports. If you see port conflicts, it's likely from a previous test that didn't clean up properly.

**Fix:** Ensure tests call `TearDownTest()` or use `defer` in standalone tests.

### Server Won't Start

Check the server logs in test output. Common issues:
- Missing dependencies (Go modules not synced)
- File permissions on temp directory
- Port exhaustion (very rare)

### Tests Hang

The harness has a 10-second health check timeout. If tests hang:
- Check if server is starting (logs should appear)
- Verify `stigmer-server` compiles: `go build backend/services/stigmer-server/cmd/server/main.go`

### Database Lock Errors

Each test gets a fresh database. If you see lock errors, it means:
- Previous test didn't clean up
- Multiple tests accessing same temp directory (shouldn't happen with testify suite)

## Design Decisions

### Why testify/suite?

- **Lifecycle hooks**: `SetupTest()` and `TearDownTest()` for automatic cleanup
- **Rich assertions**: `s.Equal()`, `s.Contains()`, `s.NoError()` etc.
- **Test organization**: Group related tests in suites
- **Standard library**: Widely used in Go ecosystem

### Why Ephemeral Harness?

- **True isolation**: No shared state between tests
- **Parallel safety**: Each test gets unique port and storage
- **Reproducibility**: Fresh environment every time
- **No mocking**: Tests use real components (stigmer-server, BadgerDB)

### Why In-Process CLI?

- **Speed**: No subprocess overhead (10-100ms saved per call)
- **Debugging**: Stack traces show full execution path
- **Coverage**: `go test -cover` captures CLI code
- **Simplicity**: Direct function calls instead of subprocess management

## Success Criteria

Before marking a test complete:

- [ ] Test is self-contained (no external dependencies)
- [ ] Test cleans up all resources (temp dirs, processes)
- [ ] Test passes reliably (no flakiness)
- [ ] Test completes in < 10 seconds
- [ ] Test is well-documented (comments explain what/why)

## Coding Standards

### Test Naming

```go
func (s *E2ESuite) TestApplyBasicAgent()       // ✅ Action + Subject
func (s *E2ESuite) TestRunWorkflowWithParams() // ✅ Clear intent
func (s *E2ESuite) TestStuff()                 // ❌ Too vague
```

### Assertion Style

```go
// ✅ Descriptive messages
s.NoError(err, "Failed to apply agent configuration")
s.Equal(expected, actual, "Agent name should match")

// ❌ No messages
s.NoError(err)
s.Equal(expected, actual)
```

### Test Structure

Follow the **Arrange-Act-Assert** pattern:

```go
func (s *E2ESuite) TestExample() {
    // ARRANGE: Set up test data
    config := loadTestConfig()
    
    // ACT: Execute the operation
    result, err := performOperation(config)
    
    // ASSERT: Verify expectations
    s.NoError(err)
    s.Equal(expectedResult, result)
}
```

## Related Documentation

- [Gemini Research Report](../../_projects/2026-01/20260122.05.e2e-integration-testing/gemini-response.md)
- [Implementation Plan](../../_projects/2026-01/20260122.05.e2e-integration-testing/next-task.md)
- [Stigmer CLI Architecture](../../client-apps/cli/README.md)
- [Stigmer Server Architecture](../../backend/services/stigmer-server/README.md)

---

**Status:** ✅ Iteration 1 Complete (Minimal POC)  
**Last Updated:** 2026-01-22  
**Test Execution Time:** ~1-2 seconds per test  
**Confidence:** HIGH - Pattern validated, ready for expansion
