//go:build e2e
// +build e2e

package e2e

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestHitlApprovalAgentApprove tests the HITL approval flow using the Agent API directly.
//
// Scenario 2: Approve via Agent API
//
// This test validates that:
// 1. Workflow correctly detects when child agent requires approval
// 2. pending_approval is populated at the workflow level (with child_agent_execution_id)
// 3. Approval can be submitted directly via AgentExecution.submitApproval
// 4. Agent resumes and completes tool execution
// 5. Workflow detects agent completion and continues
// 6. pending_approval is cleared at workflow level
//
// This is an alternative path to Scenario 1, proving both APIs work interchangeably.
func (s *E2ESuite) TestHitlApprovalAgentApprove() {
	s.T().Logf("=== HITL Approval Flow Test: Approve via Agent API ===")

	// ============================================================================
	// STEP 1: Apply test fixtures
	// ============================================================================
	s.T().Log("Step 1: Applying HITL approval test fixtures...")
	result := ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Fixtures applied")

	// ============================================================================
	// STEP 2: Run the workflow
	// ============================================================================
	s.T().Log("Step 2: Running HITL approval test workflow...")
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow execution created: %s", runResult.ExecutionID)

	// ============================================================================
	// STEP 3: Wait for pending_approval to be populated
	// ============================================================================
	s.T().Log("Step 3: Waiting for pending_approval to be populated...")
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err, "Should detect pending_approval via streaming")

	pendingApproval := executionWithApproval.Status.PendingApproval
	s.T().Logf("✓ pending_approval detected:")
	s.T().Logf("  - tool_call_id: %s", pendingApproval.ToolCallId)
	s.T().Logf("  - child_agent_execution_id: %s", pendingApproval.ChildAgentExecutionId)

	// ============================================================================
	// STEP 4: Extract child agent execution ID
	// ============================================================================
	childAgentExecutionID := pendingApproval.ChildAgentExecutionId
	s.Require().NotEmpty(childAgentExecutionID,
		"child_agent_execution_id must be populated for Agent API submission")
	s.T().Logf("✓ Child agent execution ID: %s", childAgentExecutionID)

	// ============================================================================
	// STEP 5: Submit approval via Agent API (NOT Workflow API)
	// ============================================================================
	s.T().Log("Step 5: Submitting APPROVE via AgentExecution API...")
	approvedAgentExecution, err := SubmitAgentApproval(
		s.Harness.ServerPort,
		childAgentExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	)
	s.Require().NoError(err, "Should be able to submit approval via Agent API")
	s.Require().NotNil(approvedAgentExecution, "Approved agent execution should not be nil")
	s.T().Log("✓ Approval submitted to Agent API successfully")

	// ============================================================================
	// STEP 6: Wait for workflow completion
	// ============================================================================
	s.T().Log("Step 6: Waiting for workflow to complete...")
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err, "Should reach terminal state without error")
	s.Require().True(success, "Workflow should complete successfully after approval via Agent API")
	s.T().Logf("✓ Workflow completed: phase=%s", finalExecution.Status.Phase.String())

	// ============================================================================
	// STEP 7: Verify pending_approval is cleared at workflow level
	// ============================================================================
	s.T().Log("Step 7: Verifying pending_approval is cleared at workflow level...")
	VerifyApprovalCleared(s.T(), finalExecution)
	s.T().Log("✓ pending_approval cleared successfully")

	// ============================================================================
	// STEP 8: Verify final statuses
	// ============================================================================
	s.T().Log("Step 8: Verifying final statuses...")

	// Verify workflow completed
	VerifyWorkflowCompletedSuccessfully(s.T(), finalExecution)

	// Verify child agent completed
	childExecution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, childAgentExecutionID)
	s.Require().NoError(err)
	s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, childExecution.Status.Phase,
		"Child agent should be COMPLETED")
	s.T().Logf("✓ Child agent phase: %s", childExecution.Status.Phase.String())

	// ============================================================================
	// SUCCESS
	// ============================================================================
	s.T().Log("")
	s.T().Logf("✅ HITL Approval Flow Test PASSED: Approve via Agent API")
	s.T().Logf("   Workflow Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Agent Execution ID: %s", childAgentExecutionID)
	s.T().Logf("   Approval Action: APPROVE")
	s.T().Logf("   API Used: AgentExecution.submitApproval")
}

// TestHitlApprovalAgentApproveAfterWorkflowDetection verifies that the workflow
// properly detects when approval is submitted directly to the agent.
//
// This tests the async detection path where:
// 1. Workflow is waiting for approval
// 2. User submits approval directly to agent (bypassing workflow)
// 3. Agent resumes and completes
// 4. Workflow detects completion via callback and continues
func (s *E2ESuite) TestHitlApprovalAgentApproveAfterWorkflowDetection() {
	s.T().Logf("=== HITL Agent Approval Detection Test ===")

	// Setup
	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	// Wait for approval at workflow level
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	// Get workflow phase before approval
	s.T().Logf("Workflow phase before approval: %s",
		executionWithApproval.Status.Phase.String())

	// Submit via Agent API
	pendingApproval := executionWithApproval.Status.PendingApproval
	_, err = SubmitAgentApproval(
		s.Harness.ServerPort,
		pendingApproval.ChildAgentExecutionId,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	)
	s.Require().NoError(err)

	// Verify workflow detects completion (not stuck waiting)
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success, "Workflow should detect agent completion after Agent API approval")

	s.T().Logf("Workflow phase after approval: %s", finalExecution.Status.Phase.String())
	s.T().Log("✅ Workflow successfully detected agent completion")
}

// TestHitlApprovalBothAPIsInterchangeable verifies that Workflow and Agent APIs
// are truly interchangeable for the same approval request.
//
// Note: This test validates the design decision that both APIs produce
// identical outcomes for the approval flow.
func (s *E2ESuite) TestHitlApprovalBothAPIsInterchangeable() {
	s.T().Logf("=== HITL API Interchangeability Test ===")

	// Test 1: Approve via Workflow API
	s.T().Log("Test 1: Running approval via Workflow API...")
	result1 := ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	_ = result1 // Verify fixtures applied

	runResult1 := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	exec1, _ := WaitForPendingApproval(s.Harness.ServerPort, runResult1.ExecutionID, ApprovalTestTimeout)

	_, err := SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult1.ExecutionID,
		exec1.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Via Workflow API",
	)
	s.Require().NoError(err)

	final1, success1, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult1.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success1)
	s.T().Logf("✓ Workflow API: %s", final1.Status.Phase.String())

	// Test 2: Approve via Agent API (new execution)
	s.T().Log("Test 2: Running approval via Agent API...")
	runResult2 := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	exec2, _ := WaitForPendingApproval(s.Harness.ServerPort, runResult2.ExecutionID, ApprovalTestTimeout)

	_, err = SubmitAgentApproval(
		s.Harness.ServerPort,
		exec2.Status.PendingApproval.ChildAgentExecutionId,
		exec2.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	)
	s.Require().NoError(err)

	final2, success2, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult2.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success2)
	s.T().Logf("✓ Agent API: %s", final2.Status.Phase.String())

	// Both should have same final phase
	s.Equal(final1.Status.Phase, final2.Status.Phase,
		"Both APIs should produce same final workflow phase")

	s.T().Log("✅ APIs are interchangeable - both produce same outcome")
}
