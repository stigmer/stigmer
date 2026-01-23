# E2E Test Organization

This document explains how E2E tests are organized in the Stigmer project.

## Philosophy

**Tests are organized by SDK example** to make them easy to find and maintain.

- Test files: `test/e2e/*_test.go` (runnable by `go test`)
- Test fixtures: `test/e2e/testdata/` (agent/workflow code, configs)

## Current Structure

```
test/e2e/
├── basic_agent_apply_test.go      ← Tests for stigmer apply (basic agent)
├── basic_agent_run_test.go        ← Tests for stigmer run (basic agent)
├── e2e_run_test.go                 ← Generic run tests
├── e2e_run_full_test.go            ← Phase 2 full execution tests
├── suite_test.go                   ← Test suite setup
├── harness_test.go                 ← Test harness
├── helpers_test.go                 ← Helper functions
├── prereqs_test.go                 ← Prerequisites checking
└── testdata/
    └── examples/                    ← SDK examples (copied from sdk/go/examples/)
        ├── 01-basic-agent/          ← Test fixtures (NON-test code)
        │   ├── main.go              ← Agent code (copied from SDK)
        │   ├── Stigmer.yaml         ← Agent config
        │   └── README.md
        ├── 02-agent-with-skills/
        ├── 07-basic-workflow/
        └── ... (all 19 SDK examples)
```

## Key Points

### 1. Test Files (in `test/e2e/`)

Test files live in `test/e2e/` with clear, descriptive names:

- `basic_agent_apply_test.go` - Apply tests for basic agent example
- `basic_agent_run_test.go` - Run tests for basic agent example
- Future: `agent_with_skills_apply_test.go`, `basic_workflow_test.go`, etc.

**Benefits:**
- ✅ Tests are discoverable and runnable by `go test`
- ✅ Clear naming shows which SDK example is being tested
- ✅ Easy to add tests for new examples

### 2. Test Fixtures (in `testdata/`)

The `testdata/` directory contains **non-test code** only:
- Agent/workflow code (copied from SDK examples during test setup)
- Configuration files (`Stigmer.yaml`)
- Any other test data

**Why `testdata/`?**
- Go convention: `testdata/` is excluded from packages
- Keeps test fixtures separate from test code
- Prevents accidental inclusion in builds

### 3. SDK Example Synchronization

During test setup (`SetupSuite()`), SDK examples are automatically copied to testdata:

```go
func (s *E2ESuite) SetupSuite() {
    // Copy SDK examples to testdata
    if err := CopyAllSDKExamples(); err != nil {
        s.T().Fatalf("Failed to copy SDK examples: %v", err)
    }
    // ...
}
```

**Example mapping:**
- `sdk/go/examples/01_basic_agent.go` → `test/e2e/testdata/examples/01-basic-agent/main.go`
- `sdk/go/examples/02_agent_with_skills.go` → `test/e2e/testdata/examples/02-agent-with-skills/main.go`
- ... (all 19 SDK examples)

This ensures tests validate the **exact code** that SDK users see in examples.

## Adding Tests for New Examples

### Step 1: Add to SDK Copy Mapping

Edit `test/e2e/sdk_fixtures_test.go`:

```go
func CopyAllSDKExamples() error {
    examples := []SDKExample{
        // Existing
        {
            SDKFileName:    "01_basic_agent.go",
            TestDataDir:    "examples/01-basic-agent",
            TargetFileName: "main.go",
        },
        // NEW: Add your example
        {
            SDKFileName:    "02_agent_with_skills.go",
            TestDataDir:    "examples/02-agent-with-skills",
            TargetFileName: "main.go",
        },
    }
    // ...
}
```

### Step 2: Create Test Fixture Directory

```bash
mkdir -p test/e2e/testdata/examples/02-agent-with-skills
```

Add `Stigmer.yaml` (only if the example needs configuration):

```yaml
name: agent-with-skills-test
runtime: go
main: main.go
version: 0.1.0
description: Agent with skills test
```

### Step 3: Create Test Files

Create test files in `test/e2e/`:

**`test/e2e/agent_with_skills_apply_test.go`:**
```go
//go:build e2e
// +build e2e

package e2e

import (
    "path/filepath"
    "strings"
)

// TestApplyAgentWithSkills tests applying an agent with skills
//
// Example: sdk/go/examples/02_agent_with_skills.go
// Test Fixture: test/e2e/testdata/examples/02-agent-with-skills/
func (s *E2ESuite) TestApplyAgentWithSkills() {
    testdataDir := filepath.Join("testdata", "examples", "02-agent-with-skills")
    absTestdataDir, err := filepath.Abs(testdataDir)
    s.Require().NoError(err)
    
    output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
    s.Require().NoError(err)
    
    // Add your assertions...
}
```

### Step 4: Run Tests

```bash
cd test/e2e
go test -tags=e2e -v
```

## Running Tests

```bash
# All E2E tests
cd test/e2e
go test -tags=e2e -v

# Specific test
go test -tags=e2e -v -run TestApplyBasicAgent

# With race detection
go test -tags=e2e -v -race
```

## Design Decisions

### Why Not Put Tests in `testdata/`?

Go's `testdata/` directory is **ignored** by `go test`. Tests placed there won't run.

### Why Not Use Subdirectory Packages?

Go modules make subdirectory packages complex. Keeping all tests in the main `e2e` package is simpler and more maintainable.

### Why Clear File Naming?

- `basic_agent_apply_test.go` is more discoverable than scattered tests
- Easy to find which tests cover which SDK examples
- Scales well as more examples are added

## Test Categories

### Phase 1: Deployment Tests
Tests in `*_apply_test.go` files:
- Verify `stigmer apply` works
- Check deployment to server
- Validate resource creation

### Phase 2: Execution Tests (Basic)
Tests in `*_run_test.go` files:
- Verify `stigmer run` creates execution records
- Check execution metadata
- Does NOT wait for actual LLM execution

### Phase 3: Full Execution Tests
Tests in `e2e_run_full_test.go`:
- Requires full stigmer server stack (Temporal, runners)
- Waits for actual LLM execution
- Validates execution results

## Maintenance

### When SDK Examples Change
Tests automatically use the latest SDK code because `SetupSuite()` copies it fresh before each test run.

### When Adding New Examples
1. Add to `CopyAllSDKExamples()` mapping
2. Create testdata directory with `Stigmer.yaml`
3. Create test file(s) in `test/e2e/`

### When Refactoring
Tests stay in `test/e2e/` with descriptive names, making refactoring easier.

---

**Summary**: Tests in `test/e2e/*.go`, fixtures in `testdata/`, clear naming, SDK synchronization. Simple, maintainable, scalable.
