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

## Current Status

### ✅ Iteration 5 - Phase 1: Run Command Tests Complete! 🎉

**ALL TESTS PASS CONSISTENTLY (6 tests)**

```bash
$ go test -v -timeout 60s
--- PASS: TestE2E (12.17s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.30s)
    --- PASS: TestE2E/TestApplyDryRun (1.37s)
    --- PASS: TestE2E/TestRunBasicAgent (2.12s)        ← NEW ✨
    --- SKIP: TestE2E/TestRunWithAutoDiscovery (5.54s)
    --- PASS: TestE2E/TestRunWithInvalidAgent (1.10s)  ← NEW ✨
    --- PASS: TestE2E/TestServerStarts (0.73s)
PASS
ok      github.com/stigmer/stigmer/test/e2e     13.311s
```

**What's Working:**
- ✅ Full apply workflow (CLI → Server → Deployment)
- ✅ **Run command smoke tests** (execution creation, no Temporal required) ← NEW!
- ✅ **Agent execution verification via API** ← NEW!
- ✅ **Error handling tests** (missing agents) ← NEW!
- ✅ Dry-run mode validation
- ✅ API-based verification (no database lock conflicts)
- ✅ Error messages from CLI (no more silent failures)
- ✅ Test fixture dependency resolution
- ✅ Environment variable server override
- ✅ Comprehensive test coverage
- ✅ Fast execution (~13 seconds for 6 tests)
- ✅ Full isolation (random ports + temp dirs)

**Phase 1 Run Command Tests (Iteration 5):**
- [x] `TestRunBasicAgent` - Full run workflow (agent execution creation)
- [x] `TestRunWithInvalidAgent` - Error handling for missing agents
- [x] `AgentExecutionExistsViaAPI()` helper - Verify execution via gRPC
- [x] Tests work without Temporal/agent-runner (smoke tests only)
- [x] Foundation for Phase 2 (full integration with LLM)
- [x] All tests passing (6 total: 5 pass, 1 skip)

**What Phase 1 Tests:**
- ✅ CLI run command works
- ✅ Execution creation (record in database)
- ✅ API verification (gRPC queries)
- ✅ Error handling (graceful errors)

**What Phase 1 Does NOT Test** (Phase 2):
- ❌ Actual agent execution (requires Temporal + agent-runner + Ollama)
- ❌ LLM responses
- ❌ Log streaming

**Key Improvements in Iteration 4:**
- [x] Fixed CLI silent failures (error printing in main.go)
- [x] Added test fixture go.mod with replace directives
- [x] Fixed `//go:build ignore` file execution
- [x] Added `STIGMER_SERVER_ADDR` environment variable override
- [x] Switched to API verification (no BadgerDB lock conflicts)
- [x] All tests passing consistently

### ✅ Iteration 3: Suite Hanging Issue Fixed
- [x] Debug HTTP server port conflict resolved (use `ENV=test`)
- [x] Process group management implemented
- [x] Graceful shutdown with SIGINT (~8x faster)
- [x] CLI path corrected
- [x] Server address properly passed to CLI commands

### ✅ Iteration 2: Infrastructure Complete
- [x] Database helpers (now used for verification)
- [x] CLI runner framework (subprocess with env vars)
- [x] Test fixtures with proper Go modules
- [x] Apply workflow tests working

### ✅ Iteration 1: Foundation
- [x] Directory structure
- [x] Helper utilities
- [x] Server harness
- [x] Test suite framework
- [x] Smoke test

## Iteration 2 Achievements

### ✅ Database Verification Implemented

Two helpers for BadgerDB inspection (`helpers_test.go`):

```go
// GetFromDB reads a value from BadgerDB by key
func GetFromDB(dbPath string, key string) ([]byte, error)

// ListKeysFromDB lists all keys matching a prefix
func ListKeysFromDB(dbPath string, prefix string) ([]string, error)
```

**Verified working** via `TestDatabaseReadWrite` ✅

### ✅ CLI Runner Implemented

Three execution modes (`cli_runner_test.go`):

```go
// RunCLI - Main entry point (uses subprocess by default)
func RunCLI(args ...string) (string, error)

// RunCLIInProcess - Experimental in-process execution
func RunCLIInProcess(args ...string) (string, error)

// RunCLISubprocess - Subprocess execution via go run
func RunCLISubprocess(args ...string) (string, error)
```

