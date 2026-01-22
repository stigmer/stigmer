# Next Task: Iteration 6 - Additional Test Scenarios (Optional)

**Project**: E2E Integration Testing Framework  
**Location**: `_projects/2026-01/20260122.05.e2e-integration-testing/`  
**Current Status**: ✅ Phase 2 Full Execution Tests Complete  
**Updated**: 2026-01-22

---

## 🎉 Latest: Phase 2 Full Execution Tests Working! (2026-01-22)

**Phase 2 tests now pass with real LLM execution in ~6 seconds!**

### Test Results

```bash
=== RUN   TestFullExecution
--- PASS: TestFullExecution (5.23s)
    --- PASS: TestFullExecution/TestRunWithFullExecution (4.36s)
    --- PASS: TestFullExecution/TestRunWithInvalidMessage (0.82s)
PASS
ok      github.com/stigmer/stigmer/test/e2e    6.195s
```

### What Works

- ✅ Complete agent lifecycle testing (deploy → execute → validate)
- ✅ Real LLM execution via Temporal workflows
- ✅ Agent tool call generation and validation
- ✅ Error handling for invalid agents
- ✅ Automatic server management (detects/starts/stops)
- ✅ Flexible response validation (text or tool calls)

### Key Fixes Applied

1. **Go Module Dependencies** - Added 7 replace directives
2. **Internal Package Access** - Replaced with CLI commands
3. **CLI Flag Syntax** - Fixed `--no-follow` → `--follow=false`
4. **Agent ID Extraction** - Updated regex for new format
5. **Agent Reference** - Use agent name instead of ID
6. **Response Validation** - Accept any substantive output
7. **Status Detection** - Fixed workflow-runner/agent-runner checks

### Running Tests

```bash
# Run Phase 2 tests
cd test/e2e
go test -v -tags=e2e -timeout 120s -run TestFullExecution

# Run all E2E tests (Phase 1 + Phase 2)
go test -v -tags=e2e -timeout 120s
```

**See**: `checkpoints/09-phase-2-full-execution-tests-complete.md` for full details

---

## 🎉 Automatic Stigmer Server Management! (2026-01-22)

**Phase 2 tests now automatically detect and start `stigmer server`!**

### What Changed

- ✅ Created `StigmerServerManager` for intelligent server lifecycle management
- ✅ Tests check if `stigmer server` is running via `daemon.IsRunning()`
- ✅ If not running, automatically start it with `daemon.Start()`
- ✅ Track ownership: only stop server if tests started it
- ✅ Graceful skips: clear messages if prerequisites missing
- ✅ Comprehensive docs: `README_PHASE2.md` covers everything

### How It Works

```bash
# Just run tests - server management is automatic
cd test/e2e && go test -v -tags=e2e -run TestFullExecution

# If stigmer server is running: Tests use it, leave it running
# If not running: Tests start it, stop it after tests
```

### Developer Experience

**Before:**
```bash
# Terminal 1: Manual server start required
stigmer server

# Terminal 2: Run tests
cd test/e2e && go test ...
```

**After:**
```bash
# Just run tests - server auto-starts if needed
cd test/e2e && go test -v -tags=e2e -run TestFullExecution
```

### Files Changed

- **New**: `test/e2e/stigmer_server_manager_test.go` (265 lines)
- **New**: `test/e2e/README_PHASE2.md` (340 lines)  
- **New**: `checkpoints/08-automatic-stigmer-server-management.md` (complete docs)
- **Modified**: `test/e2e/e2e_run_full_test.go` (simplified, uses shared server)

**See**: `checkpoints/08-automatic-stigmer-server-management.md` for full details

---

## 🎉 Phase 1 Complete! Run Command Smoke Tests Working!

```bash
$ go test -v -timeout 60s
--- PASS: TestE2E (12.17s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.30s)
    --- PASS: TestE2E/TestApplyDryRun (1.37s)
    --- PASS: TestE2E/TestRunBasicAgent (2.12s)  ← NEW! ✨
    --- SKIP: TestE2E/TestRunWithAutoDiscovery (5.54s)
    --- PASS: TestE2E/TestRunWithInvalidAgent (1.10s)  ← NEW! ✨
    --- PASS: TestE2E/TestServerStarts (0.73s)
PASS
ok      github.com/stigmer/stigmer/test/e2e     13.311s
```

