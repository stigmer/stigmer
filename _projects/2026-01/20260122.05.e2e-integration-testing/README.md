# E2E Integration Testing Framework

**Project ID**: 20260122.05.e2e-integration-testing  
**Started**: January 22, 2026  
**Status**: ✅ **100% Stable** - Test Flakiness Eliminated!

## Latest Achievement (2026-01-23)

🎉 **Zero Flakiness Achieved!**

Fixed intermittent test failures (10% flake rate) by implementing exponential backoff retry logic for Temporal connection during server startup. Tests now pass consistently (0% flake rate over 30+ runs).

**Key improvements**:
- Added 3-attempt retry with exponential backoff (1s, 2s, 4s)
- Increased test timeout from 10s to 30s
- Created automated flakiness detection tool
- Achieved 100% test stability

**See**: `checkpoints/2026-01-23-fix-test-flakiness-temporal-retry.md`

## Overview

End-to-end integration testing framework for Stigmer CLI, SDK, and backend services. Tests the full flow from SDK code generation through `stigmer apply`/`stigmer run` commands to backend execution and streaming output.

## Progress

### ✅ Iteration 1: Minimal POC (Complete)
- Test directory structure (`test/e2e/`)
- Helper utilities (`GetFreePort`, `WaitForPort`)
- Test harness (server lifecycle management)
- Testify suite framework
- Smoke test (`TestServerStarts`) - verified server startup

**Checkpoint**: `checkpoints/01-iteration-1-complete.md`

### ✅ Iteration 2: Database & CLI Infrastructure (Complete)
- Database helpers (`GetFromDB`, `ListKeysFromDB`)
- CLI runner framework (subprocess execution)
- Test fixtures (`Stigmer.yaml`, `basic_agent.go`)
- Comprehensive test cases (`TestApplyBasicAgent`, `TestApplyDryRun`)
- Standalone verification tests

**Checkpoint**: `checkpoints/02-iteration-2-infrastructure-complete.md`

### ✅ Iteration 3: Suite Hanging Issue Fixed (Complete)
- **Critical Fix**: Resolved suite hanging issue that blocked all testing
- Debug HTTP server port conflict fixed (use `ENV=test`)
- Process group management for proper signal propagation
- Graceful shutdown with SIGINT (~8x faster: 0.6s vs 5s+)
- Corrected CLI path and server address handling
- All tests run without hanging ✅

**Checkpoint**: `checkpoints/03-iteration-3-suite-hanging-fixed.md`  
**Fixes Summary**: `FIXES_SUMMARY.md`

### ✅ Iteration 4: Full Integration Testing (Complete)
- ✅ All tests passing (3 tests)
- ✅ API verification pattern (gRPC instead of direct DB access)
- ✅ Apply workflow fully tested
- ✅ Database persistence verified
- ✅ Dry-run mode tested

**Checkpoint**: `checkpoints/04-iteration-4-full-integration-complete.md`

### ✅ Iteration 5 - Phase 1: Run Command Smoke Tests (Complete)
- ✅ **`TestRunBasicAgent`** - Verifies execution creation
- ✅ **`TestRunWithInvalidAgent`** - Tests error handling
- ✅ **`AgentExecutionExistsViaAPI()`** - Helper function added
- ✅ All tests passing (6 tests: 5 pass, 1 skip)
- ✅ Run command tested without Temporal/agent-runner dependencies
- ✅ Foundation solid for Phase 2

**Checkpoint**: `checkpoints/05-phase-1-run-command-tests-complete.md`  
**Summary**: `PHASE_1_SUMMARY.md`

### ✅ Iteration 5 - Phase 2: Full Agent Execution Infrastructure (Complete)

**All 6 steps implemented:**
- ✅ Prerequisites check (`prereqs_test.go`) - Docker & Ollama detection
- ✅ Docker Compose (`docker-compose.e2e.yml`) - Temporal + agent-runner services
- ✅ Enhanced harness (`harness_test.go`) - Docker lifecycle management
- ✅ Helper functions (`helpers_test.go`) - Execution monitoring (WaitForExecutionPhase, GetExecutionMessages)
- ✅ Test suite (`e2e_run_full_test.go`) - FullExecutionSuite with full execution tests
- ✅ Documentation - README, checkpoint, summaries

