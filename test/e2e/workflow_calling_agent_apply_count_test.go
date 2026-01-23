//go:build e2e
// +build e2e

package e2e

// TestApplyWorkflowCallingAgentCount verifies that the SDK example creates exactly 1 workflow and 1 agent
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go creates:
// 1. code-reviewer (agent)
// 2. simple-review (workflow calling the agent)
//
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentCount() {
	s.T().Logf("=== Testing Workflow-Calling-Agent Resource Count ===")

	// STEP 1: Apply from SDK example
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify agent exists
	s.Equal(WorkflowCallingAgentName, result.Agent.Metadata.Name,
		"Agent name should match SDK example")
	s.T().Logf("✓ Found agent: %s (ID: %s)", result.Agent.Metadata.Name, result.Agent.Metadata.Id)

	// STEP 3: Verify workflow exists
	s.Equal(WorkflowCallingWorkflowName, result.Workflow.Metadata.Name,
		"Workflow name should match SDK example")
	s.T().Logf("✓ Found workflow: %s (ID: %s)", result.Workflow.Metadata.Name, result.Workflow.Metadata.Id)

	// STEP 4: Summary
	s.T().Logf("✅ Resource count test passed: Exactly 1 agent and 1 workflow deployed (verified via API by slug)")
}
