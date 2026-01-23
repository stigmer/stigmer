# Phase 2: Full Agent Execution Tests

Phase 2 tests verify complete agent execution with real LLM calls using the production `stigmer server` stack.

## Architecture

### Automatic Server Management

Phase 2 tests automatically detect and manage the `stigmer server`:

```go
// SetupSuite checks if stigmer server is running
manager, err := EnsureStigmerServerRunning(t)
// If not running, starts it automatically
// If already running, reuses it
```

This provides a seamless developer experience:
- ✅ **If `stigmer server` is already running**: Tests use it
- ✅ **If not running**: Tests start it automatically  
- ✅ **After tests**: Only stops if tests started it (preserves running server)

### Components Managed

The full `stigmer server` stack includes:

1. **Stigmer Server** (gRPC API) - Port 7234
2. **Temporal** - Port 7233 (auto-downloaded, managed)
3. **Workflow Runner** - Subprocess for Temporal workers
4. **Agent Runner** - Docker container for agent execution

## Prerequisites

### Required

- **Ollama** - Local LLM server (auto-started by stigmer server)
  ```bash
  # Install
  brew install ollama  # macOS
  # or download from https://ollama.com/
  
  # Verify
  ollama serve
  ```

- **Docker** - For agent-runner container
  ```bash
  # Check Docker is running
  docker info
  ```

### Optional

If you already have `stigmer server` running, tests will use it:

```bash
# Start stigmer server manually (in separate terminal)
stigmer server

# Check status
stigmer server status
```

## Running Tests

### Quick Start

```bash
# From repository root
make test-e2e

# Or directly
cd test/e2e
go test -v -tags=e2e -timeout 120s -run TestFullExecution
```

The tests will:
1. Check if `stigmer server` is running
2. Start it if needed (takes ~10-15 seconds first time)
3. Run the tests
4. Stop server only if tests started it

### With Existing Server

If you're actively developing with `stigmer server` already running:

```bash
# Terminal 1: Keep your stigmer server running
stigmer server

# Terminal 2: Run tests (will use existing server)
cd test/e2e
go test -v -tags=e2e -run TestFullExecution
```

Tests detect the running server and skip startup/teardown.

## Test Coverage

### TestRunWithFullExecution

Tests complete agent execution lifecycle:

1. **Apply agent** - Deploy agent via CLI
2. **Run agent** - Execute with test message  
3. **Wait for completion** - Poll execution status (60s timeout)
4. **Verify output** - Check LLM response contains greeting

**Duration**: ~5-10 seconds (depending on LLM response time)

### TestRunWithInvalidMessage

Tests error handling:

1. **Run non-existent agent** - Should fail gracefully
2. **Verify error message** - Contains "not found"

**Duration**: < 1 second

## Debugging

### Check Component Status

```bash
stigmer server status
```

Output shows status of all components:
```
Stigmer Server Status:
─────────────────────────────────────
Stigmer Server:
  Status:   Running ✓
  PID:      12345
  ...

Workflow Runner:
  Status:   Running ✓
  ...

Agent Runner (Docker):
  Status:   Running ✓
  Container: abc123def456
```

### View Logs

```bash
# Stigmer server logs
tail -f ~/.stigmer/logs/stigmer-server.log

# Agent runner logs
docker logs stigmer-agent-runner -f

# Workflow runner logs
tail -f ~/.stigmer/logs/workflow-runner.log
```

### Common Issues

**Issue**: Tests skip with "Temporal not available"

**Solution**: Check Temporal is running:
```bash
stigmer server status
# Look for: Temporal: Running ✓
```

**Issue**: Tests skip with "Agent runner not available"

**Solution**: Check Docker is running and agent-runner container started:
```bash
docker ps | grep stigmer-agent-runner
```

**Issue**: Execution times out after 60 seconds

**Solution**: Check LLM is responding:
```bash
# Test Ollama directly
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:1b",
  "prompt": "Say hello"
}'
```

## Development Workflow

### Typical Development Cycle

```bash
# 1. Start stigmer server once
stigmer server

# 2. Run tests repeatedly (fast, reuses server)
cd test/e2e
go test -v -tags=e2e -run TestFullExecution

# 3. Make changes to code

# 4. Re-run tests (server stays running)
go test -v -tags=e2e -run TestFullExecution

# 5. Stop server when done
stigmer server stop
```