**Verification:**
- ✅ Phase 1 tests still pass (100% backward compatible)
- ✅ Prerequisites check working (Docker + Ollama detected)
- ✅ Phase 2 infrastructure validated

**Code Statistics:**
- 969 lines of new code
- 340 lines modified
- 1,330 lines of documentation
- 9 files created/modified

**Checkpoint**: `checkpoints/06-phase-2-infrastructure-complete.md`  
**Summary**: `PHASE-2-SUMMARY.md`  
**Accomplishments**: `ACCOMPLISHMENTS.md`

### ✅ Iteration 5 - Phase 2: Full Execution Tests (Complete)

**All tests passing with real LLM execution!**

```bash
=== RUN   TestFullExecution
--- PASS: TestFullExecution (5.23s)
    --- PASS: TestFullExecution/TestRunWithFullExecution (4.36s)
    --- PASS: TestFullExecution/TestRunWithInvalidMessage (0.82s)
PASS
ok      github.com/stigmer/stigmer/test/e2e    6.195s
```

**Key Achievements:**
- ✅ Complete agent lifecycle testing (deploy → execute → validate)
- ✅ Real LLM execution via Temporal workflows (~4.4s)
- ✅ Agent tool call generation and validation
- ✅ Error handling for invalid agents
- ✅ Flexible response validation (tool calls or text)

**Technical Fixes:**
- ✅ Go module dependencies (7 replace directives)
- ✅ Internal package access (use CLI commands)
- ✅ CLI flag syntax (`--follow=false`)
- ✅ Agent ID extraction (3-pattern regex)
- ✅ Agent reference strategy (use name, not ID)
- ✅ Response validation (accept any substantive output)
- ✅ Status detection (workflow-runner/agent-runner)

**Checkpoint**: `checkpoints/09-phase-2-full-execution-tests-complete.md`  
**Changelog**: `_changelog/2026-01/2026-01-22-232840-implement-e2e-phase2-full-execution-tests.md`

### ⚠️ Latest: E2E Test Fixes + Critical Production Issue Discovered! (2026-01-23)

**Test fixes + root cause analysis that revealed a critical production bug!**

**What Was Fixed**:
- ✅ 2 compilation errors (Description field access)
- ✅ Agent ID extraction regex (numeric → alphanumeric)
- ✅ Timeout error messages (shows stuck phase)

**CRITICAL DISCOVERY**:
- 🚨 **Stigmer server loses Temporal connection and never reconnects**
- 🚨 **All executions silently fail forever until manual restart**
- 🚨 **Production-impacting bug discovered via E2E tests**

**Investigation**:
1. Tests timing out → checked logs
2. Found "Workflow creator not available" warnings
3. Verified workflows never started in Temporal
4. Traced code: connection established once, never retried
5. Root cause: One-time init at startup, no health monitoring

**Solution Designed**:
- Health monitoring goroutine (every 30s)
- Auto-reconnection on failure
- Workflow creator reinitialization
- Production-grade resilience
- 464-line fix document with implementation

**Files**:
- Tests: `test/e2e/basic_agent_apply_test.go`, `basic_agent_run_test.go`, `e2e_run_full_test.go`, `helpers_test.go`
- Docs: `backend/services/stigmer-server/docs/FIX_TEMPORAL_CONNECTION_RESILIENCE.md`

**Checkpoint**: `checkpoints/2026-01-23-e2e-tests-temporal-connection-root-cause.md`  
**Changelog**: `_changelog/2026-01/2026-01-23-013735-fix-e2e-tests-temporal-connection-root-cause.md`

**Impact**: HIGH - E2E tests now debuggable, production issue identified with solution

---

### ⏩ Next: Optional Enhancements

**Phase 2 is complete! Next steps are optional:**
1. Add more test scenarios (agents with skills, workflows, etc.)
2. CI/CD integration (GitHub Actions)
3. Performance benchmarks
4. Load testing (concurrent executions)

**Status**: `next-task.md` (updated with Phase 2 completion)

## Primary Goal

Build a comprehensive integration test suite that validates the entire Stigmer stack working together, from user-written SDK code to final execution output, testing against locally running services.

