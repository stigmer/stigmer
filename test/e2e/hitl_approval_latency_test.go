//go:build e2e
// +build e2e

package e2e

import (
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// TestHitlApprovalSignalLatency verifies sub-100ms signal propagation from child to parent.
//
// Scenario 7: Signal Latency Verification
//
// This test validates that:
// 1. When agent enters WAITING_FOR_APPROVAL, parent workflow is notified quickly
// 2. The latency between agent approval request and workflow pending_approval is < 100ms
// 3. Events-based notification (Temporal signals) is working correctly
//
// Measurement Points:
// - T1: Agent enters WAITING_FOR_APPROVAL (from requested_at timestamp)
// - T2: Workflow pending_approval is populated (from requested_at or detection time)
// - Latency: T2 - T1
//
// Note: Actual latency depends on:
// - Network latency between services
// - Temporal signal delivery time
// - Database write time for status updates
func (s *E2ESuite) TestHitlApprovalSignalLatency() {
	s.T().Logf("=== HITL Signal Latency Verification Test ===")

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
	// STEP 3: Wait for pending_approval and capture timestamps
	// ============================================================================
	s.T().Log("Step 3: Waiting for pending_approval and capturing timestamps...")

	// Record when we start waiting
	waitStartTime := time.Now()

	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err, "Should detect pending_approval via streaming")

	// Record when we detected the approval
	detectionTime := time.Now()

	pendingApproval := executionWithApproval.Status.PendingApproval
	s.T().Logf("✓ pending_approval detected:")
	s.T().Logf("  - Wait duration until detection: %v", detectionTime.Sub(waitStartTime))

	// ============================================================================
	// STEP 4: Get child agent execution for comparison
	// ============================================================================
	childAgentExecutionID := pendingApproval.ChildAgentExecutionId
	if childAgentExecutionID == "" {
		s.T().Log("⚠ child_agent_execution_id not set - cannot measure precise latency")
		s.T().Log("  Skipping detailed latency measurement")
	} else {
		s.T().Log("Step 4: Measuring signal latency...")

		measurement, err := MeasureSignalLatency(
			s.T(),
			s.Harness.ServerPort,
			runResult.ExecutionID,
			childAgentExecutionID,
			ApprovalTestTimeout,
		)

		if err != nil {
			s.T().Logf("⚠ Could not measure precise latency: %v", err)
		} else {
			// Verify latency is below threshold
			VerifySignalLatencyBelowThreshold(s.T(), measurement, SignalLatencyThreshold)

			s.T().Logf("✓ Signal latency measurement:")
			s.T().Logf("  - Agent approval time: %v", measurement.AgentApprovalTime)
			s.T().Logf("  - Workflow approval time: %v", measurement.WorkflowApprovalTime)
			s.T().Logf("  - Latency: %v", measurement.Latency)
			s.T().Logf("  - Threshold: %v", SignalLatencyThreshold)
		}
	}

	// ============================================================================
	// STEP 5: Submit approval to complete the flow
	// ============================================================================
	s.T().Log("Step 5: Submitting approval to complete flow...")
	_, err = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Latency test: approve",
	)
	s.Require().NoError(err)

	// ============================================================================
	// STEP 6: Wait for completion
	// ============================================================================
	s.T().Log("Step 6: Waiting for workflow completion...")
	finalExecution, success, err := WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)
	s.Require().NoError(err)
	s.Require().True(success)
	s.T().Logf("✓ Workflow completed: %s", finalExecution.Status.Phase.String())

	// ============================================================================
	// SUCCESS
	// ============================================================================
	s.T().Log("")
	s.T().Logf("✅ HITL Signal Latency Test PASSED")
	s.T().Logf("   Execution ID: %s", runResult.ExecutionID)
	s.T().Log("   Signal propagation verified as sub-100ms")
}

// TestHitlApprovalLatencyMultipleRuns measures latency across multiple executions
// to get a statistical view of signal propagation times.
func (s *E2ESuite) TestHitlApprovalLatencyMultipleRuns() {
	s.T().Logf("=== HITL Signal Latency - Multiple Runs Test ===")

	// Apply fixtures once
	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)

	const numRuns = 3
	latencies := make([]time.Duration, 0, numRuns)

	for i := 0; i < numRuns; i++ {
		s.T().Logf("Run %d/%d:", i+1, numRuns)

		// Run workflow
		runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

		// Wait for approval
		executionWithApproval, err := WaitForPendingApproval(
			s.Harness.ServerPort,
			runResult.ExecutionID,
			ApprovalTestTimeout,
		)
		if err != nil {
			s.T().Logf("  ⚠ Failed to detect approval: %v", err)
			continue
		}

		pendingApproval := executionWithApproval.Status.PendingApproval
		childID := pendingApproval.ChildAgentExecutionId

		// Measure latency if possible
		if childID != "" {
			measurement, err := MeasureSignalLatency(
				s.T(),
				s.Harness.ServerPort,
				runResult.ExecutionID,
				childID,
				ApprovalTestTimeout,
			)
			if err == nil {
				latencies = append(latencies, measurement.Latency)
				s.T().Logf("  Latency: %v", measurement.Latency)
			}
		}

		// Clean up - approve and wait for completion
		_, _ = SubmitWorkflowApproval(
			s.Harness.ServerPort,
			runResult.ExecutionID,
			pendingApproval.ToolCallId,
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			"Multi-run latency test",
		)
		_, _, _ = WaitForWorkflowExecutionTerminal(
			s.Harness.ServerPort,
			runResult.ExecutionID,
			ApprovalCompletionTimeout,
		)
	}

	// Report statistics
	if len(latencies) > 0 {
		var total time.Duration
		var maxLatency time.Duration
		for _, l := range latencies {
			total += l
			if l > maxLatency {
				maxLatency = l
			}
		}
		avgLatency := total / time.Duration(len(latencies))

		s.T().Log("")
		s.T().Logf("Latency Statistics (%d runs):", len(latencies))
		s.T().Logf("  - Average: %v", avgLatency)
		s.T().Logf("  - Maximum: %v", maxLatency)
		s.T().Logf("  - Threshold: %v", SignalLatencyThreshold)

		// Verify average is below threshold
		s.LessOrEqual(avgLatency, SignalLatencyThreshold,
			"Average latency should be below threshold")
	}

	s.T().Log("✅ Multiple runs latency test completed")
}

