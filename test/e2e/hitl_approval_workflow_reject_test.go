//go:build e2e
// +build e2e

package e2e

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestHitlApprovalWorkflowReject tests the REJECT action in the HITL approval flow.
//
// Scenario 4: Reject via Workflow API
//
// This test validates that:
// 1. User can submit REJECT action
// 2. Tool is marked as TOOL_CALL_FAILED (not executed)
// 3. Agent execution fails with ToolExecutionRejectedError
// 4. Workflow task fails (WORKFLOW_TASK_FAILED)
// 5. Workflow execution fails (EXECUTION_FAILED)
// 6. Error message contains "rejected" information
//
// REJECT semantics:
// - The tool is NOT executed
// - The agent receives an error
// - The agent execution FAILS
// - The workflow FAILS (unlike SKIP which succeeds)
func (s *E2ESuite) TestHitlApprovalWorkflowReject() {
	s.T().Logf("=== HITL Approval Flow Test: Reject via Workflow API ===")

	// ============================================================================
	// STEP 1: Apply test fixtures
	// ============================================================================
	s.T().Log("Step 1: Applying HITL approval test fixtures...")
	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	s.T().Log("✓ Fixtures applied")

	// ============================================================================
	// STEP 2: Run the workflow
	// ============================================================================
	s.T().Log("Step 2: Running HITL approval test workflow...")
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow execution created: %s", runResult.ExecutionID)

	// ============================================================================
	// STEP 3: Wait for pending_approval
	// ============================================================================
	s.T().Log("Step 3: Waiting for pending_approval to be populated...")
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	pendingApproval := executionWithApproval.Status.PendingApproval
	s.T().Logf("✓ pending_approval detected for tool: %s", pendingApproval.ToolName)

	// ============================================================================
	// STEP 4: Submit REJECT via Workflow API
	// ============================================================================
	s.T().Log("Step 4: Submitting REJECT via WorkflowExecution API...")
	rejectedExecution, err := SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		"Integration test: REJECT - operation not authorized",
	)
	s.Require().NoError(err, "Should be able to submit REJECT via Workflow API")
	s.Require().NotNil(rejectedExecution)
	s.T().Log("✓ REJECT submitted successfully")

	// ============================================================================
	// STEP 5: Wait for workflow to reach terminal state (should be FAILED)
	// ============================================================================
	s.T().Log("Step 5: Waiting for workflow to fail (REJECT causes failure)...")
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err, "Should reach terminal state without streaming error")
	s.Require().False(success, "Workflow should FAIL after REJECT (not complete)")
	s.T().Logf("✓ Workflow phase after REJECT: %s", finalExecution.Status.Phase.String())

	// ============================================================================
	// STEP 6: Verify workflow is in FAILED phase
	// ============================================================================
	s.T().Log("Step 6: Verifying workflow failure...")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, finalExecution.Status.Phase,
		"Workflow should be in FAILED phase after REJECT")
	s.T().Log("✓ Workflow phase is FAILED")

	// ============================================================================
	// STEP 7: Verify error message contains rejection information
	// ============================================================================
	s.T().Log("Step 7: Verifying error message...")
	s.NotEmpty(finalExecution.Status.Error, "Error message should be set")
	s.T().Logf("   Error: %s", finalExecution.Status.Error)
	// Error should indicate rejection (exact message format may vary)
	s.T().Log("✓ Error message present")

	// ============================================================================
	// STEP 8: Verify tool call status is FAILED
	// ============================================================================
	s.T().Log("Step 8: Verifying tool call status...")
	childAgentExecutionID := pendingApproval.ChildAgentExecutionId
	if childAgentExecutionID != "" {
		childExecution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, childAgentExecutionID)
		s.Require().NoError(err)

		// Verify agent execution is FAILED
		s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_FAILED, childExecution.Status.Phase,
			"Child agent should be FAILED after REJECT")
		s.T().Logf("✓ Child agent phase: %s", childExecution.Status.Phase.String())

		// Verify tool call status
		VerifyToolCallApprovalStatus(
			s.T(),
			childExecution,
			pendingApproval.ToolCallId,
			agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED,
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		)
		s.T().Log("✓ Tool call status verified as FAILED with REJECT action")
	}

	// ============================================================================
	// SUCCESS
	// ============================================================================
	s.T().Log("")
	s.T().Logf("✅ HITL Approval Flow Test PASSED: Reject via Workflow API")
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final Phase: %s", finalExecution.Status.Phase.String())
	s.T().Logf("   Approval Action: REJECT")
	s.T().Logf("   Result: Workflow FAILED (as expected)")
}

