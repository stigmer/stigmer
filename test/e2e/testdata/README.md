# E2E Test Data

This directory contains test fixtures for end-to-end testing of Stigmer's core functionality.

## Directory Structure

```
testdata/
├── examples/        # SDK example test fixtures (copied from sdk/go/examples/)
│   ├── 01-basic-agent/
│   │   ├── main.go
│   │   └── Stigmer.yaml
│   ├── 02-agent-with-skills/
│   │   └── main.go
│   ├── 07-basic-workflow/
│   │   └── main.go
│   └── ... (all SDK examples)
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

These patterns are demonstrated in the SDK examples (`sdk/go/examples/`).

## Test Fixtures

### SDK Examples (`examples/`)
Test fixtures are automatically copied from SDK examples (`sdk/go/examples/`) before tests run.

This ensures:
- ✅ Tests use the exact same code that users see in SDK documentation
- ✅ SDK examples are continuously validated through E2E tests
- ✅ No manual synchronization needed between SDK examples and test fixtures

The copy process happens in `SetupSuite()` via `CopyAllSDKExamples()` in `sdk_fixtures_test.go`.

See [examples/01-basic-agent/README.md](examples/01-basic-agent/README.md) for details on how the copy mechanism works.

## Running Tests

### Run All E2E Tests
```bash
cd test/e2e
go test -v -tags=e2e
```

### Run Specific Test Category
```bash
# Run basic agent tests
go test -v -tags=e2e -run TestBasicAgent

# Run full execution tests
go test -v -tags=e2e -run TestFullExecution
```

### Run Specific Test
```bash
go test -v -tags=e2e -run TestWorkflowApply/TestApplySimpleSequential
```

## Adding New Test Cases

Test fixtures are automatically generated from SDK examples. To add a new test:

### 1. Add SDK Example
Create a new SDK example in `sdk/go/examples/`:
```bash
# Example: Create 20_new_feature.go
cd sdk/go/examples/
# Create your example file
```

### 2. Update sdk_fixtures_test.go
Add the new example to `CopyAllSDKExamples()`:
```go
{
    SDKFileName:    "20_new_feature.go",
    TestDataDir:    "examples/20-new-feature",
    TargetFileName: "main.go",
},
```

### 3. Create Stigmer.yaml (if needed)
For agent examples that need configuration:
```bash
mkdir -p testdata/examples/20-new-feature
cat > testdata/examples/20-new-feature/Stigmer.yaml <<EOF
name: new-feature-test
runtime: go
main: main.go
version: 0.1.0
description: Test for new feature
EOF
```

### 4. Add Test Cases
Update test files (e.g., `basic_agent_apply_test.go`) to include your new test.

## Notes

- All fixtures use `//go:build ignore` to prevent inclusion in main build
- Fixtures are compiled and executed by the `stigmer apply` command
- Tests validate both deployment (apply) and execution (run)
- Real external APIs are used for realistic testing (e.g., jsonplaceholder.typicode.com)
