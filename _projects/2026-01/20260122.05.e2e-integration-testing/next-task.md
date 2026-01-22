# Next Task: Iteration 5 - Expand Test Coverage

**Project**: E2E Integration Testing Framework  
**Location**: `_projects/2026-01/20260122.05.e2e-integration-testing/`  
**Current Status**: ✅ Iteration 4 Complete - Ready for Iteration 5  
**Updated**: 2026-01-22

---

## 🎉 Iteration 4 Complete! ALL TESTS PASS!

```bash
$ go test -v -timeout 60s
--- PASS: TestE2E (8.17s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.29s)
    --- PASS: TestE2E/TestApplyDryRun (1.26s)
    --- PASS: TestE2E/TestServerStarts (5.62s)
PASS
ok      github.com/stigmer/stigmer/test/e2e     8.991s
```

**See**: `checkpoints/04-iteration-4-full-integration-complete.md` for full details

---

## ✅ What's Working Now

- ✅ **Isolated Test Environment**: Each test gets fresh temp dir + random port
- ✅ **Server Lifecycle**: Start/stop gracefully in ~1.5 seconds
- ✅ **CLI Integration**: Execute commands with proper server address override
- ✅ **Agent Deployment**: Deploy agents from Go code and verify via API
- ✅ **Dry-Run Mode**: Test validation without actual deployment
- ✅ **Clean Architecture**: Testify suite + harness pattern + API verification

---

## 🎯 Next: Iteration 5 - Expand Test Coverage

Now that the foundation is solid, we can add more test scenarios:

### Priority 1: More Agent Scenarios

1. **TestApplyAgentWithSkills**
   - Agent that references skills
   - Verify both agent and skills are deployed
   - Query via API to confirm relationship

2. **TestApplyAgentWithSubagents**
   - Agent with subagents
   - Verify hierarchical structure
   - Test agent references

3. **TestApplyAgentWithMcpServers**
   - Agent with MCP server configurations
   - Verify server configuration stored
   - Check different MCP server types (stdio, http, docker)

### Priority 2: Error Cases

4. **TestApplyInvalidYaml**
   - Malformed Stigmer.yaml
   - Verify proper error messages
   - No partial deployments

5. **TestApplyInvalidGoCode**
   - Go code that doesn't compile
   - Runtime errors in synthesis
   - Proper error propagation

6. **TestApplyMissingDependencies**
   - Invalid imports
   - Missing replace directives
   - Dependency resolution failures

### Priority 3: Workflow Testing

7. **TestApplyBasicWorkflow**
   - Simple workflow deployment
   - Verify workflow stored
   - Query workflow via API

8. **TestApplyWorkflowWithTasks**
   - Workflow with multiple tasks
   - Verify task structure
   - Check workflow validation

### Priority 4: Update/Delete Operations

9. **TestUpdateExistingAgent**
   - Deploy agent
   - Modify and redeploy
   - Verify updates applied

10. **TestDeleteAgent**
    - Deploy agent
    - Delete via CLI (when implemented)
    - Verify removal

---

## 📋 Implementation Plan for Iteration 5

### Step 1: Add Test Fixtures

Create additional test fixtures in `test/e2e/testdata/`:

```
testdata/
├── Stigmer.yaml              (existing)
├── basic_agent.go            (existing)
├── agent_with_skills.go      (new)
├── agent_with_subagents.go   (new)
├── agent_with_mcp.go         (new)
├── basic_workflow.go         (new)
└── invalid/
    ├── malformed.yaml        (new)
    └── bad_syntax.go         (new)
```

### Step 2: Create Test File

Create `test/e2e/e2e_agent_scenarios_test.go`:

```go
package e2e

func (s *E2ESuite) TestApplyAgentWithSkills() {
    // Similar structure to TestApplyBasicAgent
    // but with agent_with_skills.go fixture
}

func (s *E2ESuite) TestApplyAgentWithSubagents() {
    // ...
}

// etc.
```

### Step 3: Update Stigmer.yaml for Each Test

Each test should have its own Stigmer.yaml or specify which entry point to use.

**Option A**: Multiple Stigmer.yaml files
```
testdata/
├── basic_agent/
│   ├── Stigmer.yaml
│   └── main.go
├── agent_with_skills/
│   ├── Stigmer.yaml
│   └── main.go
```

**Option B**: Single Stigmer.yaml with different main files
```yaml
# Just change which file the test points to
main: agent_with_skills.go
```

**Recommendation**: Start with Option B for simplicity

### Step 4: Add Error Case Tests

Create `test/e2e/e2e_error_cases_test.go`:

