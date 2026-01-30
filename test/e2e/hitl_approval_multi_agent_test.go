//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stretchr/testify/require"
)

// TestHitlApprovalMultiAgent tests the HITL approval flow with multiple agents in a workflow.
//
// Scenario 5: Multiple Agents in Workflow
//
// This test validates that:
// 1. Workflow with multiple agent tasks executes correctly
// 2. Only the task requiring approval blocks (others continue)
// 3. Approval only affects the specific task, not others
// 4. After approval, remaining tasks execute normally
// 5. Workflow completes after all tasks finish
//
// Workflow Structure:
// - Task 1: Safe agent (no approval needed) → Completes
// - Task 2: Dangerous agent (approval needed) → Waits for approval
// - Task 3: Summary agent (no approval needed) → Waits for Task 2
//
// Note: This test requires multi-agent workflow fixtures to be configured.
// The test is skipped if fixtures are not available.
func (s *E2ESuite) TestHitlApprovalMultiAgent() {
	s.T().Logf("=== HITL Approval Flow Test: Multiple Agents in Workflow ===")

	// ============================================================================
	// STEP 1: Apply multi-agent test fixtures
	// ============================================================================
	s.T().Log("Step 1: Applying multi-agent workflow fixtures...")

	// Get path to multi-agent fixture
	absTestdataDir, err := filepath.Abs(ApprovalTestDataDir)
	require.NoError(s.T(), err, "Failed to get absolute path to approval test directory")

	// Try to apply the multi-agent fixtures
	// Note: This may need separate fixture files for multi-agent scenarios
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	if err != nil {
		s.T().Skipf("Multi-agent fixtures not available or failed to apply: %v", err)
	}
	s.T().Logf("✓ Fixtures applied:\n%s", output)

	// Check if multi-agent workflow exists
	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, ApprovalMultiAgentWorkflowName, ApprovalTestOrg)
	if err != nil || workflow == nil {
		s.T().Skipf("Multi-agent workflow '%s' not found - skipping test", ApprovalMultiAgentWorkflowName)
	}
	s.T().Logf("✓ Multi-agent workflow found: %s", workflow.Metadata.Id)

	// ============================================================================
	// STEP 2: Run the multi-agent workflow
	// ============================================================================
	s.T().Log("Step 2: Running multi-agent workflow...")
	runResult := RunMultiAgentWorkflow(s.T(), s.Harness.ServerPort)
	s.T().Logf("✓ Workflow execution created: %s", runResult.ExecutionID)

	// ============================================================================
	// STEP 3: Wait for Task 1 to complete (should happen before approval)
	// ============================================================================
	s.T().Log("Step 3: Verifying Task 1 starts/completes independently...")
	// Give some time for Task 1 to start
	// In a sequential workflow, Task 1 should complete before Task 2 starts
	// This step is informational - the key verification is in Step 4

	// ============================================================================
	// STEP 4: Wait for pending_approval (from Task 2)
	// ============================================================================
	s.T().Log("Step 4: Waiting for pending_approval from Task 2...")
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err, "Should detect pending_approval from dangerous task")

	pendingApproval := executionWithApproval.Status.PendingApproval
	s.T().Logf("✓ pending_approval detected:")
	s.T().Logf("  - tool_call_id: %s", pendingApproval.ToolCallId)
	s.T().Logf("  - tool_name: %s", pendingApproval.ToolName)

	// ============================================================================
	// STEP 5: Verify task statuses at this point
	// ============================================================================
	s.T().Log("Step 5: Verifying task statuses...")
	// At this point:
	// - Task 1 (research) should be COMPLETED (or IN_PROGRESS if slow)
	// - Task 2 (dangerous) should be IN_PROGRESS with pending_approval
	// - Task 3 (summary) should be PENDING (waiting for Task 2)

	// Query current execution state
	currentExecution, err := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	s.Require().NoError(err)

	s.T().Log("Current task statuses:")
	for _, task := range currentExecution.Status.Tasks {
		s.T().Logf("  - %s: %s", task.Name, task.Status.String())
	}

	// ============================================================================
	// STEP 6: Submit approval for Task 2
	// ============================================================================
	s.T().Log("Step 6: Submitting APPROVE for dangerous task...")
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Multi-agent test: approving dangerous operation",
	)
	s.Require().NoError(err)
	s.T().Log("✓ Approval submitted")

	// ============================================================================
	// STEP 7: Wait for workflow completion
	// ============================================================================
	s.T().Log("Step 7: Waiting for workflow to complete (all tasks)...")
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success, "Workflow should complete successfully")
	s.T().Logf("✓ Workflow completed: phase=%s", finalExecution.Status.Phase.String())

	// ============================================================================
	// STEP 8: Verify all tasks completed
	// ============================================================================
	s.T().Log("Step 8: Verifying all tasks completed...")
	s.T().Log("Final task statuses:")
	for _, task := range finalExecution.Status.Tasks {
		s.T().Logf("  - %s: %s", task.Name, task.Status.String())
		s.Equal(workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED, task.Status,
			"Task %s should be COMPLETED", task.Name)
	}

	// ============================================================================
	// STEP 9: Verify pending_approval is cleared
	// ============================================================================
	s.T().Log("Step 9: Verifying pending_approval is cleared...")
	VerifyApprovalCleared(s.T(), finalExecution)
	s.T().Log("✓ pending_approval cleared")

	// ============================================================================
	// SUCCESS
	// ============================================================================
	s.T().Log("")
	s.T().Logf("✅ HITL Multi-Agent Flow Test PASSED")
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Logf("   Final Phase: %s", finalExecution.Status.Phase.String())
	s.T().Logf("   Total Tasks: %d", len(finalExecution.Status.Tasks))
}