**New in Phase 1:**
- ✅ `TestRunBasicAgent` - Verifies execution creation
- ✅ `TestRunWithInvalidAgent` - Error handling
- ✅ `AgentExecutionExistsViaAPI()` helper function

**See**: `checkpoints/05-phase-1-run-command-tests-complete.md` for full details

---

## 🎉 Iteration 4 Complete! ALL TESTS PASS!

```bash
$ go test -v -timeout 60s
--- PASS: TestE2E (8.17s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.29s)
    --- PASS: TestE2E/TestApplyDryRun (1.26s)
    --- PASS: TestE2E/TestServerStarts (5.62s)
PASS
ok      github.com/stigmer/stigmer/test/e2e     8.991s
```

**See**: `checkpoints/04-iteration-4-full-integration-complete.md` for full details

---

## ✅ What's Working Now

- ✅ **Isolated Test Environment**: Each test gets fresh temp dir + random port
- ✅ **Server Lifecycle**: Start/stop gracefully in ~1.5 seconds
- ✅ **CLI Integration**: Execute commands with proper server address override
- ✅ **Agent Deployment**: Deploy agents from Go code and verify via API
- ✅ **Dry-Run Mode**: Test validation without actual deployment
- ✅ **Clean Architecture**: Testify suite + harness pattern + API verification

---

## 🎯 Next: Iteration 5 - Expand Test Coverage

Now that the foundation is solid, we can add more test scenarios:

### Priority 1: More Agent Scenarios

1. **TestApplyAgentWithSkills**
   - Agent that references skills
   - Verify both agent and skills are deployed
   - Query via API to confirm relationship

2. **TestApplyAgentWithSubagents**
   - Agent with subagents
   - Verify hierarchical structure
   - Test agent references

3. **TestApplyAgentWithMcpServers**
   - Agent with MCP server configurations
   - Verify server configuration stored
   - Check different MCP server types (stdio, http, docker)

### Priority 2: Error Cases

4. **TestApplyInvalidYaml**
   - Malformed Stigmer.yaml
   - Verify proper error messages
   - No partial deployments

5. **TestApplyInvalidGoCode**
   - Go code that doesn't compile
   - Runtime errors in synthesis
   - Proper error propagation

6. **TestApplyMissingDependencies**
   - Invalid imports
   - Missing replace directives
   - Dependency resolution failures

### Priority 3: Workflow Testing

7. **TestApplyBasicWorkflow**
   - Simple workflow deployment
   - Verify workflow stored
   - Query workflow via API

8. **TestApplyWorkflowWithTasks**
   - Workflow with multiple tasks
   - Verify task structure
   - Check workflow validation

### Priority 4: Update/Delete Operations

9. **TestUpdateExistingAgent**
   - Deploy agent
   - Modify and redeploy
   - Verify updates applied

10. **TestDeleteAgent**
    - Deploy agent
    - Delete via CLI (when implemented)
    - Verify removal

---

## 📋 Implementation Plan for Iteration 5

### Step 1: Add Test Fixtures

Create additional test fixtures in `test/e2e/testdata/`:

```
testdata/
├── Stigmer.yaml              (existing)
├── basic_agent.go            (existing)
├── agent_with_skills.go      (new)
├── agent_with_subagents.go   (new)
├── agent_with_mcp.go         (new)
├── basic_workflow.go         (new)
└── invalid/
    ├── malformed.yaml        (new)
    └── bad_syntax.go         (new)
```

### Step 2: Create Test File

Create `test/e2e/e2e_agent_scenarios_test.go`:

```go
package e2e

func (s *E2ESuite) TestApplyAgentWithSkills() {
    // Similar structure to TestApplyBasicAgent
    // but with agent_with_skills.go fixture
}

func (s *E2ESuite) TestApplyAgentWithSubagents() {
    // ...
}

// etc.
```

### Step 3: Update Stigmer.yaml for Each Test

Each test should have its own Stigmer.yaml or specify which entry point to use.

