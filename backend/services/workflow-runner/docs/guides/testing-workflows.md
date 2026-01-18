# Testing Workflows

## Overview

This guide explains how to test CNCF Serverless Workflow execution using the workflow-runner service.

---

## Test Suite Structure

```
test/
├── golden/                 # Golden test cases (YAML files)
│   ├── 01-operation-basic.yaml
│   ├── 02-switch-conditional.yaml
│   └── ...
└── tools/                  # Test utilities (moved from test/)
    ├── run-golden-tests.sh
    └── diagnose-services.sh
```

---

## Running Tests

### Quick Start

```bash
cd backend/services/workflow-runner/test
./tools/run-golden-tests.sh
```

### Prerequisites

**Required services:**
1. Temporal Server (port 7233)
2. Temporal Worker (polling from server)
3. gRPC Server (port 9090) - for test submission

**Check services:**
```bash
./tools/diagnose-services.sh
```

---

## Golden Test Cases

Golden tests validate core workflow features using simple, deterministic tasks.

### Test Design Principles

**Use `set:` tasks for golden tests:**
- ✅ No external dependencies
- ✅ Deterministic (always succeeds)
- ✅ Fast execution
- ✅ Tests workflow logic

**Avoid complex tasks:**
- ❌ HTTP calls (require activity registration + real endpoints)
- ❌ External services (network dependencies)
- ❌ Time-based operations (non-deterministic)

### Example: Basic Operation Test

```yaml
document:
  dsl: '1.0.0'
  namespace: golden-tests
  name: operation-basic
  version: '1.0.0'
do:
  - initialize:
      set:
        workflow_started: true
  - processData:
      set:
        message: "Hello, Zigflow!"
        status: "success"
  - finalize:
      set:
        workflow_completed: true
```

**What this tests:**
- Workflow YAML parsing
- Multi-task execution
- Task sequencing
- State management
- Workflow completion

---

## Test Execution

### Via gRPC

```bash
# Execute single workflow
grpcurl -plaintext -d '{
  "workflow_execution_id": "test-123",
  "workflow_yaml": "<yaml content>",
  "metadata": {
    "name": "my-test",
    "version": "1.0",
    "namespace": "testing"
  }
}' localhost:9090 \
  ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/execute_async
```

### Via Test Runner

```bash
# Run all golden tests
cd test
./tools/run-golden-tests.sh

# Output:
# Test 1: 01-operation-basic ✅ PASS
# Test 2: 02-switch-conditional ✅ PASS
# ...
# Success Rate: 100%
```

---

## Verifying Results

### Check Temporal UI

```
http://localhost:8233
```

**Steps:**
1. Navigate to Workflows list
2. Find your workflow by execution ID
3. Check status (should be "Completed")
4. Review Event History for errors

### Expected Workflow Status

**Successful execution:**
- Status: Completed
- No errors in event history
- All tasks executed
- Final result present

**Failed execution:**
- Status: Failed
- Error in event history
- Stack trace available
- Specific failure reason

---

## Common Issues

### Services Not Running

**Symptom:** Workflows created but never execute

**Diagnosis:**
```bash
./tools/diagnose-services.sh
```

**Fix:** Start missing services
```bash
# Temporal Server
temporal server start-dev --db-filename /tmp/temporal-stigmer.db

# Worker
cd backend/services/workflow-runner
go run cmd/worker/main.go

# gRPC Server (if needed)
go run cmd/grpc-server/main.go
```

### Format Errors

**Symptom:** "Failed to parse workflow YAML"

**Cause:** Using CNCF 0.8 format instead of DSL 1.0.0

**Fix:** Ensure YAML has:
```yaml
document:
  dsl: '1.0.0'  # ← Required
  # ...
do:              # ← Not states:
  # ...
```

See: [YAML Format Reference](yaml-format-reference.md)

### Activity Not Registered

**Symptom:** "activity type not registered"

**Cause:** Task requires activity (e.g., `call: http`) but activity not registered in worker

**Fix Option 1:** Register activity in worker
```go
w.RegisterActivity(activities.CallHTTPActivity)
```

**Fix Option 2:** Use `set:` task instead
```yaml
do:
  - taskName:
      set:
        key: value
```

---

## Writing New Tests

### Test Template

```yaml
# Test description
# Tests: What features this validates

document:
  dsl: '1.0.0'
  namespace: golden-tests
  name: descriptive-test-name
  version: '1.0.0'
  description: One-line description
do:
  - step1:
      set:
        # task definition
```

### Naming Convention

- `01-feature-name.yaml` - Numbered for execution order
- Use lowercase with hyphens
- Descriptive of what's tested

### Test Checklist

- [ ] Uses DSL 1.0.0 format
- [ ] Has `document:` section with `dsl: '1.0.0'`
- [ ] Uses simple tasks (`set:` preferred)
- [ ] No external dependencies
- [ ] Validates specific feature
- [ ] Has descriptive comments
- [ ] Executes successfully

---

## Test Utilities

### run-golden-tests.sh

Executes all golden test YAMLs via gRPC and reports results.

**Usage:**
```bash
cd test
./tools/run-golden-tests.sh
```

**Output:**
- Per-test status (✅/❌)
- Execution IDs
- Success rate
- Links to Temporal UI

### diagnose-services.sh

Checks if required services are running.

**Usage:**
```bash
./tools/diagnose-services.sh
```

**Checks:**
- Temporal Server (port 7233)
- gRPC Server (port 9090)
- Worker processes
- Service health

---

## Integration Testing

For testing with real HTTP endpoints or external services:

**Create separate test files:**
```
test/
└── integration/
    ├── http-calls.yaml
    ├── grpc-calls.yaml
    └── external-apis.yaml
```

**Requirements:**
- Activity registration in worker
- Real endpoints (not example.com)
- Error handling
- Timeout configuration
- Retry policies

**Example:**
```yaml
document:
  dsl: '1.0.0'
  namespace: integration-tests
  name: github-api-test
  version: '1.0.0'
do:
  - fetchRepo:
      call: http
      with:
        method: GET
        uri: https://api.github.com/repos/leftbin/stigmer
        timeout: 30s
```

---

## CI/CD Integration

### Test Script

```bash
#!/bin/bash
set -e

# Start services
temporal server start-dev --db-filename /tmp/temporal-test.db &
TEMPORAL_PID=$!

# Run worker
go run cmd/worker/main.go &
WORKER_PID=$!

# Wait for services
sleep 5

# Run tests
cd test
./tools/run-golden-tests.sh
TEST_EXIT=$?

# Cleanup
kill $TEMPORAL_PID $WORKER_PID

exit $TEST_EXIT
```

### GitHub Actions Example

```yaml
name: Workflow Tests
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-go@v2
      - name: Install Temporal CLI
        run: brew install temporal
      - name: Run Tests
        run: ./test/tools/run-golden-tests.sh
```

---

## References

**Related Documentation:**
- [YAML Format Reference](yaml-format-reference.md) - DSL 1.0.0 syntax
- [Architecture Overview](../architecture/overview.md) - System design
- [Getting Started](../getting-started/quick-reference.md) - Setup guide

**Test Files:**
- `test/golden/*.yaml` - Golden test cases
- `test/tools/` - Test utilities
- `test/simple-http-workflow.yaml` - HTTP example

**Code:**
- `pkg/executor/temporal_workflow.go` - Workflow execution
- `pkg/zigflow/loader.go` - YAML parsing
- `cmd/worker/main.go` - Worker setup
