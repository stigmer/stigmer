# Workflow Runner Testing Guide

How to test the workflow-runner service.

## Two Essential Tests

We have **exactly two test scripts** that cover all scenarios:

### Test 1: gRPC Mode (Direct Execution)
```bash
cd backend/services/workflow-runner
./tools/test-grpc-mode.sh
```

**What it tests**: 
- Client calls gRPC Execute RPC
- workflow-runner executes workflow directly
- Progress reported to Stigmer Service

### Test 2: Temporal Mode (Workflow Execution)
```bash
cd backend/services/workflow-runner  
./tools/test-temporal-mode.sh
```

**What it tests**:
- Client calls gRPC Execute RPC
- workflow-runner starts Temporal workflow `ExecuteServerlessWorkflow`
- Temporal worker picks up workflow
- Workflow parses YAML and executes tasks as activities
- Progress reported via ReportProgress activities

---

## Architecture Overview

### Two Entry Points

The workflow-runner has **two ways to trigger workflows**:

#### 1. gRPC API (Primary Interface)

```
Client → gRPC Execute/ExecuteAsync 
      → WorkflowRunner Service
      → Executes workflow (gRPC mode) OR starts Temporal workflow (Temporal mode)
```

This is the **main API** that Stigmer Service uses.

#### 2. Temporal CLI (Bypasses Service)

```
Temporal CLI → Temporal Server
            → Temporal Worker
            → Executes workflow directly
```

This **bypasses the gRPC layer** entirely! Only useful for debugging Temporal-specific issues.

---

## Testing Levels

### Level 1: Unit Tests

Test individual components in isolation:

```bash
# Run Go unit tests
bazel test //backend/services/workflow-runner/...

# Run specific test
bazel test //backend/services/workflow-runner/pkg/executor:executor_test
```

**What it tests**:
- Workflow parsing and validation
- Task execution logic
- Progress reporting helpers
- Error handling

**What it doesn't test**:
- End-to-end workflow execution
- gRPC server
- Temporal integration

### Level 2: gRPC Integration Tests

Test the **actual service** via its gRPC API:

```bash
# Test gRPC Execute endpoint (sync streaming)
./tools/test-grpc-execute.sh

# Test gRPC ExecuteAsync endpoint (fire-and-forget)
./tools/test-grpc-execute-async.sh  # TODO: Create this
```

**What it tests**:
- gRPC server accepting requests
- Workflow execution end-to-end
- Progress event streaming
- Error handling at API level

**What it doesn't test**:
- Temporal-specific durability
- Long-running workflow resilience

### Level 3: Temporal Integration Tests

Test Temporal-specific behavior:

```bash
# Start worker in Temporal mode
export EXECUTION_MODE=temporal
bazel run //backend/services/workflow-runner:workflow_runner

# In another terminal, trigger via gRPC (NOT Temporal CLI!)
./tools/test-grpc-execute.sh
```

**What it tests**:
- Temporal workflow registration
- Activity execution
- Durable workflow state
- Workflow history
- Progress reporting via activities

**What it doesn't test**:
- Multi-day workflows
- Cluster failures

---

## Test Scripts

All test scripts are in `tools/`:

```
backend/services/workflow-runner/tools/
├── test-grpc-mode.sh       # Test 1: Direct execution via gRPC
└── test-temporal-mode.sh   # Test 2: Temporal workflow execution
```

That's it. Just two tests that cover everything.

---

## Quick Start

### Test gRPC Mode
```bash
cd backend/services/workflow-runner
./tools/test-grpc-mode.sh
```

The script handles everything: starts worker, sends workflow, verifies execution.

### Test Temporal Mode  
```bash
cd backend/services/workflow-runner
./tools/test-temporal-mode.sh
```

The script starts worker in Temporal mode, triggers workflow, and shows you where to verify in Temporal UI.

---

## Using grpcurl Manually

Install grpcurl:
```bash
brew install grpcurl
```

List available services:
```bash
grpcurl -plaintext localhost:9090 list
```

Describe a service:
```bash
grpcurl -plaintext localhost:9090 \
  describe ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController
```

