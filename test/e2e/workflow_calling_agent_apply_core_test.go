//go:build e2e
// +build e2e

package e2e

// TestApplyWorkflowCallingAgent tests the full workflow apply workflow where a workflow calls an agent:
// 1. Server is running with isolated storage
// 2. Apply command deploys both workflow and agent from code (from SDK example 15_workflow_calling_simple_agent.go)
// 3. Both workflow and agent are stored in BadgerDB
// 4. Can retrieve and verify both workflow and agent data
// 5. Verify workflow has agent call task that references the agent
//
// The SDK example creates:
// - code-reviewer: Simple agent for code reviews
// - simple-review: Workflow that calls the code-reviewer agent
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgent() {
	s.T().Logf("=== Testing Workflow-Calling-Agent Apply (from SDK example 15_workflow_calling_simple_agent.go) ===")

	// STEP 1: Apply from SDK example
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify CLI output
	VerifyWorkflowCallingAgentApplyOutputSuccess(s.T(), result.Output)

	// STEP 3: Verify agent properties
	VerifyWorkflowCallingAgentProperties(s.T(), result.Agent)

	// STEP 4: Verify workflow properties
	VerifyWorkflowCallingWorkflowProperties(s.T(), result.Workflow)

	// STEP 5: Verify workflow has agent call task
	VerifyWorkflowCallingAgentTask(s.T(), result.Workflow)

	// STEP 6: Summary
	s.T().Logf("✅ Test passed: Workflow calling agent was successfully applied")
	s.T().Logf("   Agent ID: %s", result.Agent.Metadata.Id)
	s.T().Logf("   Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   Agent call task: %s", result.Workflow.Spec.Tasks[0].Name)
}
