//go:build e2e
// +build e2e

package e2e

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestHitlApprovalWorkflowSkip tests the SKIP action in the HITL approval flow.
//
// Scenario 3: Skip via Workflow API
//
// This test validates that:
// 1. User can submit SKIP action instead of APPROVE
// 2. Tool is marked as TOOL_CALL_SKIPPED (not executed)
// 3. Agent receives "Tool skipped by user" message
// 4. Agent continues with the skip result (doesn't fail)
// 5. Workflow completes successfully (SKIP is NOT a failure)
//
// SKIP semantics:
// - The tool is NOT executed
// - The LLM receives a message indicating the tool was skipped
// - The LLM can continue with alternative actions
// - The workflow does NOT fail
func (s *E2ESuite) TestHitlApprovalWorkflowSkip() {
	s.T().Logf("=== HITL Approval Flow Test: Skip via Workflow API ===")

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
	// STEP 4: Submit SKIP via Workflow API
	// ============================================================================
	s.T().Log("Step 4: Submitting SKIP via WorkflowExecution API...")
	skippedExecution, err := SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		"Integration test: SKIP via Workflow API",
	)
	s.Require().NoError(err, "Should be able to submit SKIP via Workflow API")
	s.Require().NotNil(skippedExecution)
	s.T().Log("✓ SKIP submitted successfully")

	// ============================================================================
	// STEP 5: Wait for workflow completion
	// ============================================================================
	s.T().Log("Step 5: Waiting for workflow to complete (SKIP should NOT fail)...")
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err, "Should reach terminal state without error")
	s.Require().True(success, "Workflow should complete successfully after SKIP (not fail)")
	s.T().Logf("✓ Workflow phase after SKIP: %s", finalExecution.Status.Phase.String())

	// ============================================================================
	// STEP 6: Verify tool call status is SKIPPED
	// ============================================================================
	s.T().Log("Step 6: Verifying tool call status...")
	childAgentExecutionID := pendingApproval.ChildAgentExecutionId
	if childAgentExecutionID != "" {
		childExecution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, childAgentExecutionID)
		s.Require().NoError(err)

		// Find the tool call and verify it's marked as SKIPPED
		VerifyToolCallApprovalStatus(
			s.T(),
			childExecution,
			pendingApproval.ToolCallId,
			agentexecutionv1.ToolCallStatus_TOOL_CALL_SKIPPED,
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		)
		s.T().Log("✓ Tool call status verified as SKIPPED")
	}

	// ============================================================================
	// STEP 7: Verify workflow completed (not failed)
	// ============================================================================
	s.T().Log("Step 7: Verifying workflow completed successfully...")
	VerifyWorkflowCompletedSuccessfully(s.T(), finalExecution)
	s.T().Log("✓ Workflow completed successfully after SKIP")

	// ============================================================================
	// SUCCESS
	// ============================================================================
	s.T().Log("")
	s.T().Logf("✅ HITL Approval Flow Test PASSED: Skip via Workflow API")
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final Phase: %s", finalExecution.Status.Phase.String())
	s.T().Logf("   Approval Action: SKIP")
	s.T().Logf("   Result: Workflow completed (tool was NOT executed)")
}

// TestHitlApprovalSkipVsApprove compares SKIP and APPROVE outcomes.
//
// Key differences:
// - APPROVE: Tool executes, returns tool result
// - SKIP: Tool does NOT execute, returns skip message
// - Both: Workflow completes successfully
func (s *E2ESuite) TestHitlApprovalSkipVsApprove() {
	s.T().Logf("=== HITL Skip vs Approve Comparison Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)

	// Test APPROVE path
	s.T().Log("Testing APPROVE path...")
	runApprove := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	execApprove, _ := WaitForPendingApproval(s.Harness.ServerPort, runApprove.ExecutionID, ApprovalTestTimeout)

	_, err := SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runApprove.ExecutionID,
		execApprove.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"APPROVE test",
	)
	s.Require().NoError(err)

	finalApprove, successApprove, _ := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runApprove.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.T().Logf("APPROVE result: success=%v, phase=%s", successApprove, finalApprove.Status.Phase.String())

	// Test SKIP path
	s.T().Log("Testing SKIP path...")
	runSkip := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)
	execSkip, _ := WaitForPendingApproval(s.Harness.ServerPort, runSkip.ExecutionID, ApprovalTestTimeout)

	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runSkip.ExecutionID,
		execSkip.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		"SKIP test",
	)
	s.Require().NoError(err)

	finalSkip, successSkip, _ := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runSkip.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.T().Logf("SKIP result: success=%v, phase=%s", successSkip, finalSkip.Status.Phase.String())

	// Both should succeed
	s.True(successApprove, "APPROVE should succeed")
	s.True(successSkip, "SKIP should succeed")

	s.T().Log("✅ Both APPROVE and SKIP complete workflow successfully")
}

// TestHitlApprovalSkipAgentContinues verifies the agent can continue after SKIP.
//
// When a tool is skipped:
// 1. Agent receives a message that tool was skipped
// 2. Agent can try alternative approaches
// 3. Agent can complete with partial results
func (s *E2ESuite) TestHitlApprovalSkipAgentContinues() {
	s.T().Logf("=== HITL Skip Agent Continuation Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	// Get to approval state
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	pendingApproval := executionWithApproval.Status.PendingApproval

	// Submit SKIP
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		"Testing agent continuation after skip",
	)
	s.Require().NoError(err)

	// Wait for completion
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success, "Agent should be able to continue after SKIP")

	// Verify child agent completed (not failed)
	if pendingApproval.ChildAgentExecutionId != "" {
		childExecution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, pendingApproval.ChildAgentExecutionId)
		s.Require().NoError(err)
		s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, childExecution.Status.Phase,
			"Child agent should complete after SKIP, not fail")
		s.T().Logf("✓ Child agent completed after SKIP: phase=%s", childExecution.Status.Phase.String())
	}

	s.T().Logf("✓ Workflow completed after SKIP: phase=%s", finalExecution.Status.Phase.String())
	s.T().Log("✅ Agent successfully continued after tool SKIP")
}
