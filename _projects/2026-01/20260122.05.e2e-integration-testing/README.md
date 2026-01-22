# E2E Integration Testing Framework

**Project ID**: 20260122.05.e2e-integration-testing  
**Started**: January 22, 2026  
**Status**: 🟢 In Progress - Iteration 3 Complete

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

### ⏩ Next: Iteration 4 - Full Integration Testing
- Run full test suite and verify apply workflow
- Debug any remaining issues in `TestApplyBasicAgent`
- Verify database persistence
- Add more test scenarios (error cases, edge cases)

**Status**: `next-task.md`

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
5. ✅ Tests verify streaming output captured and correct
6. ✅ CI-ready test suite with clear pass/fail criteria
7. ✅ Documentation on adding new integration tests
8. ✅ Resource cleanup between tests (no test pollution)

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