Call Execute (sync streaming):
```bash
# Create workflow YAML
cat > /tmp/test.yaml <<EOF
document:
  dsl: 1.0.0
  namespace: stigmer
  name: test
  version: 0.0.1
do:
  - setGreeting:
      set:
        message: "Hello World"
EOF

# Escape for JSON
WORKFLOW_YAML=$(cat /tmp/test.yaml | jq -Rs .)

# Call Execute RPC
grpcurl -plaintext -d "{
  \"workflow_execution_id\": \"test-123\",
  \"workflow_yaml\": $WORKFLOW_YAML,
  \"metadata\": {
    \"name\": \"test\",
    \"namespace\": \"stigmer\",
    \"version\": \"0.0.1\"
  },
  \"workflow_input\": {},
  \"env_vars\": {}
}" \
localhost:9090 \
ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/Execute
```

Call ExecuteAsync (fire-and-forget):
```bash
grpcurl -plaintext -d "{
  \"workflow_execution_id\": \"test-async-123\",
  \"workflow_yaml\": $WORKFLOW_YAML,
  \"metadata\": {
    \"name\": \"test\",
    \"namespace\": \"stigmer\",
    \"version\": \"0.0.1\"
  },
  \"workflow_input\": {},
  \"env_vars\": {}
}" \
localhost:9090 \
ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/ExecuteAsync
```

---

## Testing Progress Reporting (Phase 3 Day 3)

Progress reporting has two paths:

### In gRPC Mode

Progress events are sent via **callback client** to Stigmer Service:

```
WorkflowExecutor.Execute()
  → reportProgress()
  → CallbackClient.ReportProgress()
  → gRPC call to Stigmer Service
  → Stigmer Service stores & broadcasts
```

**To test**:
1. Start Stigmer Service locally
2. Start workflow-runner in gRPC mode
3. Run `./tools/test-grpc-execute.sh`
4. Check Stigmer Service logs for progress events

### In Temporal Mode

Progress events are sent via **Temporal activity**:

```
Temporal Workflow (ExecuteServerlessWorkflow)
  → reportProgress() helper
  → Calls ReportProgress Activity
  → Activity creates CallbackClient
  → gRPC call to Stigmer Service
```

**To test**:
1. Start workflow-runner in Temporal mode
2. Run `./tools/test-grpc-execute.sh`
3. Check Temporal UI for activity executions
4. Check Stigmer Service logs for progress events

---

## Common Issues

### "Connection refused on port 9090"

**Problem**: workflow-runner is not running

**Solution**: Start the service first (see Step 1 above)

### "Task queue not found"

**Problem**: Worker is in gRPC mode, but trying to use Temporal

**Solution**: Set `EXECUTION_MODE=temporal` or `dual`

### "No workflows in Temporal UI"

**Problem**: Using Temporal CLI directly instead of gRPC API

**Solution**: Use `./tools/test-grpc-execute.sh` instead

### "grpcurl not found"

**Problem**: grpcurl not installed

**Solution**: `brew install grpcurl`

---

## Best Practices

### ✅ DO

- Test via gRPC API (`./tools/test-grpc-execute.sh`)
- Start with gRPC mode for faster iteration
- Use Temporal mode for integration testing
- Check both worker logs AND Temporal UI
- Verify progress events in Stigmer Service

### ❌ DON'T

- Use Temporal CLI to trigger workflows (bypasses service)
- Test only in one mode (test both gRPC and Temporal)
- Ignore error logs
- Assume Temporal mode works if gRPC mode works (different code paths)

---

## Next Steps

After running basic tests:

1. **Golden Test Suite** - Run against all test workflows:
   ```bash
   cd test/golden
   ./run_tests.sh
   ```

2. **Load Testing** - Test concurrent executions

3. **Long-Running Workflows** - Test multi-hour workflows in Temporal mode

4. **Failure Scenarios** - Test error handling, retries, cancellation

---

**Key Takeaway**: Always test via the **gRPC API** we built. That's the interface Stigmer Service uses. Temporal CLI is only for debugging Temporal-specific issues.