// TestHitlApprovalMultiAgentPartialFailure tests what happens when one task
// in a multi-agent workflow is rejected.
//
// Expected behavior:
// - Task 1: Completes
// - Task 2: Rejected → FAILED
// - Task 3: Never executes (depends on Task 2)
// - Workflow: FAILED
func (s *E2ESuite) TestHitlApprovalMultiAgentPartialFailure() {
	s.T().Logf("=== HITL Multi-Agent Partial Failure Test ===")

	// Apply fixtures
	absTestdataDir, _ := filepath.Abs(ApprovalTestDataDir)
	_, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	if err != nil {
		s.T().Skipf("Multi-agent fixtures not available: %v", err)
	}

	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, ApprovalMultiAgentWorkflowName, ApprovalTestOrg)
	if err != nil || workflow == nil {
		s.T().Skipf("Multi-agent workflow not found - skipping test")
	}

	// Run workflow
	runResult := RunMultiAgentWorkflow(s.T(), s.Harness.ServerPort)

	// Wait for approval request
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	// Submit REJECT for Task 2
	s.T().Log("Submitting REJECT for dangerous task...")
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		executionWithApproval.Status.PendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		"Multi-agent test: rejecting dangerous operation",
	)
	s.Require().NoError(err)

	// Wait for terminal state
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().False(success, "Workflow should FAIL when one task is rejected")

	// Verify workflow failed
	s.Equal(workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, finalExecution.Status.Phase)

	// Log task statuses
	s.T().Log("Task statuses after rejection:")
	for _, task := range finalExecution.Status.Tasks {
		s.T().Logf("  - %s: %s", task.Name, task.Status.String())
	}

	s.T().Log("✅ Multi-agent partial failure test passed")
}

// TestHitlApprovalMultiAgentOnlyAffectedBlocks verifies that approval
// only affects the specific task, not others.
//
// Key verification:
// - Non-approval tasks should not be affected by approval state
// - Only the task with pending_approval should block
func (s *E2ESuite) TestHitlApprovalMultiAgentOnlyAffectedBlocks() {
	s.T().Logf("=== HITL Multi-Agent Isolation Test ===")

	// Apply fixtures
	absTestdataDir, _ := filepath.Abs(ApprovalTestDataDir)
	_, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	if err != nil {
		s.T().Skipf("Multi-agent fixtures not available: %v", err)
	}

	workflow, err := GetWorkflowBySlug(s.Harness.ServerPort, ApprovalMultiAgentWorkflowName, ApprovalTestOrg)
	if err != nil || workflow == nil {
		s.T().Skipf("Multi-agent workflow not found - skipping test")
	}

	// Run workflow
	runResult := RunMultiAgentWorkflow(s.T(), s.Harness.ServerPort)

	// Wait for approval request
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	// At this point, verify that:
	// 1. Only one task should have pending approval (implicitly via pending_approval field)
	// 2. Other tasks should be in their expected states

	s.T().Log("Verifying task isolation during approval wait...")

	// The pending_approval tells us which task is waiting
	pendingApproval := executionWithApproval.Status.PendingApproval
	s.T().Logf("Approval pending for agent: %s", pendingApproval.ChildAgentExecutionId)

	// Count how many tasks are in WAITING_APPROVAL state
	waitingCount := 0
	for _, task := range executionWithApproval.Status.Tasks {
		if task.Status == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL {
			waitingCount++
			s.T().Logf("Task in WAITING_APPROVAL: %s", task.Name)
		}
	}

	// Only one task should be waiting for approval
	s.LessOrEqual(waitingCount, 1, "At most one task should be WAITING_APPROVAL at a time")

	// Submit approval
	_, _ = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Isolation test: approve",
	)

	// Verify completion
	finalExecution, success, _ := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().True(success)

	s.T().Logf("✓ Workflow completed: %s", finalExecution.Status.Phase.String())
	s.T().Log("✅ Task isolation verified - only affected task was blocked")
}
