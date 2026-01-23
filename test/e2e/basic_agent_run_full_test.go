//go:build e2e
// +build e2e

package e2e

// TestRunFullAgent tests the complete execution workflow for agents with optional fields
// This verifies that agents with description, iconURL, and org execute correctly
//
// Example: sdk/go/examples/01_basic_agent.go (code-reviewer-pro agent)
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestRunFullAgent() {
	s.T().Logf("=== Testing Full Agent Run (agent with optional fields) ===")

	// STEP 1: Apply agents (both code-reviewer and code-reviewer-pro)
	s.T().Logf("Step 1: Applying agents...")
	applyResult := ApplyBasicAgents(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ %s agent deployed with ID: %s", FullAgentName, applyResult.FullAgent.Metadata.Id)

	// STEP 2: Verify optional fields are present
	VerifyFullAgentOptionalFields(s.T(), applyResult.FullAgent)
	s.T().Logf("✓ Verified optional fields on %s agent", FullAgentName)

	// STEP 3: Run the full agent by name
	s.T().Logf("Step 2: Running %s agent and creating execution...", FullAgentName)
	runResult := RunAgentByName(s.T(), s.Harness.ServerPort, FullAgentName, FullAgentTestMessage)

	// STEP 4: Verify run command output
	VerifyRunOutputSuccess(s.T(), runResult.Output, FullAgentName)

	// STEP 5: Wait for execution to complete
	s.T().Logf("Step 3: Waiting for execution to complete...")
	execution := WaitForAgentExecutionCompletion(s.T(), s.Harness.ServerPort, runResult.ExecutionID, AgentExecutionTimeoutSeconds)

	// STEP 6: Verify execution completed successfully
	s.T().Logf("Step 4: Verifying execution completed successfully...")
	VerifyAgentExecutionCompleted(s.T(), execution)

	// STEP 7: Summary
	s.T().Logf("✅ Full Agent Run Test Passed!")
	s.T().Logf("   Agent ID: %s", applyResult.FullAgent.Metadata.Id)
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final phase: %s", execution.Status.Phase)
	s.T().Logf("   Verified: Agent with optional fields (description, iconURL, org) executes successfully")
}
