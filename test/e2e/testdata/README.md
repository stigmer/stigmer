# E2E Test Data

This directory contains test fixtures for end-to-end testing of Stigmer's core functionality.

## Directory Structure

```
testdata/
├── agents/          # Agent test fixtures
│   └── basic-agent/
│       ├── main.go
│       └── Stigmer.yaml
├── workflows/       # Workflow test fixtures
│   ├── simple-sequential/
│   ├── conditional-switch/
│   ├── error-handling/
│   ├── loop-for/
│   └── parallel-fork/
└── go.mod          # Shared Go module for test fixtures
```

## Organization Principles

### One Folder Per Test Case
Each test case lives in its own folder with:
- `main.go` - The implementation (agent/workflow/skill)
- `Stigmer.yaml` - Configuration pointing to the entry point

This structure ensures:
- ✅ Each test is independently executable
- ✅ CLI can find the entry point via `Stigmer.yaml`
- ✅ Tests don't interfere with each other
- ✅ Easy to add new test cases

### Latest SDK Patterns
All test fixtures follow the latest Stigmer SDK patterns:
- **Direct field references** instead of expression syntax
- **Automatic exports** (no `.ExportAll()` needed)
- **Implicit dependencies** through field references
- **Clean builders** (workflow-scoped, not module-level)

See [workflows/README.md](workflows/README.md) for detailed SDK patterns.

## Test Categories

### Agents (`agents/`)
Tests for agent creation, configuration, and execution.

See [agents/README.md](agents/README.md) for details.

### Workflows (`workflows/`)
Tests for workflow engine, task execution, and control flow.

See [workflows/README.md](workflows/README.md) for details.

## Running Tests

### Run All E2E Tests
```bash
cd test/e2e
go test -v -tags=e2e
```

### Run Agent Tests
```bash
go test -v -tags=e2e -run TestAgent
```

### Run Workflow Tests
```bash
go test -v -tags=e2e -run TestWorkflow
```

### Run Specific Test
```bash
go test -v -tags=e2e -run TestWorkflowApply/TestApplySimpleSequential
```

## Adding New Test Cases

### 1. Create Test Folder
```bash
mkdir -p testdata/workflows/my-new-test
```

### 2. Create main.go
```go
//go:build ignore

package main

import (
    "log"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    err := stigmer.Run(func(ctx *stigmer.Context) error {
        // Your test implementation
        return nil
    })
    if err != nil {
        log.Fatalf("Failed: %v", err)
    }
}
```

### 3. Create Stigmer.yaml
```yaml
name: my-new-test
runtime: go
main: main.go
version: 0.1.0
description: Description of the test
```

### 4. Add Test Case
Update `test/e2e/e2e_run_full_test.go` to include your new test.

## Notes

- All fixtures use `//go:build ignore` to prevent inclusion in main build
- Fixtures are compiled and executed by the `stigmer apply` command
- Tests validate both deployment (apply) and execution (run)
- Real external APIs are used for realistic testing (e.g., jsonplaceholder.typicode.com)
