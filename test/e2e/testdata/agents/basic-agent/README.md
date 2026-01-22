# Basic Agent E2E Tests

This directory contains the basic agent example code and its E2E tests.

## Files

- `main.go` - Agent code (automatically copied from `sdk/go/examples/01_basic_agent.go` during test setup)
- `Stigmer.yaml` - Agent configuration
- `apply_test.go` - Tests for `stigmer apply` command
- `run_test.go` - Tests for `stigmer run` command

## Running Tests

From the e2e directory:

```bash
cd test/e2e

# Run all tests (includes these)
go test -tags=e2e -v

# Run just apply tests
go test -tags=e2e -v -run TestApplyBasicAgent

# Run just run tests
go test -tags=e2e -v -run TestRunBasicAgent
```

## Test Organization

Tests are co-located with the agent code they test for easy discovery and maintenance.