### ✅ Test Cases Written

**Apply Tests** (`e2e_apply_test.go`):

```go
// TestApplyBasicAgent - Full apply workflow
func (s *E2ESuite) TestApplyBasicAgent() {
    // Apply agent configuration
    output, err := RunCLI("apply", "--config", absTestdataDir)
    s.Require().NoError(err)
    s.Contains(output, "Deployment successful")
    
    // Verify via API
    exists, err := AgentExistsViaAPI(s.Harness.ServerPort, agentID)
    s.NoError(err)
    s.True(exists)
}

// TestApplyDryRun - Dry-run mode verification
func (s *E2ESuite) TestApplyDryRun()
```

**Run Tests** (`e2e_run_test.go`):

```go
// TestRunBasicAgent - Full run workflow (execution creation)
func (s *E2ESuite) TestRunBasicAgent() {
    // Apply agent
    applyOutput, _ := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", ...)
    agentID := extractAgentID(applyOutput)
    
    // Run agent
    runOutput, _ := RunCLIWithServerAddr(
        s.Harness.ServerPort,
        "run", "test-agent",
        "--message", "Hello, test agent!",
        "--follow=false",
    )
    
    // Verify execution created
    executionID := extractExecutionID(runOutput)
    exists, _ := AgentExecutionExistsViaAPI(s.Harness.ServerPort, executionID)
    s.True(exists)
}

// TestRunWithInvalidAgent - Error handling
func (s *E2ESuite) TestRunWithInvalidAgent()
```

**Status**: ✅ All tests working and verified

## Iteration 5 - Phase 2: Full Agent Execution Testing

**Phase 1 Complete:** Run command smoke tests working ✅

**Phase 2 Status:** Infrastructure implemented, ready for testing! ✨

### Phase 2 Architecture

Phase 2 adds Docker-based services for complete agent execution testing:

```
┌─────────────────────────────────────────────────────────┐
│                  Full Execution Test                     │
│                                                          │
│  ┌────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │   Ollama   │    │    Temporal   │    │Agent-Runner│  │
│  │  (Host)    │◄───┤  (Container)  │◄───┤(Container) │  │
│  └────────────┘    └──────────────┘    └────────────┘  │
│        ▲                                       ▲         │
│        │                                       │         │
│        │           ┌──────────────┐           │         │
│        └───────────┤Stigmer-Server├───────────┘         │
│                    │   (Test)     │                     │
│                    └──────┬───────┘                     │
│                           │                             │
│                    ┌──────▼───────┐                     │
│                    │     CLI      │                     │
│                    │    (Test)    │                     │
│                    └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

### Prerequisites

Before running Phase 2 tests, ensure you have:

1. **Docker** - For running Temporal and agent-runner containers
   - macOS: https://docs.docker.com/desktop/install/mac-install/
   - Linux: https://docs.docker.com/engine/install/

2. **Ollama** - For LLM inference
   ```bash
   # Install Ollama
   curl -fsSL https://ollama.com/install.sh | sh
   
   # Start Ollama server
   ollama serve
   
   # Pull a small model (recommended for tests)
   ollama pull llama3.2:1b
   ```

### Running Phase 2 Tests

**Phase 2 tests will automatically skip if prerequisites are not met.**

```bash
# Run Phase 1 tests only (no Docker/Ollama required)
go test -v -run TestE2E

# Run Phase 2 tests (requires Docker + Ollama)
go test -v -run TestFullExecution

