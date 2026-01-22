# E2E Tests for Workflow Calling Agent Example

## Overview

This document describes the comprehensive e2e test coverage for the "workflow calling simple agent" example (`15-workflow-calling-simple-agent`).

## Example Details

**SDK Example**: `sdk/go/examples/15_workflow_calling_simple_agent.go`  
**Test Fixture**: `test/e2e/testdata/examples/15-workflow-calling-simple-agent/`

The example demonstrates the simplest agent call pattern:
- Creates a simple agent (`code-reviewer`) for code reviews
- Creates a workflow (`simple-review`) that calls the agent
- Uses `workflow.Agent()` for direct instance references
- Basic agent call with a static message

This is the "Hello World" of agent-workflow integration.

## Test Files

### 1. `workflow_calling_agent_apply_test.go` - Apply/Deployment Tests

Tests that verify workflow and agent deployment:

#### Test: `TestApplyWorkflowCallingAgent`
**Purpose**: Full workflow apply test where a workflow calls an agent

**What it verifies**:
1. Both agent and workflow are deployed successfully
2. Agent properties (name, instructions, description)
3. Workflow properties (name, namespace, version, description)
4. Workflow has exactly one task
5. Task is of type `AGENT_CALL`
6. Task has proper configuration

**Expected outcome**: Both resources deployed with correct properties and proper linkage

---

#### Test: `TestApplyWorkflowCallingAgentCount`
**Purpose**: Verify resource count

**What it verifies**:
1. Exactly 1 agent is deployed (`code-reviewer`)
2. Exactly 1 workflow is deployed (`simple-review`)
3. Both resources queryable by slug

**Expected outcome**: Correct number of resources deployed

---

#### Test: `TestApplyWorkflowCallingAgentDryRun`
**Purpose**: Test dry-run mode

**What it verifies**:
1. Dry-run command succeeds
2. Output indicates dry run
3. No agents or workflows actually stored in database

**Expected outcome**: Validation works but nothing persisted

---

#### Test: `TestApplyWorkflowCallingAgentTaskStructure`
**Purpose**: Verify agent call task structure

**What it verifies**:
1. Workflow has exactly 1 task
2. Task name is `reviewCode`
3. Task kind is `WORKFLOW_TASK_KIND_AGENT_CALL`
4. Task has configuration

**Expected outcome**: Task structure is correct for agent calls

---

#### Test: `TestApplyWorkflowCallingAgentVerifyBoth`
**Purpose**: Independent verification of both resources

**What it verifies**:
1. Agent can be queried independently with complete details
2. Workflow can be queried independently with complete details
3. Workflow references agent properly
4. Both resources are valid and properly linked

**Expected outcome**: Both resources are independently valid and correctly linked

---

### 2. `workflow_calling_agent_run_test.go` - Run/Execution Tests

Tests that verify workflow execution (Phase 1 - smoke tests):

#### Test: `TestRunWorkflowCallingAgent`
**Purpose**: Basic workflow run test (execution creation only)

**What it verifies**:
1. Workflow and agent are deployed
2. `stigmer run` command executes successfully
3. Execution record is created
4. Execution exists via API query