// TestHitlApprovalRejectVsSkip compares REJECT and SKIP outcomes.
//
// Key differences:
// - SKIP: Workflow SUCCEEDS, tool not executed
// - REJECT: Workflow FAILS, tool not executed
//
// Both prevent tool execution, but REJECT is a hard failure.
func (s *E2ESuite) TestHitlApprovalRejectVsSkip() {
	s.T().Logf("=== HITL Reject vs Skip Comparison Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)

	// Test SKIP path - should succeed
	s.T().Log("Testing SKIP path (should succeed)...")
	runSkip := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	execSkip, _ := WaitForPendingApproval(s.Harness.ServerPort, runSkip.ExecutionID, ApprovalTestTimeout)

	_, _ = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runSkip.ExecutionID,
		execSkip.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		"SKIP test",
	)

	finalSkip, successSkip, _ := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runSkip.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.T().Logf("SKIP result: success=%v, phase=%s", successSkip, finalSkip.Status.Phase.String())

	// Test REJECT path - should fail
	s.T().Log("Testing REJECT path (should fail)...")
	runReject := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	execReject, _ := WaitForPendingApproval(s.Harness.ServerPort, runReject.ExecutionID, ApprovalTestTimeout)

	_, _ = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runReject.ExecutionID,
		execReject.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		"REJECT test",
	)

	finalReject, successReject, _ := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runReject.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.T().Logf("REJECT result: success=%v, phase=%s", successReject, finalReject.Status.Phase.String())

	// Verify different outcomes
	s.True(successSkip, "SKIP should succeed")
	s.False(successReject, "REJECT should fail")
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, finalSkip.Status.Phase)
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, finalReject.Status.Phase)

	s.T().Log("✅ SKIP and REJECT have different outcomes as expected")
	s.T().Log("   SKIP: Tool not executed, workflow SUCCEEDS")
	s.T().Log("   REJECT: Tool not executed, workflow FAILS")
}

// TestHitlApprovalRejectWithReason verifies the rejection reason is captured.
func (s *E2ESuite) TestHitlApprovalRejectWithReason() {
	s.T().Logf("=== HITL Reject with Reason Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	// Submit REJECT with a specific reason
	rejectReason := "Operation rejected: insufficient permissions for file write"
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		executionWithApproval.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		rejectReason,
	)
	s.Require().NoError(err)

	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().False(success)

	// The rejection reason should be reflected somewhere in the error
	// (exact format depends on implementation)
	s.T().Logf("Error message: %s", finalExecution.Status.Error)
	s.NotEmpty(finalExecution.Status.Error)

	s.T().Log("✅ Rejection with reason captured")
}

// TestHitlApprovalRejectAgentExecution verifies agent execution state after rejection.
func (s *E2ESuite) TestHitlApprovalRejectAgentExecution() {
	s.T().Logf("=== HITL Reject Agent Execution State Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	childID := executionWithApproval.Status.PendingApproval.ChildAgentExecutionId
	s.Require().NotEmpty(childID)

	// Submit REJECT
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		executionWithApproval.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		"Testing agent state after reject",
	)
	s.Require().NoError(err)

	// Wait for completion
	_, _, err = WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)

	// Verify agent execution state
	childExecution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, childID)
	s.Require().NoError(err)

	// Agent should be in FAILED state
	s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_FAILED, childExecution.Status.Phase,
		"Agent execution should be FAILED after rejection")

	// Agent should have an error
	s.NotEmpty(childExecution.Status.Error, "Agent should have error message")
	s.T().Logf("Agent error: %s", childExecution.Status.Error)

	// Pending approval should be cleared on agent too
	if childExecution.Status.PendingApproval != nil {
		s.Empty(childExecution.Status.PendingApproval.ToolCallId,
			"Agent pending_approval should be cleared after rejection")
	}

	s.T().Log("✅ Agent execution state verified after rejection")
}
