# Stigmer E2E Integration Tests

End-to-end integration tests for the Stigmer platform. These tests verify the complete workflow from CLI commands to agent execution.

## Test Strategy

These tests use **build tags** to separate them from unit tests:
- **Unit tests**: Fast, no external dependencies, run in CI
- **E2E tests**: Require infrastructure (Temporal, Ollama), run locally

## Prerequisites

### Required (Must be running)

1. **Stigmer Server** (includes Temporal):
   ```bash
   stigmer server
   ```
   This starts:
   - Temporal Lite on `localhost:7233`
   - stigmer-server on `localhost:50051` (or custom port)
   - Agent-runner worker (connects to Temporal)

2. **Ollama** (for LLM):
   ```bash
   # Install: https://ollama.com/
   ollama serve
   
   # Pull a model (any model works):
   ollama pull qwen2.5-coder:7b
   # or
   ollama pull llama3.2:1b
   ```

### Optional

3. **Docker** (only for Phase 2 full execution tests - not yet required):
   ```bash
   # macOS: https://www.docker.com/products/docker-desktop/
   docker --version
   ```

## Running Tests

### Quick Commands

```bash
# Run E2E tests (requires stigmer server running)
make test-e2e

# Run ALL tests including unit tests
make test-all

# Run only unit tests (no infrastructure needed, runs in CI)
make test
```

### Detailed Workflow

**Step 1: Start infrastructure** (Terminal 1)
```bash
# This starts Temporal + stigmer-server + agent-runner
stigmer server
```

**Step 2: Run tests** (Terminal 2)
```bash
# Navigate to test directory
cd test/e2e

# Run E2E tests with build tag
go test -v -tags=e2e -timeout 60s

# Or run specific test
go test -v -tags=e2e -run TestE2E/TestApplyBasicAgent
```

## Test Phases

### Phase 1: Smoke Tests (Current)

Basic integration testing without full agent execution:

- ✅ **TestServerStarts** - Server lifecycle
- ✅ **TestApplyBasicAgent** - Deploy agent via CLI
- ✅ **TestApplyDryRun** - Validation mode
- ✅ **TestRunBasicAgent** - Execution creation
- ✅ **TestRunWithInvalidAgent** - Error handling

**Runtime**: ~10-15 seconds  
**Coverage**: CLI → stigmer-server → Database

### Phase 2: Full Execution (Planned)

Complete agent execution with LLM calls:

- ⏳ **TestRunWithFullExecution** - End-to-end agent execution
- ⏳ **TestRunWithLogStreaming** - Log streaming via `--follow`
- ⏳ **TestRunWithRuntimeEnv** - Environment variable passing

**Runtime**: ~30-60 seconds (includes LLM calls)  
**Coverage**: CLI → Server → Temporal → Agent Runner → LLM → Response

## Debugging

### View Test Data in Temporal UI

1. **Start Temporal UI** (if using `stigmer server`, it's already running):
   ```bash
   # Temporal UI runs on http://localhost:8233
   open http://localhost:8233
   ```

2. **Test workflows are prefixed**: `e2e-test-{timestamp}-`
   - Easy to identify test executions
   - Won't conflict with development workflows

### Common Issues

**"No tests to run"**
```bash
# Missing build tag - tests are skipped
go test -v  # ❌ Won't run E2E tests

# Correct:
go test -v -tags=e2e  # ✅ Runs E2E tests
```

**"Connection refused" or "Server not available"**
```bash
# Start stigmer server first
stigmer server

# Verify it's running
stigmer server status
```

**"Ollama not running"**
```bash
# Start Ollama
ollama serve

# Verify
curl http://localhost:11434/api/version
```

**Tests hang or timeout**
```bash
# Check if Temporal is healthy
curl http://localhost:7233/api/v1/namespaces

# Check stigmer-server logs
stigmer server logs
```

## CI/CD Integration

**Current**: E2E tests are **excluded from CI** (by design).

**Why?**
- Require running infrastructure (Temporal, Ollama)
- Slower than unit tests
- Best run locally or in dedicated E2E environment

**Future**: When we set up dedicated E2E infrastructure:
```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push]
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
```

## Test Architecture

### Harness Pattern

Tests use a `TestHarness` that manages lifecycle:

```go
type TestHarness struct {
    ServerCmd  *exec.Cmd  // stigmer-server process
    ServerPort int        // Random port (isolation)
    TempDir    string     // Isolated database
    
    // Phase 2 additions:
    TemporalAddr      string  // localhost:7233
    AgentRunnerReady  bool    // Worker is connected
}
```

### Test Isolation

Each test gets:
- ✅ **Fresh temp directory** for database
- ✅ **Random port** for stigmer-server
- ✅ **Unique workflow IDs** (`e2e-test-{timestamp}`)
- ✅ **Clean shutdown** after each test

Shared across tests:
- ✅ **Temporal instance** (localhost:7233)
- ✅ **Ollama instance** (localhost:11434)

### API Verification Pattern

Tests verify via **gRPC API** (not direct DB access):

```go
// ✅ Proper API verification
exists, err := AgentExistsViaAPI(serverPort, agentID)

// ❌ Direct DB access (breaks abstraction)
value, err := GetFromDB(dbPath, key)  // Only for debugging
```

## File Structure

```
test/e2e/
├── README.md                  # This file
├── suite_test.go             # Testify suite setup
├── harness_test.go           # Test harness (server lifecycle)
├── helpers_test.go           # API helpers (verification)
├── cli_runner_test.go        # CLI command execution
├── prereqs_test.go           # Prerequisites checking
│
├── e2e_apply_test.go         # Apply command tests (Phase 1)
├── e2e_run_test.go           # Run command tests (Phase 1)
├── e2e_run_full_test.go      # Full execution tests (Phase 2)
│
└── testdata/
    ├── Stigmer.yaml          # Test configuration
    └── basic_agent.go        # Test agent definition
```

## Contributing

### Adding New Tests

1. **Create test file** with build tag:
```go
//go:build e2e
// +build e2e

package e2e

func (s *E2ESuite) TestMyNewFeature() {
    // Test code...
}
```

2. **Use the harness pattern**:
```go
// Server is already running (from suite setup)
output, err := RunCLIWithServerAddr(
    s.Harness.ServerPort,
    "your-command", "args",
)
```

3. **Verify via API**:
```go
exists, err := AgentExistsViaAPI(s.Harness.ServerPort, agentID)
s.Require().NoError(err)
s.Require().True(exists)
```

4. **Run and verify**:
```bash
go test -v -tags=e2e -run TestMyNewFeature
```

### Test Naming Convention

- `TestServerXxx` - Infrastructure tests
- `TestApplyXxx` - Apply command tests
- `TestRunXxx` - Run command tests
- `TestXxxError` - Error case tests

## Performance

**Current metrics** (Phase 1):
- **Test suite runtime**: ~12-15 seconds (6 tests)
- **Server startup**: ~1 second
- **Server shutdown**: ~0.5 seconds
- **Per-test overhead**: ~1-2 seconds

**Expected metrics** (Phase 2 with LLM):
- **Test suite runtime**: ~60-90 seconds
- **LLM call overhead**: ~5-10 seconds per execution

## Future Enhancements

- [ ] Add more agent scenarios (skills, subagents, MCP servers)
- [ ] Test workflow execution
- [ ] Add performance benchmarks
- [ ] Structured CLI output (`--output json`)
- [ ] Parallel test execution
- [ ] CI/CD integration with dedicated infrastructure

---

**Questions?** Check the [main project README](../../README.md) or open an issue.
