# Basic Agent Test Fixture

This directory contains the test fixture for basic agent functionality, copied from the SDK example.

## 🔄 Automatic Synchronization

**IMPORTANT**: The `main.go` file in this directory is **automatically copied** from `sdk/go/examples/01_basic_agent.go` before each test run.

### Why?

- **Single Source of Truth**: SDK examples are what we promise users. Tests validate those exact examples.
- **Consistency**: No drift between what we document and what we test.
- **Confidence**: If tests pass, we know SDK examples actually work.

### How It Works

1. Before tests run, `CopyAllSDKExamples()` is called in `SetupSuite()` (see `test/e2e/sdk_fixtures_test.go`)
2. SDK example file is copied:
   ```
   sdk/go/examples/01_basic_agent.go → testdata/examples/01-basic-agent/main.go
   ```
3. Tests run against the copied file
4. `Stigmer.yaml` is maintained manually (it's just configuration)

**⚠️ DO NOT manually edit `main.go` - it will be overwritten on the next test run!**

## Files

### main.go (Auto-copied)
- **Source**: `sdk/go/examples/01_basic_agent.go`
- **Purpose**: Demonstrates basic agent creation using the Stigmer SDK
- **Agents Created**:
  - `code-reviewer`: Basic agent with required fields only
  - `code-reviewer-pro`: Full agent with optional fields (description, iconURL, org)

### Stigmer.yaml (Manually maintained)
```yaml
name: basic-agent-test
runtime: go
main: main.go
version: 0.1.0
description: Basic agent test for E2E testing
```

This configuration tells the Stigmer CLI:
- Where to find the entry point (`main.go`)
- What runtime to use (`go`)
- Project metadata (name, version, description)

## Test Coverage

This fixture is used by multiple E2E tests:

### Apply Tests (`basic_agent_apply_test.go`)
- `TestApplyBasicAgent`: Tests full apply workflow and agent deployment
- `TestApplyAgentCount`: Verifies exactly 2 agents are created
- `TestApplyDryRun`: Tests dry-run mode (no actual deployment)

### Run Tests (`basic_agent_run_test.go`)
- `TestRunBasicAgent`: Tests agent execution creation
- `TestRunFullAgent`: Tests agent with optional fields
- `TestRunWithAutoDiscovery`: Tests auto-discovery mode

### Full Execution Tests (`e2e_run_full_test.go`)
- `TestRunWithFullExecution`: Tests complete execution lifecycle
- `TestRunWithInvalidMessage`: Tests error handling
- `TestRunWithSpecificBehavior`: Tests behavioral validation

## Running This Test

### Apply the Agent
```bash
cd test/e2e
stigmer apply --config testdata/examples/01-basic-agent/Stigmer.yaml
```

### Run E2E Tests
```bash
cd test/e2e
go test -v -tags=e2e -run TestBasicAgent
```

### Run Specific Test
```bash
go test -v -tags=e2e -run TestApplyBasicAgent
```

## What Gets Validated

- ✅ Agent creation and synthesis
- ✅ Agent metadata (name, description, instructions)
- ✅ Optional fields (iconURL, org)
- ✅ Agent deployment via apply workflow
- ✅ Agent retrieval via gRPC API
- ✅ Execution creation and tracking
- ✅ Full execution lifecycle (with Temporal)
- ✅ Validation-first deployment

## Expected Behavior

When applying this fixture:
1. Two agents are created: `code-reviewer` and `code-reviewer-pro`
2. Both agents have proper instructions and metadata
3. `code-reviewer-pro` includes optional fields (description, iconURL, org)
4. Both agents can be queried via the API
5. Both agents can be executed successfully

## See Also

- [sdk/go/examples/01_basic_agent.go](../../../../sdk/go/examples/01_basic_agent.go) - Source SDK example
- [test/e2e/sdk_fixtures_test.go](../../sdk_fixtures_test.go) - Copy mechanism
- [testdata/README.md](../README.md) - Overview of test fixtures