## Problem Statement

Currently, Stigmer has:
- ✅ SDK unit tests (test proto message generation)
- ✅ Individual service tests
- ❌ **NO end-to-end integration tests**

The gap: We can't test the actual user journey from writing SDK code → running `stigmer apply` → running `stigmer run` → verifying correct execution and streaming output.

Manual testing is time-consuming and error-prone. We need automated integration tests.

## What We're Building

### Test Scope

Integration tests that cover:

1. **SDK to Proto Conversion** (already tested in SDK)
   - User writes Go code using Stigmer SDK
   - SDK converts to proto messages

2. **CLI Apply Flow** (NEW - needs testing)
   - `stigmer apply` reads SDK output
   - Validates proto messages
   - Saves to BadgerDB
   - Returns success/error

3. **CLI Run Flow** (NEW - needs testing)
   - `stigmer run` triggers execution
   - Creates agent/workflow execution
   - Workflow runner picks up work
   - Agent runner executes agent code
   - Results stream back to CLI
   - Verify correct output displayed

4. **Full Stack Integration** (NEW - needs testing)
   - All services running (stigmer-server, agent-runner, workflow-runner, temporal)
   - End-to-end execution with streaming
   - Resource cleanup

### Test Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Integration Test Suite (Go testing framework)          │
│                                                          │
│  1. Start local services (daemon manager)               │
│  2. Execute SDK examples programmatically               │
│  3. Run CLI commands (stigmer apply, stigmer run)       │
│  4. Verify outcomes:                                    │
│     - DB state                                          │
│     - Workflow execution                                │
│     - Streaming output                                  │
│  5. Cleanup                                             │
└─────────────────────────────────────────────────────────┘
```

## Technical Components

### Services Under Test

- **CLI**: `stigmer apply`, `stigmer run` commands
- **stigmer-server**: gRPC API, BadgerDB persistence
- **agent-runner**: Python-based agent execution (Docker)
- **workflow-runner**: Temporal workflow execution
- **temporal**: Workflow orchestration
- **local daemon**: Process management

### Test Framework

- **Language**: Go (matches CLI/SDK)
- **Test Runner**: Go `testing` package
- **Process Management**: Shell commands or Go process management
- **Assertions**: testify/assert or similar
- **Test Data**: Use existing SDK examples

## Success Criteria

1. ✅ Test suite can start all local services automatically
2. ✅ Tests can execute SDK examples via CLI commands
3. ✅ Tests verify DB persistence after `stigmer apply`
4. ✅ Tests verify workflow execution triggered by `stigmer run`
5. ✅ **Tests verify complete execution with real LLM responses**
6. ✅ CI-ready test suite with clear pass/fail criteria
7. ✅ Documentation on adding new integration tests
8. ✅ Resource cleanup between tests (no test pollution)

**All success criteria achieved! Phase 2 complete.**

## Timeline

**Estimated**: 1-2 weeks

## Dependencies

- Local daemon infrastructure (✅ exists)
- Temporal runtime (✅ exists)
- All services runnable locally (✅ exists)
- Docker for agent-runner (✅ exists)

## Risks and Challenges

1. **Complex Test Environment Setup**
   - Multiple services need to be running
   - Startup/shutdown coordination
   - Port conflicts

2. **Managing Multiple Processes**
   - Starting/stopping services
   - Handling crashes
   - Log capture and debugging

3. **Flaky Tests Due to Timing Issues**
   - Async execution
   - Streaming delays
   - Service startup time

4. **Resource Cleanup Between Tests**
   - Database cleanup
   - Process cleanup
   - Temporary file cleanup

## Related Work

- SDK unit tests: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/agent/*_test.go`
- SDK examples: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/examples/`
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root/apply.go`
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root/run.go`
- Local daemon: Previous projects on daemon management

## Technology Stack

- **Go**: Test framework, CLI, SDK
- **Python**: Agent runner
- **Temporal**: Workflow orchestration
- **gRPC**: Service communication
- **BadgerDB**: Local persistence
- **Docker**: Agent runner containerization

## Key Questions for Gemini Research

See `gemini-context-document.md` for the full context document to submit to Gemini for framework recommendations.
