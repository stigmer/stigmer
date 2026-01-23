//go:build e2e
// +build e2e

package e2e

import (
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// TestApplyWorkflowCallingAgentVerifyBoth verifies both agent and workflow can be queried independently
//
// Example: sdk/go/examples/15_workflow_calling_simple_agent.go
// Test Fixture: test/e2e/testdata/examples/15-workflow-calling-simple-agent/
func (s *E2ESuite) TestApplyWorkflowCallingAgentVerifyBoth() {
	s.T().Logf("=== Testing Workflow-Calling-Agent Independent Verification ===")

	// STEP 1: Apply from SDK example
	result := ApplyWorkflowCallingAgent(s.T(), s.Harness.ServerPort)

	// ========================================
	// STEP 2: Verify agent can be queried
	// ========================================
	s.Equal(WorkflowCallingAgentName, result.Agent.Metadata.Name,
		"Agent name should match SDK example")
	s.NotEmpty(result.Agent.Metadata.Id, "Agent should have an ID")
	s.NotEmpty(result.Agent.Spec.Instructions, "Agent should have instructions")
	s.T().Logf("✓ Agent verified independently:")
	s.T().Logf("   Name: %s", result.Agent.Metadata.Name)
	s.T().Logf("   ID: %s", result.Agent.Metadata.Id)
	s.T().Logf("   Description: %s", result.Agent.Spec.Description)

	// ========================================
	// STEP 3: Verify workflow can be queried
	// ========================================
	s.Equal(WorkflowCallingWorkflowName, result.Workflow.Metadata.Name,
		"Workflow name should match SDK example")
	s.NotEmpty(result.Workflow.Metadata.Id, "Workflow should have an ID")
	s.Equal(WorkflowCallingWorkflowNamespace, result.Workflow.Spec.Document.Namespace,
		"Workflow namespace should match SDK example")
	s.Equal(WorkflowCallingWorkflowVersion, result.Workflow.Spec.Document.Version,
		"Workflow version should match SDK example")
	s.T().Logf("✓ Workflow verified independently:")
	s.T().Logf("   Name: %s", result.Workflow.Metadata.Name)
	s.T().Logf("   ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("   Namespace: %s", result.Workflow.Spec.Document.Namespace)

	// ========================================
	// STEP 4: Verify workflow references agent
	// ========================================
	s.Require().NotNil(result.Workflow.Spec.Tasks, "Workflow should have tasks")
	s.Require().Len(result.Workflow.Spec.Tasks, WorkflowCallingWorkflowTaskCount,
		"Workflow should have 1 task from SDK example")

	task := result.Workflow.Spec.Tasks[0]
	s.Require().Equal(apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, task.Kind,
		"Task should be an agent call")
	s.Require().NotNil(task.TaskConfig, "Agent call task should have configuration")
	s.T().Logf("✓ Workflow has agent call task with configuration")

	// STEP 5: Summary
	s.T().Logf("✅ Independent verification test passed: Both resources are valid and properly linked")
}