### Adding New Phase 2 Tests

Create new test methods in `e2e_run_full_test.go`:

```go
func (s *FullExecutionSuite) TestMyNewFeature() {
    // Use s.ServerPort to communicate with stigmer server
    output, err := RunCLIWithServerAddr(
        s.ServerPort,
        "apply",
        "--config", "testdata/my-test.yaml",
    )
    // ... assertions ...
}
```

All tests in `FullExecutionSuite` automatically:
- Share the same stigmer server instance
- Have access to Temporal, workflow-runner, agent-runner
- Clean up agents after each test

## Architecture Comparison

### Phase 1 (Smoke Tests)

- **Isolation**: Each test gets fresh server instance
- **Speed**: Fast (~1 second per test)
- **Scope**: API contract testing only
- **Use case**: Quick validation of apply/run commands

### Phase 2 (Full Execution)

- **Isolation**: Tests share server instance
- **Speed**: Slower (5-10 seconds per test, but amortized startup)
- **Scope**: End-to-end with real LLM execution
- **Use case**: Integration testing with actual agent execution

## CI/CD Integration

See `test/e2e/CICD-STRATEGY.md` for GitHub Actions configuration.

Key points for CI:
- Install Ollama in CI environment
- Pull LLM model before running tests
- Start Docker daemon if not already running
- Set appropriate timeout (120 seconds minimum)

Example GitHub Actions snippet:

```yaml
- name: Setup Ollama
  run: |
    curl -fsSL https://ollama.com/install.sh | sh
    ollama serve &
    sleep 5
    ollama pull llama3.2:1b

- name: Run E2E Tests (Phase 2)
  run: |
    cd test/e2e
    go test -v -tags=e2e -timeout 120s -run TestFullExecution
```

## Performance

**First run** (cold start):
- Stigmer server startup: ~10 seconds
- Ollama + model download: ~30-60 seconds (one-time)
- Agent execution: ~5-10 seconds
- **Total**: ~45-80 seconds

**Subsequent runs** (warm):
- Server already running: 0 seconds
- Agent execution: ~5-10 seconds  
- **Total**: ~5-10 seconds per test

## Future Enhancements

### Planned for Phase 2.1

- [ ] Test agent with skills
- [ ] Test agent with subagents
- [ ] Test agent with MCP servers
- [ ] Test workflow execution (simple workflow)

### Planned for Phase 2.2

- [ ] Test log streaming (`--follow` flag)
- [ ] Test runtime environment variables
- [ ] Test sandbox execution mode
- [ ] Test different LLM providers

### Planned for Phase 3

- [ ] Performance benchmarks
- [ ] Load testing (multiple concurrent executions)
- [ ] Resource usage monitoring
- [ ] Failure scenario testing (network interruptions, etc.)

## FAQs

**Q: Why not use Docker Compose for Phase 2?**

A: Using the production `stigmer server` is simpler, faster, and matches real user experience. The `stigmer server` command already handles all dependencies (Temporal, agent-runner, etc.) automatically.

**Q: Can I run Phase 1 and Phase 2 tests together?**

A: Yes! Phase 1 tests use isolated servers, Phase 2 uses shared server. They don't conflict:

```bash
cd test/e2e
go test -v -tags=e2e -timeout 120s
```

**Q: What if I need a different LLM model for testing?**

A: Configure in `~/.stigmer/config.yaml`:

```yaml
backend:
  local:
    llm:
      provider: ollama
      model: codellama:7b  # Or any other model
```

**Q: How do I reset the test environment completely?**

A:
```bash
# Stop server
stigmer server stop

# Clear data directory (WARNING: destroys all local data)
rm -rf ~/.stigmer/

# Restart server (will reinitialize)
stigmer server
```

**Q: Can I run tests against a remote Stigmer server?**

A: Not yet, but planned. Phase 2 currently assumes local server. For remote testing, use the production deployment's own test suite.

---

**Status**: ✅ Implemented (2026-01-22)  
**Maintainer**: Stigmer E2E Testing Team  
**Last Updated**: 2026-01-22
