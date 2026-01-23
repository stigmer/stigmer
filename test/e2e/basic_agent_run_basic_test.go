//go:build e2e
// +build e2e

package e2e

// TestRunBasicAgent tests the complete agent execution workflow:
// 1. Apply a basic agent (from SDK example 01_basic_agent.go)
// 2. Execute 'stigmer run' command
// 3. Wait for execution to complete
// 4. Verify execution completed successfully
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestRunBasicAgent() {
	s.T().Logf("=== Testing Basic Agent Run (from SDK example 01_basic_agent.go) ===")

	// STEP 1: Apply agents from SDK example
	s.T().Logf("Step 1: Applying agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Agent deployed with ID: %s", applyResult.BasicAgent.Metadata.Id)

	// STEP 2: Run the basic agent by name
	s.T().Logf("Step 2: Running agent and creating execution...")
	runResult := RunAgentByName(s.T(), s.Harness.ServerPort, BasicAgentName, BasicAgentTestMessage)

	// STEP 3: Verify run command output
	VerifyRunOutputSuccess(s.T(), runResult.Output, BasicAgentName)

	// STEP 4: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete...")
	execution := WaitForAgentExecutionCompletion(s.T(), s.Harness.ServerPort, runResult.ExecutionID, AgentExecutionTimeoutSeconds)

	// STEP 5: Verify execution completed successfully
	s.T().Logf("Step 4: Verifying execution completed successfully...")
	VerifyAgentExecutionCompleted(s.T(), execution)

	// STEP 6: Summary
	s.T().Logf("✅ Test Passed!")
	s.T().Logf("   Agent ID: %s", applyResult.BasicAgent.Metadata.Id)
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final phase: %s", execution.Status.Phase)
}