**Expected outcome**: Execution created (Phase 1 - doesn't wait for actual execution)

**Note**: Actual execution requires Temporal + workflow-runner + agent-runner (Phase 2)

---

#### Test: `TestRunWorkflowCallingAgentVerifyPhase`
**Purpose**: Verify execution phase

**What it verifies**:
1. Workflow and agent are deployed
2. Execution is created
3. Execution is in `EXECUTION_PENDING` phase initially

**Expected outcome**: New execution starts in PENDING phase

**Note**: Phase progression requires Temporal + workflow-runner (Phase 2)

---

#### Test: `TestRunWorkflowCallingAgentWithInvalidName`
**Purpose**: Error handling for invalid workflow

**What it verifies**:
1. Running a non-existent workflow fails
2. Proper error is returned

**Expected outcome**: Command fails gracefully with error

---

#### Test: `TestRunWorkflowCallingAgentMultipleTimes`
**Purpose**: Multiple executions of same workflow

**What it verifies**:
1. Workflow can be run multiple times
2. Each run creates a unique execution ID
3. Both executions exist independently via API

**Expected outcome**: Multiple unique executions can be created

---

#### Test: `TestRunWorkflowCallingAgentVerifyMetadata`
**Purpose**: Execution metadata verification

**What it verifies**:
1. Execution has proper metadata (ID, etc.)
2. Execution references the correct workflow
3. Execution has proper status structure
4. Execution starts in PENDING phase

**Expected outcome**: Execution metadata is complete and correct

---

## Test Coverage Summary

### Apply Tests (5 tests)
1. ✅ Full deployment with verification
2. ✅ Resource count verification
3. ✅ Dry-run mode
4. ✅ Task structure verification
5. ✅ Independent resource verification

### Run Tests (5 tests)
1. ✅ Basic execution creation
2. ✅ Execution phase verification
3. ✅ Invalid workflow error handling
4. ✅ Multiple executions
5. ✅ Metadata verification

**Total**: 10 comprehensive test cases

## Key Testing Patterns

### 1. Query by Slug Pattern
Tests use `GetAgentBySlug()` and `GetWorkflowBySlug()` instead of parsing CLI output for IDs:

```go
// Query by slug - robust and maintainable
agent, err := GetAgentBySlug(serverPort, "code-reviewer", org)
workflow, err := GetWorkflowBySlug(serverPort, "simple-review", org)
```

### 2. Task Kind Verification
Tests verify task type using the correct enum:

```go
s.Equal(apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, task.Kind,
    "Task should be of type AGENT_CALL")
```

### 3. Configuration Check (Not Unmarshaling)
Tests verify configuration exists without unmarshaling the protobuf Struct:

```go
s.NotNil(task.TaskConfig, "Agent call task should have configuration")
```

This is simpler and sufficient for smoke tests.

### 4. Phase 1 vs Phase 2 Tests
- **Phase 1**: Tests verify execution *creation* (no Temporal required)
- **Phase 2**: Tests would verify actual *execution* (requires Temporal + runners)

Current tests are Phase 1 - they don't wait for or verify actual workflow execution.

## Running the Tests

### Prerequisites
```bash
# Terminal 1: Start stigmer server
stigmer server

# Or use automatic server management (tests start/stop as needed)
```

### Run All Tests for This Example
```bash
cd test/e2e
go test -v -tags=e2e -run TestApplyWorkflowCallingAgent -timeout 60s
go test -v -tags=e2e -run TestRunWorkflowCallingAgent -timeout 60s
```

### Run Specific Test
```bash
go test -v -tags=e2e -run TestApplyWorkflowCallingAgent/TestApplyWorkflowCallingAgentCount
```

### Run All Apply Tests
```bash
go test -v -tags=e2e -run TestApplyWorkflowCallingAgent -timeout 60s
```

### Run All Run Tests
```bash
go test -v -tags=e2e -run TestRunWorkflowCallingAgent -timeout 60s
```

## Test Design Decisions

### Why Separate Apply and Run Test Files?
1. **Clear separation of concerns**: Apply tests focus on deployment, Run tests focus on execution
2. **Parallel execution**: Can be run independently
3. **Maintainability**: Easier to locate and modify specific test types

### Why Not Unmarshal TaskConfig?
1. **Simplicity**: Phase 1 tests only need to verify structure exists
2. **Robustness**: Don't depend on internal proto marshaling details
3. **Sufficient**: Verifying kind + config existence proves deployment worked

### Why Query by Slug?
1. **Robustness**: Not dependent on CLI output format
2. **Direct verification**: Uses actual API (end-to-end)
3. **Maintainability**: Changes to CLI output don't break tests

## Future Enhancements (Phase 2)

When Temporal + workflow-runner + agent-runner are available:

1. **Full Execution Tests**
   - Wait for workflow execution to complete
   - Verify agent was actually invoked
   - Check execution output/results

2. **Log Streaming Tests**
   - Test `--follow` flag
   - Verify real-time log output

3. **Error Handling Tests**
   - Agent call failures
   - Timeout scenarios
   - Invalid configurations

## Related Examples

This pattern is the simplest agent-workflow integration. Related examples include:

- `16-workflow-calling-agent-by-slug` - References agent by slug instead of instance
- Other agent call patterns in SDK examples

## References

- **SDK Example**: `sdk/go/examples/15_workflow_calling_simple_agent.go`
- **Test Fixture**: `test/e2e/testdata/examples/15-workflow-calling-simple-agent/`
- **Helper Functions**: `test/e2e/helpers_test.go`
- **Basic Workflow Tests**: `test/e2e/docs/implementation/basic-workflow-tests.md`

---

**Last Updated**: 2026-01-23  
**Test Status**: ✅ All tests compiling and ready to run  
**Coverage**: 10 test cases covering apply and run scenarios
