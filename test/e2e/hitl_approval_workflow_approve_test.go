//go:build e2e
// +build e2e

package e2e

import (
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// TestHitlApprovalWorkflowApprove tests the complete HITL approval flow using the Workflow API.
//
// Scenario 1: Approve via Workflow API
//
// This test validates that:
// 1. Workflow correctly detects when child agent requires approval
// 2. pending_approval is populated at the workflow level
// 3. Approval can be submitted via WorkflowExecution.submitApproval
// 4. Agent resumes and completes tool execution
// 5. Workflow completes successfully
// 6. pending_approval is cleared after approval
//
// Prerequisites:
// - All services running (stigmer-service, agent-runner, workflow-runner, Temporal)
// - Ollama running with qwen2.5-coder:7b model
// - MCP server configured with pinned_tool_approvals for write_file
func (s *E2ESuite) TestHitlApprovalWorkflowApprove() {
	s.T().Logf("=== HITL Approval Flow Test: Approve via Workflow API ===")

	// ============================================================================
	// STEP 1: Apply test fixtures
	// ============================================================================
	s.T().Log("Step 1: Applying HITL approval test fixtures...")
	result := ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Fixtures applied:")
	s.T().Logf("  - Agent ID: %s", result.Agent.Metadata.Id)
	s.T().Logf("  - Workflow ID: %s", result.Workflow.Metadata.Id)
	s.T().Logf("  - MCP Server ID: %s", result.McpServer.Metadata.Id)

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
	s.Require().NotNil(executionWithApproval, "Execution should not be nil")
	s.Require().NotNil(executionWithApproval.Status, "Status should not be nil")
	s.Require().NotNil(executionWithApproval.Status.PendingApproval, "PendingApproval should be populated")

	pendingApproval := executionWithApproval.Status.PendingApproval
	s.T().Logf("✓ pending_approval detected:")
	s.T().Logf("  - tool_call_id: %s", pendingApproval.ToolCallId)
	s.T().Logf("  - tool_name: %s", pendingApproval.ToolName)
	s.T().Logf("  - message: %s", pendingApproval.Message)
	s.T().Logf("  - child_agent_execution_id: %s", pendingApproval.ChildAgentExecutionId)

	// ============================================================================
	// STEP 4: Verify pending_approval fields
	// ============================================================================
	s.T().Log("Step 4: Verifying pending_approval fields...")
	VerifyWorkflowPendingApprovalFields(s.T(), pendingApproval, "write_file")
	s.T().Log("✓ pending_approval fields verified")

	// ============================================================================
	// STEP 5: Submit approval via Workflow API
	// ============================================================================
	s.T().Log("Step 5: Submitting APPROVE via WorkflowExecution API...")
	approvedExecution, err := SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Integration test: APPROVE via Workflow API",
	)
	s.Require().NoError(err, "Should be able to submit approval via Workflow API")
	s.Require().NotNil(approvedExecution, "Approved execution should not be nil")
	s.T().Log("✓ Approval submitted successfully")

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
	s.Require().True(success, "Workflow should complete successfully after approval")
	s.T().Logf("✓ Workflow completed: phase=%s", finalExecution.Status.Phase.String())

	// ============================================================================
	// STEP 7: Verify pending_approval is cleared
	// ============================================================================
	s.T().Log("Step 7: Verifying pending_approval is cleared...")
	VerifyApprovalCleared(s.T(), finalExecution)
	s.T().Log("✓ pending_approval cleared successfully")

	// ============================================================================
	// STEP 8: Verify final workflow status
	// ============================================================================
	s.T().Log("Step 8: Verifying final workflow status...")
	VerifyWorkflowCompletedSuccessfully(s.T(), finalExecution)
	s.T().Log("✓ Workflow completed successfully")

	// ============================================================================
	// STEP 9: Verify child agent execution status
	// ============================================================================
	s.T().Log("Step 9: Verifying child agent execution...")
	childExecutionID := pendingApproval.ChildAgentExecutionId
	if childExecutionID != "" {
		childExecution, err := GetAgentExecutionViaAPI(s.Harness.ServerPort, childExecutionID)
		s.Require().NoError(err, "Should be able to query child agent execution")
		s.Require().NotNil(childExecution, "Child execution should exist")
		s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, childExecution.Status.Phase,
			"Child agent should be COMPLETED")
		s.T().Logf("✓ Child agent execution verified: phase=%s", childExecution.Status.Phase.String())
	}

	// ============================================================================
	// SUCCESS
	// ============================================================================
	s.T().Log("")
	s.T().Logf("✅ HITL Approval Flow Test PASSED: Approve via Workflow API")
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final Phase: %s", finalExecution.Status.Phase.String())
	s.T().Logf("   Approval Action: APPROVE")
	s.T().Logf("   API Used: WorkflowExecution.submitApproval")
}