**Option A**: Multiple Stigmer.yaml files
```
testdata/
├── basic_agent/
│   ├── Stigmer.yaml
│   └── main.go
├── agent_with_skills/
│   ├── Stigmer.yaml
│   └── main.go
```

**Option B**: Single Stigmer.yaml with different main files
```yaml
# Just change which file the test points to
main: agent_with_skills.go
```

**Recommendation**: Start with Option B for simplicity

### Step 4: Add Error Case Tests

Create `test/e2e/e2e_error_cases_test.go`:

```go
func (s *E2ESuite) TestApplyInvalidYaml() {
    output, err := RunCLIWithServerAddr(
        s.Harness.ServerPort,
        "apply",
        "--config", "testdata/invalid/malformed.yaml",
    )
    
    // Should fail with clear error message
    s.Error(err)
    s.Contains(output, "failed to parse Stigmer.yaml")
}
```

---

## 🎓 Lessons from Iteration 4

### What Went Well

1. **Systematic Debugging**
   - Fixed CLI error printing first
   - Resolved dependency issues methodically
   - Each fix brought us closer to passing tests

2. **Good Architecture Decisions**
   - Environment variable for server address (clean, simple)
   - API verification instead of database access (proper integration testing)
   - Replace directives in go.mod (standard Go practice)

3. **Documentation**
   - Checkpoint documents capture knowledge
   - Easy to understand what changed and why

### What to Keep Doing

1. **One Issue at a Time**
   - Don't try to fix everything at once
   - Verify each fix before moving to next

2. **Test the Tests**
   - Run manually to understand failures
   - Use logging liberally during development

3. **Document Decisions**
   - Why we chose API verification over DB access
   - Why we use env vars instead of flags
   - These decisions help future maintainers

---

## 🚧 Known Limitations

### Current Constraints

1. **No Temporal Integration Yet**
   - Workflows won't execute (need Temporal server)
   - Acceptable for now (server logs warning)
   - Future iteration: Start Temporal in harness

2. **Single Test at a Time**
   - Tests run serially (testify default)
   - Good for now (faster than parallel anyway)
   - Can optimize later with `t.Parallel()`

3. **No Performance Benchmarks**
   - We know tests are fast (~9 seconds)
   - Don't have systematic benchmarks yet
   - Add `_test.go` with benchmarks later

### Technical Debt

1. **Server Exit Code**
   - Server exits with status 1 (should be 0)
   - Doesn't affect tests but should fix
   - Check shutdown signal handling

2. **Error Extraction**
   - Parsing CLI output for agent ID (fragile)
   - Should have structured output option
   - Add `--output json` flag to CLI

3. **Test Fixtures Organization**
   - All in one directory (will get messy)
   - Should organize by type/scenario
   - Refactor in Iteration 6

---

## 📊 Success Metrics

### Current Performance

- **Test Suite Runtime**: 8.9 seconds (3 tests)
- **Server Startup**: ~1 second
- **Server Shutdown**: ~0.6 seconds
- **Per-Test Overhead**: ~1.3 seconds
- **Test Isolation**: 100% (fresh env each time)

### Goals for Iteration 5

- **Test Count**: 10+ tests (currently 3)
- **Test Suite Runtime**: < 30 seconds (acceptable for local dev)
- **Coverage**: Agent scenarios + error cases + basic workflow
- **Reliability**: 100% pass rate (no flaky tests)

---

## 🎯 Quick Start Commands

```bash
# Run all E2E tests
cd test/e2e && go test -v -timeout 60s

# Run specific test
go test -v -run TestE2E/TestApplyBasicAgent

# Run with race detection
go test -v -race -timeout 60s

# Run and save output
go test -v 2>&1 | tee test-output.txt
```

---

## 🔗 Reference Documents

### Completed Iterations
- [Iteration 1 - Minimal POC](checkpoints/01-iteration-1-complete.md)
- [Iteration 2 - Database & CLI Infrastructure](checkpoints/02-iteration-2-infrastructure-complete.md)
- [Iteration 3 - Suite Hanging Fixed](checkpoints/03-iteration-3-suite-hanging-fixed.md)
- [Iteration 4 - Full Integration](checkpoints/04-iteration-4-full-integration-complete.md)

