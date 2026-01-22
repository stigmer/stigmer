# E2E Integration Tests

End-to-end tests for Stigmer CLI and server using real infrastructure.

## Running Tests

```bash
# Start stigmer server first
stigmer server

# Run all E2E tests
cd test/e2e
go test -tags=e2e -v

# Run specific test
go test -tags=e2e -v -run TestApplyBasicAgent
```

## Test Organization

Tests are organized by SDK example for easy discovery:

```
test/e2e/
├── basic_agent_apply_test.go    # Tests for stigmer apply (basic agent)
├── basic_agent_run_test.go      # Tests for stigmer run (basic agent)
├── e2e_run_test.go               # Generic run tests
├── e2e_run_full_test.go          # Full execution tests (Phase 2)
├── suite_test.go                 # Test suite setup
├── harness_test.go               # Test harness (isolated servers)
├── stigmer_server_manager_test.go # Server manager (production mode)
├── prereqs_test.go               # Prerequisites checking
├── helpers_test.go               # Helper functions
├── cli_runner_test.go            # CLI execution
├── sdk_fixtures_test.go          # SDK example copying
├── validation_test.go            # Execution validation
└── testdata/                     # Test fixtures (not test code)
    └── agents/
        └── basic-agent/
            ├── main.go           # Copied from SDK example
            └── Stigmer.yaml
```

## Prerequisites

**Required:**
- Stigmer server running (`stigmer server`)
- Ollama running with model installed

**Check status:**
```bash
stigmer server status
curl http://localhost:11434/api/version
```

## Test Phases

**Phase 1: Deployment Tests**
- Verify `stigmer apply` deploys agents/workflows
- Check resources are stored correctly
- Validate dry-run mode

**Phase 2: Execution Creation Tests**
- Verify `stigmer run` creates execution records
- Check execution metadata

**Phase 3: Full Execution Tests**
- Wait for actual LLM execution
- Validate execution results
- Requires full server stack (Temporal, runners)

## Documentation

See `docs/` for detailed documentation:
- `test-organization.md` - How tests are structured
- More docs as needed

## Adding Tests for New Examples

1. Add to `sdk_fixtures_test.go` copy mapping
2. Create testdata directory with `Stigmer.yaml`
3. Create test file: `{example_name}_apply_test.go`
4. Tests automatically use latest SDK code

Example:
```go
// agent_with_skills_apply_test.go
func (s *E2ESuite) TestApplyAgentWithSkills() {
    testdataDir := filepath.Join("testdata", "agents", "agent-with-skills")
    // ... test implementation
}
```