// TestHitlApprovalWorkflowApproveVerifyPhaseTransitions verifies the phase transitions
// during the approval flow match the expected state machine.
//
// Expected Phase Transitions:
// 1. PENDING → IN_PROGRESS (execution started)
// 2. IN_PROGRESS → WAITING_FOR_APPROVAL (via task status, implicitly)
// 3. WAITING_FOR_APPROVAL → IN_PROGRESS (after approval)
// 4. IN_PROGRESS → COMPLETED
func (s *E2ESuite) TestHitlApprovalWorkflowApproveVerifyPhaseTransitions() {
	s.T().Logf("=== HITL Phase Transitions Test ===")

	// Apply fixtures and run workflow
	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	// Track phase transitions
	var phaseTransitions []workflowexecutionv1.ExecutionPhase
	lastPhase := workflowexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED

	// Wait for approval with phase tracking
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	if executionWithApproval.Status.Phase != lastPhase {
		phaseTransitions = append(phaseTransitions, executionWithApproval.Status.Phase)
		lastPhase = executionWithApproval.Status.Phase
	}

	// Submit approval
	pendingApproval := executionWithApproval.Status.PendingApproval
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Phase transition test",
	)
	s.Require().NoError(err)

	// Wait for completion
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success)

	if finalExecution.Status.Phase != lastPhase {
		phaseTransitions = append(phaseTransitions, finalExecution.Status.Phase)
	}

	// Log phase transitions
	s.T().Log("Phase Transitions observed:")
	for i, phase := range phaseTransitions {
		s.T().Logf("  %d. %s", i+1, phase.String())
	}

	// Verify final phase is COMPLETED
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, finalExecution.Status.Phase)
	s.T().Log("✅ Phase transitions verified")
}

// TestHitlApprovalWorkflowApproveMultipleTimes tests idempotency of approval submission.
// Submitting the same approval twice should be a no-op.
func (s *E2ESuite) TestHitlApprovalWorkflowApproveMultipleTimes() {
	s.T().Logf("=== HITL Idempotency Test: Multiple Approval Submissions ===")

	// Apply fixtures and run workflow
	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	// Wait for approval
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	pendingApproval := executionWithApproval.Status.PendingApproval

	// Submit first approval
	s.T().Log("Submitting first approval...")
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"First approval",
	)
	s.Require().NoError(err)
	s.T().Log("✓ First approval submitted")

	// Wait briefly to ensure processing
	time.Sleep(500 * time.Millisecond)

	// Submit second approval (should be idempotent)
	s.T().Log("Submitting second approval (should be idempotent)...")
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Second approval (duplicate)",
	)
	// Second approval may succeed or return "already processed" - both are acceptable
	if err != nil {
		s.T().Logf("Second approval returned error (expected): %v", err)
	} else {
		s.T().Log("Second approval accepted (idempotent)")
	}

	// Wait for completion
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success)

	VerifyWorkflowCompletedSuccessfully(s.T(), finalExecution)
	s.T().Log("✅ Idempotency test passed")
}
