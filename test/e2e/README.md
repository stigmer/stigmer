# E2E Integration Tests

End-to-end integration tests for Stigmer CLI and server using real infrastructure.

**Status**: ✅ Phase 1 Complete (Deployment + Execution Creation Tests)  
**Coverage**: Agents (6 tests), Workflows (9 tests), Validation Framework

---

## Quick Start

### Running Tests

```bash
# Start stigmer server first
stigmer server

# Run all E2E tests
cd test/e2e
go test -tags=e2e -v -timeout 120s

# Run specific test
go test -tags=e2e -v -run TestApplyBasicAgent

# Run agent tests only
go test -tags=e2e -v -run "TestApply.*Agent|TestRun.*Agent"

# Run workflow tests only
go test -tags=e2e -v -run "TestApply.*Workflow|TestRun.*Workflow"
```

### Prerequisites

**Required:**
- **Stigmer server** running (`stigmer server`)
  - Tests connect to the existing server (default port 8234)
  - Uses the same database as manual development (`~/.stigmer/stigmer.db`)
- **Ollama** running with model installed (for Phase 2 execution tests)

**Check status:**
```bash
# Check server
stigmer server status

# Check Ollama
curl http://localhost:11434/api/version
```

**Important**: Tests will modify your local database. You may want to back up `~/.stigmer/stigmer.db` before running tests.

---

## Test Structure

### Test Files

Tests are organized by resource type and operation:

```
test/e2e/
├── suite_test.go                    # Test suite setup (testify/suite)
├── harness_test.go                  # Test harness (isolated servers)
├── helpers_test.go                  # Helper functions (API queries)
│
├── basic_agent_apply_test.go       # Agent deployment tests (3 tests)
├── basic_agent_run_test.go         # Agent execution tests (3 tests)
├── basic_workflow_apply_test.go    # Workflow deployment tests (5 tests)
├── basic_workflow_run_test.go      # Workflow execution tests (4 tests)
│
├── e2e_run_test.go                  # Generic run tests
├── e2e_run_full_test.go             # Full execution tests (Phase 2)
│
├── cli_runner_test.go               # CLI command execution
├── prereqs_test.go                  # Prerequisites checking
├── validation_test.go               # Validation framework
├── sdk_fixtures_test.go             # SDK example synchronization
└── stigmer_server_manager_test.go   # Server lifecycle management
```

### Test Fixtures

Test fixtures are automatically synced from SDK examples:

```
test/e2e/testdata/examples/
├── 01-basic-agent/                 # Basic agent (2 agents)
├── 02-agent-with-skills/           # Agent with skills
├── 07-basic-workflow/              # Basic workflow (HTTP GET + SET)
├── 08-workflow-with-conditionals/  # Conditional workflow
└── ... (19 SDK examples total)
```

See [SDK Sync Strategy](docs/guides/sdk-sync-strategy.md) for how these are maintained.

---

## Test Database Approach

**Simplified for MVP**: E2E tests use the **same local daemon** as manual development.

### Single Daemon Approach

✅ **Simple** - One server instance for everything  
✅ **Fast** - No server startup/teardown per test  
✅ **Practical** - Matches real development workflow  
✅ **Debuggable** - Same database you inspect manually  

### Database Location

All tests use the same database as your manual development:

```
~/.stigmer/stigmer.db  (or custom path via DB_PATH env var)
```

**Note**: Tests may modify this database. You may need to clean up test data periodically.

---

## Test Coverage

### Current Coverage (Phase 1)

| Resource Type | Apply Tests | Run Tests | Total | Status |
|--------------|-------------|-----------|-------|--------|
| Basic Agent | 3 | 3 | 6 | ✅ 100% |
| Basic Workflow | 5 | 4 | 9 | ✅ 100% |
| **Total** | **8** | **7** | **15** | ✅ |

### What's Tested

**Agent Tests**:
- ✅ Deployment (apply command)
- ✅ Agent count verification
- ✅ Dry-run mode
- ✅ Optional fields (description, iconURL, org)
- ✅ Execution creation (run command)
- ✅ Error handling

**Workflow Tests**:
- ✅ Deployment (apply command)
- ✅ Workflow count verification
- ✅ Dry-run mode
- ✅ Context variables
- ✅ Task dependencies
- ✅ Environment variables
- ✅ Execution creation (run command)
- ✅ Execution phases
- ✅ Error handling

---

## Test Phases

### Phase 1: Deployment + Execution Creation ✅

**What's tested:**
- `stigmer apply` deploys resources correctly
- Resources stored in database with correct properties
- Dry-run mode works (validation without deployment)
- `stigmer run` creates execution records
- Execution metadata is correct

**Requirements:**
- Stigmer server running
- No Temporal required
- Fast (< 2 seconds per test)

### Phase 2: Full Execution ⏳

