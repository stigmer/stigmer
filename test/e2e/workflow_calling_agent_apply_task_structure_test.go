//go:build e2e
// +build e2e

package e2e

import (
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// TestApplyWorkflowCallingAgentTaskStructure verifies the agent call task structure
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go demonstrates:
// - Creating an agent in the same context
// - Referencing the agent from a workflow
// - Using workflow.Agent() for direct instance references
//
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentTaskStructure() {
	s.T().Logf("=== Testing Workflow-Calling-Agent Task Structure ===")

	// STEP 1: Apply from SDK example
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify workflow has exactly one task
	s.Require().NotNil(result.Workflow.Spec.Tasks, "Workflow should have tasks")
	s.Len(result.Workflow.Spec.Tasks, WorkflowCallingWorkflowTaskCount,
		"Workflow should have exactly 1 task from SDK example")

	task := result.Workflow.Spec.Tasks[0]

	// STEP 3: Verify task name
	s.Equal(WorkflowCallingTaskName, task.Name,
		"Task should be named 'reviewCode' from SDK example")

	// STEP 4: Verify task type
	s.Equal(apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, task.Kind,
		"Task should be of type AGENT_CALL")

	// STEP 5: Verify agent call structure
	s.Require().NotNil(task.TaskConfig, "Task should have agent call configuration")

	s.T().Logf("✓ Task structure verified:")
	s.T().Logf("   Task name: %s", task.Name)
	s.T().Logf("   Task kind: %s", task.Kind)

	// STEP 6: Summary
	s.T().Logf("✅ Task structure test passed: Agent call task is properly configured")
}
