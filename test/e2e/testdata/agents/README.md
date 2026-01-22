# Agent E2E Test Fixtures

This directory contains agent test fixtures for end-to-end testing of the Stigmer agent system.

## 🔄 SDK Example Synchronization

**IMPORTANT**: The `main.go` files in this directory are **automatically copied** from `sdk/go/examples/` before each test run.

### Why?

- **Single Source of Truth**: SDK examples are what we promise users. Tests validate those exact examples.
- **Consistency**: No drift between what we document and what we test.
- **Confidence**: If tests pass, we know SDK examples actually work.

### How It Works

1. Before tests run, `CopyAllSDKExamples()` is called in `SetupSuite()`
2. SDK example files are copied to testdata directories:
   - `sdk/go/examples/01_basic_agent.go` → `testdata/agents/basic-agent/main.go`
3. Tests run against these copied files
4. `Stigmer.yaml` files are maintained manually (they're just config, not code)

**⚠️ DO NOT manually edit `main.go` files in this directory - they will be overwritten!**

## Directory Structure

Each test case has its own folder with:
- `main.go` - **COPIED FROM SDK** (do not edit manually)
- `Stigmer.yaml` - Configuration file that specifies the entry point (edit manually)

```
agents/
└── basic-agent/
    ├── main.go         # Copied from sdk/go/examples/01_basic_agent.go
    └── Stigmer.yaml    # Maintained manually
```

## Test Coverage

### 1. basic-agent/
**Tests**: Basic agent creation and configuration

**What it validates**:
- Agent definition and synthesis
- Basic agent metadata (name, description, instructions)
- Agent deployment through apply workflow

**Expected behavior**:
- Agents are created with names "code-reviewer" and "code-reviewer-pro" (from SDK example)
- Instructions are properly set
- Agents can be applied and retrieved

## Running Tests

### Apply Agent
```bash
stigmer apply --config testdata/agents/basic-agent/Stigmer.yaml
```

### Run E2E Tests
```bash
cd test/e2e
go test -v -tags=e2e -run TestAgentApply
```

## Future Test Scenarios

### Additional agent configurations to test:
- Agents with custom skills
- Agents with environment variables
- Agents with sub-agents
- Agents with different model providers
- Agents with tool integrations

## Adding New Test Cases

To add a new agent test case:

1. **Create SDK example** in `sdk/go/examples/` (e.g., `02_agent_with_skills.go`)
2. **Add to copy list** in `test/e2e/sdk_fixtures_test.go`:
   ```go
   {
       SDKFileName:    "02_agent_with_skills.go",
       TestDataDir:    "agents/agent-with-skills",
       TargetFileName: "main.go",
   },
   ```
3. **Create Stigmer.yaml** in `testdata/agents/agent-with-skills/Stigmer.yaml`:
   ```yaml
   name: agent-with-skills-test
   runtime: go
   main: main.go
   version: 0.1.0
   description: Agent with skills test
   ```
4. **Write test** in `test/e2e/e2e_run_full_test.go`

**Remember**: The `main.go` will be copied automatically, don't create it manually!

## Notes

- All agent fixtures use `//go:build ignore` to prevent inclusion in main build
- Each test case has its own folder with `Stigmer.yaml` pointing to `main.go`
- **main.go files are copied from SDK examples** - do not edit them in testdata!
- Follows the same pattern as workflow test fixtures for consistency