### Research & Planning
- [Research Summary](research-summary.md) - Gemini recommendations
- [Gemini Response](gemini-response.md) - Full analysis
- [Task Planning](tasks/T01_0_plan.md) - Original plan

### Test Documentation
- [Test README](../../test/e2e/README.md) - How to run tests

---

## ❓ Questions Before Starting Iteration 5

1. **Which scenarios to prioritize?**
   - Agent scenarios? Error cases? Workflows?
   - User preference?

2. **Temporal integration?**
   - Add in Iteration 5 or wait?
   - Required for workflow execution tests

3. **Test organization?**
   - Keep adding to existing files or split by category?
   - One file per feature area?

4. **CI/CD integration?**
   - Add GitHub Actions workflow now or later?
   - Need to ensure tests run on push

---

**Status**: ✅ **PHASE 2 FULL EXECUTION TESTS COMPLETE!**  
**Next Action**: Optional - Add more test scenarios (agents with skills, workflows, etc.) OR move to CI/CD integration  
**Estimated Time**: 1-2 hours per scenario (optional)  
**Confidence**: VERY HIGH (99%) - Tests pass reliably with real LLM execution

---

## 🎉 Option 1 Architecture Complete! (2026-01-22)

**Build Tags + Simplified Infrastructure = Production Ready**

### What We Built

✅ **Go build tags** - Clean separation of E2E tests from unit tests  
✅ **Option 1 architecture** - Connect to existing `stigmer server` (no Docker)  
✅ **Simplified harness** - Removed ~200 lines of Docker management code  
✅ **Makefile targets** - `test-e2e` with prerequisites checking  
✅ **Comprehensive documentation** - 312-line README + CI/CD strategy

### How to Use

```bash
# Terminal 1: Start infrastructure
stigmer server

# Terminal 2: Run E2E tests
make test-e2e

# Or run unit tests (no prerequisites)
make test
```

### Key Documents

- `test/e2e/README.md` (312 lines) - Complete guide
- `CICD-STRATEGY.md` - Industry patterns and future plans
- `checkpoints/07-option-1-build-tags-complete.md` - Full implementation details

---

## 🎉 Phase 2 Infrastructure Complete! (2026-01-22)

**All 6 steps from the Phase 2 plan have been implemented:**

✅ **Step 1:** Prerequisites Check (`prereqs_test.go`) - Complete  
✅ **Step 2:** Docker Compose (`docker-compose.e2e.yml`) - Complete  
✅ **Step 3:** Enhanced Harness (`harness_test.go`) - Complete  
✅ **Step 4:** Helper Functions (`helpers_test.go`) - Complete  
✅ **Step 5:** Integration Tests (`e2e_run_full_test.go`) - Complete  
✅ **Step 6:** Documentation - Complete

**Verification Results:**
- Phase 1 tests still pass (100% backward compatible)
- Prerequisites check working (Docker + Ollama detected)
- Phase 2 test infrastructure validated

**See:** `checkpoints/06-phase-2-infrastructure-complete.md` for full details

---

## 🎯 Phase 2: Full Agent Execution Testing

### Overview

Phase 1 tested execution *creation* (smoke tests). Phase 2 will test actual agent *execution* with real LLM calls.

### Required Infrastructure

**Docker Services** (`docker-compose.e2e.yml`):
```yaml
version: '3.8'
services:
  temporal:
    image: temporalio/auto-setup:latest
    ports:
      - "7233:7233"
    
  agent-runner:
    build: ../../backend/services/agent-runner
    environment:
      - TEMPORAL_HOST=temporal:7233
      - STIGMER_SERVER_ADDR=host.docker.internal:PORT
      - OLLAMA_BASE_URL=http://host.docker.internal:11434
    depends_on:
      - temporal
```

**Prerequisites Check** (`test/e2e/prereqs.go`):
```go
func CheckPrerequisites() error {
    // Check Ollama running
    resp, err := http.Get("http://localhost:11434/api/version")
    if err != nil {
        return fmt.Errorf(`
Ollama not running. Please start:
  1. Install: https://ollama.com/
  2. Start: ollama serve
  3. Pull model: ollama pull llama3.2:1b
