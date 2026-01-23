# Task 1: Research and Framework Selection

**Status**: ✅ Research Complete → 🟢 Ready for POC  
**Created**: 2026-01-22  
**Updated**: 2026-01-22  
**Estimated Duration**: 1-2 days

## Objective

Research integration testing frameworks and patterns, then design the test architecture for Stigmer's end-to-end integration tests.

## Context

We need to build integration tests that validate the entire Stigmer stack:
- User SDK code → CLI commands → Backend services → Database → Execution → Streaming output

Currently, we only have SDK unit tests. We need to test the full user journey.

## Approach

### Phase 1: Research (Use Gemini)

Submit `gemini-context-document.md` to Gemini for comprehensive research on:

1. **Testing frameworks**
   - Standard Go testing vs testify vs ginkgo
   - Pros/cons for integration testing
   - Industry best practices

2. **Test architecture patterns**
   - Service lifecycle management
   - Process management
   - Test environment isolation

3. **Database testing strategies**
   - State isolation between tests
   - Cleanup patterns
   - Verification approaches

4. **Async/streaming testing**
   - Temporal workflow testing
   - gRPC streaming verification
   - Timeout handling

5. **Real-world examples**
   - Temporal SDK tests
   - Pulumi tests
   - Kubernetes e2e tests
   - Other relevant projects

### Phase 2: Framework Selection

Based on Gemini's research, make decisions on:

1. **Testing framework**: `testing` vs `testify` vs `ginkgo`
2. **Process management**: Direct exec vs Docker Compose vs Testcontainers
3. **Database strategy**: Clean slate vs namespacing vs in-memory
4. **Test organization**: File structure, naming conventions

### Phase 3: Design Test Architecture

Create design document covering:

1. **Test environment setup**
   ```
   - How to start services
   - How to wait for readiness
   - How to configure for testing
   - How to capture logs
   ```

2. **Test structure**
   ```go
   // Example test structure
   func TestApplyBasicAgent(t *testing.T) {
       // Setup: Ensure services running
       // Given: Test project with SDK code
       // When: Execute stigmer apply
       // Then: Verify success, DB state, output
       // Cleanup: Remove test data
   }
   ```

3. **Helper utilities**
   ```
   - runCLI(command, args...)
   - verifyDBState(query)
   - waitForExecution(id, timeout)
   - captureStream(id)
   ```

4. **Test data management**
   ```
   - Location: testdata/
   - SDK examples as test cases
   - Expected outputs (golden files?)
   ```

### Phase 4: Create POC Test

Implement one complete test as proof-of-concept:

```go
// integration_test.go
func TestApplyAndRunBasicAgent(t *testing.T) {
    // This POC test should:
    // 1. Start local services (if not running)
    // 2. Create test project with basic agent
    // 3. Run stigmer apply
    // 4. Verify agent in database
    // 5. Run stigmer run
    // 6. Verify execution completes
    // 7. Verify streaming output
    // 8. Cleanup
}
```

## Deliverables

1. ✅ **Research summary** (from Gemini)
   - Framework recommendation with rationale
   - Architecture pattern recommendation
   - Code examples and references

2. ✅ **Design document** (`design-decisions/test-architecture.md`)
   - Chosen frameworks and tools
   - Test architecture diagram
   - Test lifecycle (setup/teardown)
   - Helper utilities design

3. ✅ **POC test** (`integration_test.go`)
   - One working end-to-end test
   - Demonstrates all key patterns
   - Validates approach works

4. ✅ **Coding guidelines** (`coding-guidelines/integration-testing.md`)
   - Test naming conventions
   - Test structure patterns
   - Best practices
   - Common pitfalls to avoid

## Success Criteria

- [x] Gemini research completed and documented ✅
- [x] Testing framework selected and justified ✅ (`testify/suite` + `testcontainers-go`)
- [x] Test architecture designed and documented ✅ ("Ephemeral Harness" pattern)
- [ ] POC test implemented and passing 🟡 NEXT
- [ ] Developer reviewed and approved approach

## Dependencies

- Gemini access for research
- Local Stigmer development environment
- All services runnable locally

## Risks

1. **Framework choice might not fit our needs**
   - Mitigation: POC test validates approach

2. **Test environment too complex to set up**
   - Mitigation: Research existing patterns, keep it simple

3. **Tests might be too slow or flaky**
   - Mitigation: Design for speed and reliability from start

## Notes

- Focus on **simplicity** - don't over-engineer
- Prioritize **reliability** over speed initially
- Look at **real-world examples** from similar projects
- The test framework should make adding new tests **easy**

## Completed Work

### ✅ Phase 1: Research (COMPLETE)

Submitted `gemini-context-document.md` to Gemini and received comprehensive recommendations:

- **Framework Choice**: `testify/suite` + `testcontainers-go`
- **Architecture Pattern**: "Ephemeral Harness" - tests spawn services as child processes
- **Database Isolation**: Directory-based with temp directories
- **CLI Testing**: Grey-box in-process execution

**Artifacts Created**:
- `gemini-response.md` - Full Gemini analysis
- `research-summary.md` - Structured summary with implementation details

### ✅ Phase 2: Framework Selection (COMPLETE)

**Decisions Made**:
1. **Testing Framework**: `testify/suite` ✅
   - Lifecycle hooks for setup/teardown
   - Industry standard, used by Temporal
   - Low learning curve

2. **Process Management**: Direct `os/exec` spawning ✅
   - No Docker Compose overhead
   - Full control from Go tests
   - Easy debugging

3. **Database Strategy**: Fresh temp directory per test ✅
   - 100% isolation
   - Simple and reliable
   - Fast cleanup

4. **Test Organization**: `test/e2e/` structure ✅
   - Separate from unit tests
   - Clear file naming
   - Testdata fixtures

### 🟢 Phase 3: Design Test Architecture (READY)

Complete design documented in `research-summary.md`:
- Component architecture with Mermaid diagrams
- Test lifecycle patterns
- Helper utilities specification
- Process management strategies
- CI/CD integration approach

### 🎯 Phase 4: Create POC Test (NEXT)

See `next-task.md` for detailed implementation plan.

**Implementation Steps**:
1. Create `test/e2e/` directory structure
2. Implement helper utilities (`helpers_test.go`)
3. Implement process harness (`harness_test.go`)
4. Implement test suite (`suite_test.go`)
5. Implement CLI runner (`cli_runner_test.go`)
6. Create test fixture (`testdata/basic_agent.go`)
7. Write first test (`e2e_apply_test.go`)

## Next Steps

1. **Begin POC Implementation** (see `next-task.md`)
2. Validate approach with working test
3. Review with team
4. Expand test coverage
5. Move to Task 2: Full test suite implementation