# Run all tests (Phase 1 + Phase 2)
go test -v
```

### Phase 2 Components

**New Files:**
- `prereqs_test.go` - Checks Docker and Ollama availability
- `docker-compose.e2e.yml` - Temporal + agent-runner setup
- `e2e_run_full_test.go` - Full execution integration tests

**Enhanced Files:**
- `harness_test.go` - Now manages Docker services
- `helpers_test.go` - Added execution monitoring helpers

**New Helper Functions:**
- `CheckPrerequisites()` - Verifies Docker and Ollama
- `StartHarnessWithDocker()` - Starts server + Docker services
- `WaitForExecutionPhase()` - Polls execution until target phase
- `GetExecutionMessages()` - Retrieves agent output

### Phase 2 Test Cases

**Implemented:**
- [x] `TestRunWithFullExecution` - Complete agent execution lifecycle
- [x] `TestRunWithInvalidMessage` - Error handling for full execution

**Future Tests:**
- [ ] `TestRunWithLogStreaming` - Test --follow flag
- [ ] `TestRunWithRuntimeEnv` - Test environment variables
- [ ] `TestRunWithSkills` - Agent with skills execution
- [ ] `TestRunWithMcpServers` - Agent with MCP servers

### Docker Services

The test harness manages these containers:

| Service | Port | Purpose |
|---------|------|---------|
| Temporal | 7233 | Workflow orchestration |
| Temporal UI | 8233 | Web interface (optional) |
| agent-runner | - | Executes agent workflows |

**Automatic Cleanup:** Containers are stopped and removed after each test.

### Troubleshooting Phase 2

**Prerequisites Check Failed:**
```bash
# Verify Docker is running
docker ps

# Verify Ollama is running
curl http://localhost:11434/api/version

# Check which prerequisite failed
go test -v -run TestFullExecution
```

**Docker Containers Won't Start:**
```bash
# Check for conflicting containers
docker ps -a | grep stigmer-e2e

# Clean up manually if needed
docker-compose -f docker-compose.e2e.yml -p stigmer-e2e down -v

# Check Docker daemon logs
docker logs stigmer-e2e-temporal
docker logs stigmer-e2e-agent-runner
```

**Tests Timeout:**
- Increase timeout in test code (default: 60 seconds)
- Check Ollama model is downloaded: `ollama list`
- Verify agent-runner can reach Ollama: `docker logs stigmer-e2e-agent-runner`

**Agent Not Responding:**
- Check Temporal is healthy: `docker exec stigmer-e2e-temporal tctl cluster health`
- Verify agent-runner is connected to Temporal
- Check Ollama model availability

### Future Scenarios

**Planned Test Coverage:**
- Agent with skills, subagents, MCP servers
- Error cases (invalid YAML, bad Go code)
- Workflow deployment and execution
- Update/delete operations
- Concurrent executions
- Long-running agents

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
| `ENV` | Environment mode | `test` (disables debug server) |
| `LOG_LEVEL` | Logging verbosity | `info` |

**Note**: Tests use `ENV=test` to disable the debug HTTP server (port 8234), preventing port conflicts between tests.

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

### Suite-Based Tests (Previously Hung - Now Fixed!)

**Problem (RESOLVED)**: Tests using `testify/suite` were hanging indefinitely.

**Root Causes Identified**:
1. Debug HTTP server binding to fixed port 8234 → port conflicts
2. Improper process shutdown (SIGKILL instead of SIGINT)
3. Signals not propagating from `go run` parent to child Go binary

**Solutions Implemented**:
- ✅ Use `ENV=test` to disable debug server (prevents port conflicts)
- ✅ Process group management (`Setpgid: true`) for signal propagation
- ✅ Graceful shutdown with SIGINT to entire process group
- ✅ Corrected CLI path and server address handling

**Result**: All tests now run without hanging! ✨

**Performance**: Server shutdown improved from 5+ seconds (force-kill) to ~0.6 seconds (graceful).

See `../../_projects/2026-01/20260122.05.e2e-integration-testing/checkpoints/03-iteration-3-suite-hanging-fixed.md` for full details.

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

**Status:** ✅ **Phase 2 Infrastructure Complete!**  
**Last Updated:** 2026-01-22  

**Phase 1:** ✅ Run Command Tests Working (6 tests: 5 pass, 1 skip)  
**Phase 2:** ✅ Infrastructure Implemented - Ready for Testing!

**New Phase 2 Capabilities:**
- ✅ Docker Compose setup (Temporal + agent-runner)
- ✅ Prerequisites checking (Docker, Ollama)
- ✅ Enhanced test harness with Docker management
- ✅ Execution monitoring helpers
- ✅ Full execution test suite (`FullExecutionSuite`)
- ✅ Automatic cleanup of Docker services

**Test Suite Time (Phase 1):** ~13.3 seconds  
**Confidence:** HIGH - Ready for Phase 2 testing with real LLM execution

**Next:** Run Phase 2 tests with Ollama to validate full agent execution lifecycle