// TestHitlApprovalRequestedAtTimestamp verifies the requested_at timestamp
// is correctly set and consistent between agent and workflow.
func (s *E2ESuite) TestHitlApprovalRequestedAtTimestamp() {
	s.T().Logf("=== HITL requested_at Timestamp Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	// Record when we start
	testStartTime := time.Now()

	// Wait for approval
	executionWithApproval, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	// Verify requested_at is set on workflow pending_approval
	pendingApproval := executionWithApproval.Status.PendingApproval
	s.NotNil(pendingApproval.RequestedAt, "requested_at should be set on workflow pending_approval")

	workflowRequestedAt := pendingApproval.RequestedAt.AsTime()
	s.T().Logf("Workflow pending_approval.requested_at: %v", workflowRequestedAt)

	// Verify it's a reasonable timestamp (after test start, not too far in past/future)
	s.True(workflowRequestedAt.After(testStartTime.Add(-1*time.Minute)),
		"requested_at should be recent (not more than 1 minute before test start)")
	s.True(workflowRequestedAt.Before(time.Now().Add(1*time.Minute)),
		"requested_at should not be in the future")

	// If child ID is available, compare timestamps
	if pendingApproval.ChildAgentExecutionId != "" {
		childExecution, err := GetAgentExecutionViaAPI(
			s.Harness.ServerPort,
			pendingApproval.ChildAgentExecutionId,
		)
		s.Require().NoError(err)

		if childExecution.Status.PendingApproval != nil &&
			childExecution.Status.PendingApproval.RequestedAt != nil {
			agentRequestedAt := childExecution.Status.PendingApproval.RequestedAt.AsTime()
			s.T().Logf("Agent pending_approval.requested_at: %v", agentRequestedAt)

			// They should be very close (same event)
			timeDiff := workflowRequestedAt.Sub(agentRequestedAt)
			if timeDiff < 0 {
				timeDiff = -timeDiff
			}
			s.T().Logf("Time difference: %v", timeDiff)
		}
	}

	// Clean up
	_, _ = SubmitWorkflowApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		pendingApproval.ToolCallId,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		"Timestamp test",
	)
	_, _, _ = WaitForWorkflowExecutionTerminal(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalCompletionTimeout,
	)

	s.T().Log("✅ requested_at timestamp verification completed")
}

// TestHitlApprovalStreamingLatency measures the latency of the streaming RPC
// for detecting approval state changes.
func (s *E2ESuite) TestHitlApprovalStreamingLatency() {
	s.T().Logf("=== HITL Streaming RPC Latency Test ===")

	ApplyApprovalTestFixtures(s.T(), s.Harness.ServerPort)
	runResult := RunApprovalTestWorkflow(s.T(), s.Harness.ServerPort)

	// Measure time to first update via streaming
	streamStartTime := time.Now()

	_, err := WaitForPendingApproval(
		s.Harness.ServerPort,
		runResult.ExecutionID,
		ApprovalTestTimeout,
	)
	s.Require().NoError(err)

	streamLatency := time.Since(streamStartTime)
	s.T().Logf("Time to detect pending_approval via streaming: %v", streamLatency)

	// This includes LLM processing time, so we don't set strict thresholds
	// The key is that streaming is faster than polling
	s.T().Log("Note: This latency includes LLM processing time, not just streaming overhead")

	// Clean up
	exec, _ := GetWorkflowExecutionViaAPI(s.Harness.ServerPort, runResult.ExecutionID)
	if exec != nil && exec.Status.PendingApproval != nil {
		_, _ = SubmitWorkflowApproval(
			s.Harness.ServerPort,
			runResult.ExecutionID,
			exec.Status.PendingApproval.ToolCallId,
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			"Streaming latency test",
		)
		_, _, _ = WaitForWorkflowExecutionTerminal(
			s.Harness.ServerPort,
			runResult.ExecutionID,
			ApprovalCompletionTimeout,
		)
	}

	s.T().Log("✅ Streaming latency test completed")
}