**What will be tested:**
- Actual agent/workflow execution
- Phase progression (PENDING → RUNNING → COMPLETED)
- Execution outputs and results
- Log streaming
- Error handling during execution

**Requirements:**
- Temporal server
- Agent/workflow runners
- Ollama with model
- Longer execution time (~30 seconds per test)

---

## Documentation

📚 **[Complete Documentation](docs/README.md)** - Comprehensive documentation index

### Quick Links

**Getting Started:**
- [File Guide](docs/getting-started/file-guide.md) - What each test file does
- [Test Organization](docs/getting-started/test-organization.md) - How tests are structured

**Guides:**
- [SDK Sync Strategy](docs/guides/sdk-sync-strategy.md) - How SDK examples are synced
- [Phase 2 Guide](docs/guides/phase-2-guide.md) - Implementing full execution tests
- [Validation Framework](docs/guides/validation-framework.md) - Validating execution outputs

**Implementation:**
- [Basic Workflow Tests](docs/implementation/basic-workflow-tests.md) - Workflow test coverage
- [Flakiness Fix](docs/implementation/flakiness-fix-2026-01-23.md) - Test robustness improvements
- [Test Coverage Enhancement](docs/implementation/test-coverage-enhancement-2026-01-23.md) - Agent test improvements

---

## Tools

### Test Utilities

```
test/e2e/tools/
└── run-flakiness-test.sh    # Script to detect flaky tests
```

**Run flakiness test:**
```bash
cd test/e2e
./tools/run-flakiness-test.sh
```

This runs tests multiple times to detect intermittent failures.

---

## Adding Tests for New SDK Examples

### Step-by-Step

1. **Add to SDK sync mapping** (`sdk_fixtures_test.go`):
   ```go
   {
       sdkFile:  "06_agent_with_instructions_from_files.go",
       testDir:  "06-agent-with-instructions-from-files",
       category: "examples",
   },
   ```

2. **Create test file**: `{resource}_apply_test.go` and `{resource}_run_test.go`

3. **Follow established patterns**:
   - Query by slug (not CLI parsing)
   - Comprehensive property verification
   - Clear test phases with logging

4. **Tests automatically use latest SDK code** (no manual copying needed)

### Example Test

```go
// agent_with_skills_apply_test.go
func (s *E2ESuite) TestApplyAgentWithSkills() {
    testdataDir := filepath.Join("testdata", "examples", "02-agent-with-skills")
    absTestdataDir, err := filepath.Abs(testdataDir)
    s.Require().NoError(err)

    output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
    s.Require().NoError(err, "Apply command should succeed")

    // Query by slug (preferred over CLI parsing)
    org := "local"
    agent, err := GetAgentBySlug(s.Harness.ServerPort, "skilled-agent", org)
    s.Require().NoError(err)
    s.Require().NotNil(agent)
    
    // Verify properties
    s.Equal("skilled-agent", agent.Metadata.Name)
    s.NotEmpty(agent.Spec.Skills)
}
```

---

## Best Practices

### Test Patterns

✅ **DO**:
- Query by slug via API (robust, direct verification)
- Use comprehensive property verification
- Follow Phase 1/Phase 2 distinction
- Include clear logging with `s.T().Logf()`
- Test error handling

❌ **DON'T**:
- Parse CLI output for IDs (fragile)
- Access database directly (use API)
- Mix Phase 1 and Phase 2 concerns
- Create manual test fixtures (sync from SDK)

### Documentation

When adding new tests:
1. Update [File Guide](docs/getting-started/file-guide.md)
2. Document patterns in implementation docs
3. Link to related SDK examples
4. Follow [Documentation Standards](../../.cursor/rules/stigmer-oss-documentation-standards.md)

---

## Troubleshooting

### Common Issues

**Tests fail with "connection refused"**:
- Ensure `stigmer server` is running
- Check server port (default: random free port in tests)

**SDK example not found**:
- Run `go test` which auto-copies SDK examples
- Check `sdk_fixtures_test.go` mapping

**Test timeout**:
- Increase timeout: `go test -timeout 180s`
- Check for deadlocks in server

### Getting Help

- Check [troubleshooting section](docs/guides/phase-2-guide.md#troubleshooting) in guides
- Review test logs for detailed error messages
- See [flakiness fix](docs/implementation/flakiness-fix-2026-01-23.md) for recent improvements

---

## Related Documentation

- **[SDK Examples](../../sdk/go/examples/)** - Source examples that tests verify
- **[Stigmer Server](../../backend/services/stigmer-server/)** - Server being tested
- **[E2E Project](../../_projects/2026-01/20260122.05.e2e-integration-testing/)** - Project tracking

---

**Status**: ✅ **Phase 1 Complete** - Deployment and execution creation tests working!  
**Next**: Phase 2 full execution tests (requires Temporal integration)