```go
func (s *E2ESuite) TestApplyInvalidYaml() {
    output, err := RunCLIWithServerAddr(
        s.Harness.ServerPort,
        "apply",
        "--config", "testdata/invalid/malformed.yaml",
    )
    
    // Should fail with clear error message
    s.Error(err)
    s.Contains(output, "failed to parse Stigmer.yaml")
}
```

---

## 🎓 Lessons from Iteration 4

### What Went Well

1. **Systematic Debugging**
   - Fixed CLI error printing first
   - Resolved dependency issues methodically
   - Each fix brought us closer to passing tests

2. **Good Architecture Decisions**
   - Environment variable for server address (clean, simple)
   - API verification instead of database access (proper integration testing)
   - Replace directives in go.mod (standard Go practice)

3. **Documentation**
   - Checkpoint documents capture knowledge
   - Easy to understand what changed and why

### What to Keep Doing

1. **One Issue at a Time**
   - Don't try to fix everything at once
   - Verify each fix before moving to next

2. **Test the Tests**
   - Run manually to understand failures
   - Use logging liberally during development

3. **Document Decisions**
   - Why we chose API verification over DB access
   - Why we use env vars instead of flags
   - These decisions help future maintainers

---

## 🚧 Known Limitations

### Current Constraints

1. **No Temporal Integration Yet**
   - Workflows won't execute (need Temporal server)
   - Acceptable for now (server logs warning)
   - Future iteration: Start Temporal in harness

2. **Single Test at a Time**
   - Tests run serially (testify default)
   - Good for now (faster than parallel anyway)
   - Can optimize later with `t.Parallel()`

3. **No Performance Benchmarks**
   - We know tests are fast (~9 seconds)
   - Don't have systematic benchmarks yet
   - Add `_test.go` with benchmarks later

### Technical Debt

1. **Server Exit Code**
   - Server exits with status 1 (should be 0)
   - Doesn't affect tests but should fix
   - Check shutdown signal handling

2. **Error Extraction**
   - Parsing CLI output for agent ID (fragile)
   - Should have structured output option
   - Add `--output json` flag to CLI

3. **Test Fixtures Organization**
   - All in one directory (will get messy)
   - Should organize by type/scenario
   - Refactor in Iteration 6

---

## 📊 Success Metrics

### Current Performance

- **Test Suite Runtime**: 8.9 seconds (3 tests)
- **Server Startup**: ~1 second
- **Server Shutdown**: ~0.6 seconds
- **Per-Test Overhead**: ~1.3 seconds
- **Test Isolation**: 100% (fresh env each time)

### Goals for Iteration 5

- **Test Count**: 10+ tests (currently 3)
- **Test Suite Runtime**: < 30 seconds (acceptable for local dev)
- **Coverage**: Agent scenarios + error cases + basic workflow
- **Reliability**: 100% pass rate (no flaky tests)

---

## 🎯 Quick Start Commands

```bash
# Run all E2E tests
cd test/e2e && go test -v -timeout 60s

# Run specific test
go test -v -run TestE2E/TestApplyBasicAgent

# Run with race detection
go test -v -race -timeout 60s

# Run and save output
go test -v 2>&1 | tee test-output.txt
```

---

## 🔗 Reference Documents

### Completed Iterations
- [Iteration 1 - Minimal POC](checkpoints/01-iteration-1-complete.md)
- [Iteration 2 - Database & CLI Infrastructure](checkpoints/02-iteration-2-infrastructure-complete.md)
- [Iteration 3 - Suite Hanging Fixed](checkpoints/03-iteration-3-suite-hanging-fixed.md)
- [Iteration 4 - Full Integration](checkpoints/04-iteration-4-full-integration-complete.md)

### Research & Planning
- [Research Summary](research-summary.md) - Gemini recommendations
- [Gemini Response](gemini-response.md) - Full analysis
- [Task Planning](tasks/T01_0_plan.md) - Original plan

### Test Documentation
- [Test README](../../test/e2e/README.md) - How to run tests

---

## ❓ Questions Before Starting Iteration 5

1. **Which scenarios to prioritize?**
   - Agent scenarios? Error cases? Workflows?
   - User preference?

2. **Temporal integration?**
   - Add in Iteration 5 or wait?
   - Required for workflow execution tests

3. **Test organization?**
   - Keep adding to existing files or split by category?
   - One file per feature area?

4. **CI/CD integration?**
   - Add GitHub Actions workflow now or later?
   - Need to ensure tests run on push

---

**Status**: 🟢 Foundation Complete - Ready for Test Expansion  
**Next Action**: Choose scenarios for Iteration 5 and implement  
**Estimated Time**: 2-4 hours for 5-7 new tests  
**Confidence**: HIGH - Foundation is solid, adding tests is straightforward

---

**Ready to proceed with Iteration 5! What scenarios should we prioritize?**