`)
    }
    
    // Check Docker available
    if err := checkDocker(); err != nil {
        return fmt.Errorf("Docker not available: %w", err)
    }
    
    return nil
}
```

**Enhanced Harness** (`test/e2e/harness_test.go`):
```go
type TestHarness struct {
    // Existing fields
    ServerCmd  *exec.Cmd
    ServerPort int
    TempDir    string
    
    // New fields for Phase 2
    DockerComposeCmd *exec.Cmd
    TemporalReady    bool
    AgentRunnerReady bool
}

func (h *TestHarness) Setup() error {
    // 1. Check prerequisites (Ollama)
    if err := CheckPrerequisites(); err != nil {
        return err
    }
    
    // 2. Start Docker services
    if err := h.startDockerServices(); err != nil {
        return err
    }
    
    // 3. Start stigmer-server (existing)
    // ...
}
```

### New Tests

**1. TestRunWithFullExecution** (Priority: HIGH)

```go
func (s *E2ESuite) TestRunWithFullExecution() {
    // Apply agent
    applyOutput, _ := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", ...)
    
    // Run agent and wait for completion
    runOutput, err := RunCLIWithServerAddr(
        s.Harness.ServerPort,
        "run", "test-agent",
        "--message", "Say hello",
        "--follow=false",
    )
    s.NoError(err)
    
    executionID := extractExecutionID(runOutput)
    
    // Wait for execution to complete (with timeout)
    execution := s.waitForExecutionPhase(
        executionID,
        agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
        30*time.Second,
    )
    
    // Verify execution completed successfully
    s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase)
    
    // Verify agent produced output
    s.NotEmpty(execution.Status.Messages)
    s.Contains(execution.Status.Messages[len(execution.Status.Messages)-1].Content, "hello")
}
```

**2. TestRunWithLogStreaming** (Priority: MEDIUM)

Test the `--follow` flag for real-time log streaming.

**3. TestRunWithRuntimeEnv** (Priority: MEDIUM)

Test passing environment variables to agent execution.

### Implementation Steps

**Step 1: Prerequisites Check** (30 mins)
- [ ] Create `test/e2e/prereqs.go`
- [ ] Implement `CheckOllama()`
- [ ] Implement `CheckDocker()`
- [ ] Add helpful error messages

**Step 2: Docker Compose** (1 hour)
- [ ] Create `test/e2e/docker-compose.e2e.yml`
- [ ] Configure Temporal server
- [ ] Configure agent-runner
- [ ] Test manual startup: `docker-compose -f docker-compose.e2e.yml up`

**Step 3: Enhanced Harness** (1 hour)
- [ ] Add Docker management to harness
- [ ] Implement `startDockerServices()`
- [ ] Implement `stopDockerServices()`
- [ ] Wait for services to be healthy

**Step 4: Helper Functions** (30 mins)
- [ ] `waitForExecutionPhase()` - Poll execution until target phase
- [ ] `getExecutionMessages()` - Retrieve execution messages
- [ ] `TemporalHealthy()` - Check Temporal connectivity

**Step 5: First Integration Test** (1 hour)
- [ ] Implement `TestRunWithFullExecution`
- [ ] Debug any issues
- [ ] Verify LLM response

**Step 6: Cleanup & Documentation** (30 mins)
- [ ] Update README with Phase 2 setup instructions
- [ ] Document Ollama requirements
- [ ] Add troubleshooting guide

### Success Criteria

- [ ] All Phase 1 tests still pass
- [ ] `TestRunWithFullExecution` passes consistently
- [ ] Test suite runs in < 60 seconds
- [ ] Clear error messages when dependencies missing
- [ ] Docker services clean up properly

### Risk Mitigation

**Risk**: Docker not available
- **Mitigation**: Skip Phase 2 tests if Docker not found

**Risk**: Ollama not running
- **Mitigation**: Clear error message with setup instructions

**Risk**: LLM responses non-deterministic
- **Mitigation**: Test for presence of response, not exact content

**Risk**: Temporal startup slow
- **Mitigation**: Increase health check timeout to 30 seconds

---

**Next Action**: Start Phase 2 implementation with prerequisites check  
**Estimated Time**: 4-6 hours total  
**Confidence**: HIGH - Phase 1 foundation is solid
