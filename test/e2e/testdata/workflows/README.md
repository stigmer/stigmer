# Workflow E2E Test Fixtures

This directory contains workflow test fixtures for end-to-end testing of the Stigmer workflow engine and the **critical serverless workflow spec → Temporal conversion**.

## Test Coverage

### 1. simple_sequential.go
**Tests**: Basic task chaining (Set → HTTP Call → Set)

**What it validates**:
- Sequential task execution
- Field reference dependencies
- Data flow between tasks
- HTTP call task execution
- Variable assignment and usage

**Expected behavior**:
- Task 1 (`init`) sets initial variables
- Task 2 (`fetch`) makes HTTP GET request using variables from Task 1
- Task 3 (`process`) uses fields from Task 2's HTTP response
- Dependencies are automatically tracked through field references

### 2. conditional_switch.go
**Tests**: Conditional branching with Switch task

**What it validates**:
- Switch task configuration
- Multiple case conditions
- Default case handling
- Conditional task routing

**Expected behavior**:
- Task 1 (`init`) sets a status variable
- Task 2 (`check-status`) evaluates status and routes to appropriate handler
- Different handlers for: pending, approved, rejected, unknown

### 3. parallel_fork.go
**Tests**: Parallel execution with Fork task

**What it validates**:
- Fork task configuration
- Multiple parallel branches
- Branch result merging
- Concurrent HTTP calls

**Expected behavior**:
- Task 1 (`init`) sets base URL and user ID
- Task 2 (`parallel-fetch`) executes 3 HTTP calls in parallel:
  - Fetch posts
  - Fetch todos
  - Fetch albums
- Task 3 (`merge-results`) combines results from all branches

### 4. loop_for.go
**Tests**: Loop execution with For task

**What it validates**:
- For task configuration
- Iteration over collections
- Loop variable scoping
- Repeated task execution

**Expected behavior**:
- Task 1 (`init`) creates an array of items
- Task 2 (`process-items`) iterates over items and processes each
- Task 3 (`calculate-result`) aggregates loop results

### 5. error_handling.go
**Tests**: Error handling with Try/Catch

**What it validates**:
- Try/Catch task configuration
- Error detection and recovery
- Fallback logic execution
- Error propagation

**Expected behavior**:
- Task 1 (`init`) sets up endpoints (primary and fallback)
- Task 2 (`try-fetch`) attempts primary endpoint
  - If successful: uses primary data
  - If error: catches error and uses fallback endpoint
- Task 3 (`process-result`) handles result regardless of path taken

## Critical Testing Areas

These tests focus on the **serverless workflow spec → Temporal conversion**, which is the most error-prone area:

### 1. Task Dependency Tracking
- Implicit dependencies through field references
- Explicit dependencies via `DependsOn()`
- Dependency ordering validation

### 2. Control Flow Conversion
- Sequential execution (Then)
- Conditional branching (Switch)
- Parallel execution (Fork)
- Loop iteration (For)
- Error handling (Try/Catch)

### 3. Data Flow & Context
- Variable scoping across tasks
- Field reference resolution (`${.taskName.field}`)
- Context propagation between tasks
- Export directives (`ExportAs`)

### 4. Task Configuration Serialization
- Converting Go SDK calls to protocol buffers
- Preserving task configuration options
- Handling complex nested structures

## Running Tests

### Run All Workflow Tests
```bash
cd test/e2e
go test -v -tags=e2e -run TestWorkflow
```

### Run Specific Test
```bash
go test -v -tags=e2e -run TestWorkflowApply/TestApplySimpleSequential
go test -v -tags=e2e -run TestWorkflowExecution/TestExecuteSimpleSequential
```

### Run with Detailed Output
```bash
go test -v -tags=e2e -run TestWorkflow -timeout 120s
```

## Expected Test Phases

### Phase 1: Apply Tests (Deployment + Validation)
Each workflow is deployed and its structure is validated:
1. **Parse & Synthesize**: Go code → Proto definitions
2. **Validation**: Proto validation rules applied
3. **Storage**: Workflow stored in server
4. **Retrieval**: Workflow retrieved via API
5. **Structure Check**: Task count, types, dependencies verified

### Phase 2: Execution Tests (Run + Validation)
Workflows are executed and results are validated:
1. **Deploy**: Apply workflow (from Phase 1)
2. **Execute**: Start workflow execution
3. **Poll**: Wait for execution completion
4. **Validate**: Check execution status and outputs

## Debugging Workflow Issues

### Check Workflow Structure
```bash
# Apply workflow and inspect output
stigmer apply --config testdata/workflows/Stigmer.yaml

# Query workflow details
stigmer workflow get <workflow-id> --output json
```

### Check Temporal Conversion
The critical conversion happens in `workflow-runner` service:
```
Go SDK → Proto → YAML (Serverless Spec) → Temporal Workflow
```

Look for logs in:
- `stigmer server` output (synthesis phase)
- `workflow-runner` service logs (execution phase)

### Common Failure Patterns
1. **Dependency Resolution**: Tasks execute out of order
2. **Field References**: `${.field}` not resolving correctly
3. **Control Flow**: Switch/Fork/For not routing correctly
4. **Error Handling**: Try/Catch not catching errors
5. **Data Marshaling**: Complex types not serializing properly

## Future Test Scenarios

### Additional task types to test:
- `GRPC_CALL` - gRPC service calls
- `AGENT_CALL` - Agent invocation from workflows
- `RUN` - Script execution
- `CALL_ACTIVITY` - Sub-workflow calls
- `LISTEN` - Event-driven triggers
- `RAISE` - Manual error raising
- `WAIT` - Delays and timeouts

### Complex scenarios:
- Nested workflows (workflow calling workflow)
- Long-running workflows with checkpoints
- Workflow versioning and upgrades
- Concurrent workflow executions
- Workflow cancellation and cleanup

## Notes

- All workflow fixtures use `//go:build ignore` to prevent inclusion in main build
- Fixtures are compiled and executed by the `stigmer apply` command
- `Stigmer.yaml` specifies which fixture to execute (updated per test)
- Tests use real HTTP endpoints (jsonplaceholder.typicode.com) for realistic scenarios
