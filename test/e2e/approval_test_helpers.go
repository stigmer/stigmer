//go:build e2e
// +build e2e

package e2e

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// =============================================================================
// HITL Approval Flow Test Helpers
// =============================================================================
//
// This file contains helper functions for testing the Human-in-the-Loop (HITL)
// approval flow end-to-end. The helpers follow the patterns established in
// helpers_test.go and workflow_stream_helpers.go.
//
// Key Functions:
// - SubmitWorkflowApproval: Submit approval via WorkflowExecution API
// - SubmitAgentApproval: Submit approval via AgentExecution API
// - WaitForPendingApproval: Wait for pending_approval to be populated
// - WaitForApprovalCleared: Wait for pending_approval to be cleared
// - VerifyPendingApprovalFields: Validate PendingApproval fields
// - VerifyToolCallApprovalStatus: Verify tool call status after approval
// =============================================================================

// ApprovalTestApplyResult contains the result of applying HITL approval test fixtures
type ApprovalTestApplyResult struct {
	Agent     *agentv1.Agent
	Workflow  *workflowv1.Workflow
	McpServer *mcpserverv1.McpServer
	Output    string
}

// MultiAgentApplyResult contains the result of applying multi-agent workflow fixtures
type MultiAgentApplyResult struct {
	SafeAgent      *agentv1.Agent
	DangerousAgent *agentv1.Agent
	SummaryAgent   *agentv1.Agent
	Workflow       *workflowv1.Workflow
	Output         string
}

// ApprovalRunResult contains the result of running a workflow with approval requirements
type ApprovalRunResult struct {
	ExecutionID string
	Output      string
}

// =============================================================================
// FIXTURE APPLICATION HELPERS
// =============================================================================

// ApplyApprovalTestFixtures applies all HITL approval test fixtures
// Returns the deployed agent, workflow, MCP server, and CLI output
func ApplyApprovalTestFixtures(t *testing.T, serverPort int) *ApprovalTestApplyResult {
	// Get absolute path to approval test fixture directory
	absTestdataDir, err := filepath.Abs(ApprovalTestDataDir)
	require.NoError(t, err, "Failed to get absolute path to approval test directory")

	t.Logf("Applying HITL approval test fixtures from: %s", absTestdataDir)

	// Execute apply command
	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir)
	require.NoError(t, err, "Apply command should succeed")

	t.Logf("Apply command output:\n%s", output)

	// Verify MCP server exists
	mcpServer, err := GetMcpServerBySlug(serverPort, ApprovalTestMcpServerName, ApprovalTestOrg)
	require.NoError(t, err, "Should be able to query MCP server by slug via API")
	require.NotNil(t, mcpServer, "MCP server should exist")
	t.Logf("✓ MCP Server deployed: %s", mcpServer.Metadata.Id)

	// Verify agent exists
	agent, err := GetAgentBySlug(serverPort, ApprovalTestAgentName, ApprovalTestOrg)
	require.NoError(t, err, "Should be able to query agent by slug via API")
	require.NotNil(t, agent, "Agent should exist")
	t.Logf("✓ Agent deployed: %s", agent.Metadata.Id)

	// Verify workflow exists
	workflow, err := GetWorkflowBySlug(serverPort, ApprovalTestWorkflowName, ApprovalTestOrg)
	require.NoError(t, err, "Should be able to query workflow by slug via API")
	require.NotNil(t, workflow, "Workflow should exist")
	t.Logf("✓ Workflow deployed: %s", workflow.Metadata.Id)

	return &ApprovalTestApplyResult{
		Agent:     agent,
		Workflow:  workflow,
		McpServer: mcpServer,
		Output:    output,
	}
}

// GetMcpServerBySlug queries an MCP server by slug and organization via gRPC API
func GetMcpServerBySlug(serverPort int, slug string, org string) (*mcpserverv1.McpServer, error) {
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	client := mcpserverv1.NewMcpServerQueryControllerClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	server, err := client.GetBySlug(ctx, &mcpserverv1.GetMcpServerBySlugInput{
		Org:  org,
		Slug: slug,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get MCP server by slug: %w", err)
	}

	return server, nil
}

// =============================================================================
// APPROVAL SUBMISSION HELPERS
// =============================================================================

// SubmitWorkflowApproval submits an approval decision via the WorkflowExecution API.
// This forwards the approval to the child AgentExecution.
func SubmitWorkflowApproval(
	serverPort int,
	executionID string,
	toolCallID string,
	action agentexecutionv1.ApprovalAction,
	comment string,
) (*workflowexecutionv1.WorkflowExecution, error) {
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	client := workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	input := &workflowexecutionv1.SubmitWorkflowApprovalInput{
		ExecutionId: executionID,
		ToolCallId:  toolCallID,
		Action:      action,
		Comment:     comment,
	}

	execution, err := client.SubmitApproval(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to submit workflow approval: %w", err)
	}

	return execution, nil
}

// SubmitAgentApproval submits an approval decision via the AgentExecution API.
// This directly resumes the agent execution.
func SubmitAgentApproval(
	serverPort int,
	executionID string,
	toolCallID string,
	action agentexecutionv1.ApprovalAction,
) (*agentexecutionv1.AgentExecution, error) {
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	client := agentexecutionv1.NewAgentExecutionCommandControllerClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	input := &agentexecutionv1.SubmitApprovalInput{
		AgentExecutionId: executionID,
		ToolCallId:       toolCallID,
		Action:           action,
	}

	execution, err := client.SubmitApproval(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to submit agent approval: %w", err)
	}

	return execution, nil
}

// =============================================================================
// WAIT HELPERS WITH STREAMING SUPPORT
// =============================================================================

// WaitForPendingApproval waits until the workflow execution has a populated pending_approval.
// Uses streaming RPC for real-time updates. Returns the execution when pending_approval is set.
func WaitForPendingApproval(
	serverPort int,
	executionID string,
	timeout time.Duration,
) (*workflowexecutionv1.WorkflowExecution, error) {
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to subscribe to workflow execution stream: %w", err)
	}

	for {
		execution, err := stream.Recv()

		if err == io.EOF {
			return nil, fmt.Errorf("stream closed before pending_approval was populated")
		}

		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return nil, fmt.Errorf("timeout waiting for pending_approval after %v", timeout)
			}
			return nil, fmt.Errorf("error receiving from execution stream: %w", err)
		}

		// Check if pending_approval is populated
		if execution.Status != nil && execution.Status.PendingApproval != nil {
			if execution.Status.PendingApproval.ToolCallId != "" {
				return execution, nil
			}
		}

		// Check for terminal states (shouldn't happen before approval)
		if execution.Status != nil {
			switch execution.Status.Phase {
			case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
				return execution, fmt.Errorf("execution failed before reaching approval state")
			case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
				return execution, fmt.Errorf("execution completed without requiring approval")
			case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
				return execution, fmt.Errorf("execution was cancelled")
			}
		}
	}
}

// WaitForApprovalCleared waits until the workflow execution's pending_approval is cleared.
// Uses streaming RPC for real-time updates.
func WaitForApprovalCleared(
	serverPort int,
	executionID string,
	timeout time.Duration,
) (*workflowexecutionv1.WorkflowExecution, error) {
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to subscribe to workflow execution stream: %w", err)
	}

	for {
		execution, err := stream.Recv()

		if err == io.EOF {
			return nil, fmt.Errorf("stream closed before pending_approval was cleared")
		}

		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return nil, fmt.Errorf("timeout waiting for pending_approval to clear after %v", timeout)
			}
			return nil, fmt.Errorf("error receiving from execution stream: %w", err)
		}

		// Check if pending_approval is cleared (nil or empty tool_call_id)
		if execution.Status != nil {
			pendingApproval := execution.Status.PendingApproval
			if pendingApproval == nil || pendingApproval.ToolCallId == "" {
				return execution, nil
			}
		}
	}
}

// WaitForWorkflowExecutionTerminal waits for the workflow to reach a terminal state.
// Returns the execution and whether it completed successfully.
func WaitForWorkflowExecutionTerminal(
	serverPort int,
	executionID string,
	timeout time.Duration,
) (*workflowexecutionv1.WorkflowExecution, bool, error) {
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, false, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, false, fmt.Errorf("failed to subscribe to workflow execution stream: %w", err)
	}

	for {
		execution, err := stream.Recv()

		if err == io.EOF {
			return nil, false, fmt.Errorf("stream closed before terminal state reached")
		}

		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return nil, false, fmt.Errorf("timeout waiting for terminal state after %v", timeout)
			}
			return nil, false, fmt.Errorf("error receiving from execution stream: %w", err)
		}

		if execution.Status != nil {
			switch execution.Status.Phase {
			case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
				return execution, true, nil
			case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
				return execution, false, nil
			case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
				return execution, false, fmt.Errorf("execution was cancelled")
			}
		}
	}
}

// WaitForAgentExecutionPhase waits for an agent execution to reach a specific phase.
func WaitForAgentExecutionPhase(
	serverPort int,
	executionID string,
	targetPhase agentexecutionv1.ExecutionPhase,
	timeout time.Duration,
) (*agentexecutionv1.AgentExecution, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		execution, err := GetAgentExecutionViaAPI(serverPort, executionID)
		if err != nil {
			time.Sleep(ApprovalPollingInterval)
			continue
		}

		if execution.Status != nil && execution.Status.Phase == targetPhase {
			return execution, nil
		}

		// Check for terminal failed state
		if execution.Status != nil && execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
			return execution, fmt.Errorf("execution failed (target phase was %s)", targetPhase.String())
		}

		time.Sleep(ApprovalPollingInterval)
	}

	return nil, fmt.Errorf("timeout waiting for agent execution to reach phase %s", targetPhase.String())
}

// =============================================================================
// VERIFICATION HELPERS
// =============================================================================

// VerifyPendingApprovalFields validates all fields of a PendingApproval message.
// Ensures the approval request has all required fields populated correctly.
func VerifyPendingApprovalFields(
	t *testing.T,
	approval *agentexecutionv1.PendingApproval,
	expectedToolName string,
) {
	require.NotNil(t, approval, "PendingApproval should not be nil")

	assert.NotEmpty(t, approval.ToolCallId, "tool_call_id should be set")
	assert.Equal(t, expectedToolName, approval.ToolName, "tool_name should match expected")
	assert.NotEmpty(t, approval.Message, "approval message should be set")
	assert.NotNil(t, approval.RequestedAt, "requested_at should be set")

	t.Logf("✓ PendingApproval fields verified:")
	t.Logf("  - tool_call_id: %s", approval.ToolCallId)
	t.Logf("  - tool_name: %s", approval.ToolName)
	t.Logf("  - message: %s", approval.Message)
	t.Logf("  - requested_at: %v", approval.RequestedAt)

	if approval.ChildAgentExecutionId != "" {
		t.Logf("  - child_agent_execution_id: %s", approval.ChildAgentExecutionId)
	}
}

// VerifyWorkflowPendingApprovalFields validates PendingApproval at the workflow level.
// Also verifies child_agent_execution_id is set for workflow-level approvals.
func VerifyWorkflowPendingApprovalFields(
	t *testing.T,
	approval *agentexecutionv1.PendingApproval,
	expectedToolName string,
) {
	VerifyPendingApprovalFields(t, approval, expectedToolName)

	// Workflow-level approvals must have child_agent_execution_id for forwarding
	assert.NotEmpty(t, approval.ChildAgentExecutionId,
		"child_agent_execution_id should be set for workflow-level approval")

	t.Logf("✓ Workflow-level approval verified with child_agent_execution_id: %s",
		approval.ChildAgentExecutionId)
}

// VerifyToolCallApprovalStatus verifies a tool call has the expected approval status.
// Searches through messages to find the tool call and validates its state.
func VerifyToolCallApprovalStatus(
	t *testing.T,
	execution *agentexecutionv1.AgentExecution,
	toolCallID string,
	expectedStatus agentexecutionv1.ToolCallStatus,
	expectedAction agentexecutionv1.ApprovalAction,
) {
	require.NotNil(t, execution, "Execution should not be nil")
	require.NotNil(t, execution.Status, "Execution status should not be nil")

	// Search for the tool call in the execution status
	var foundToolCall *agentexecutionv1.ToolCall
	for _, toolCall := range execution.Status.ToolCalls {
		if toolCall.Id == toolCallID {
			foundToolCall = toolCall
			break
		}
	}

	// Also search in messages (tool calls are also referenced there)
	if foundToolCall == nil {
		for _, msg := range execution.Status.Messages {
			for _, toolCall := range msg.ToolCalls {
				if toolCall.Id == toolCallID {
					foundToolCall = toolCall
					break
				}
			}
			if foundToolCall != nil {
				break
			}
		}
	}

	require.NotNil(t, foundToolCall, "Tool call with ID %s not found in execution", toolCallID)

	assert.Equal(t, expectedStatus, foundToolCall.Status,
		"Tool call status should be %s", expectedStatus.String())
	assert.Equal(t, expectedAction, foundToolCall.ApprovalAction,
		"Tool call approval_action should be %s", expectedAction.String())

	t.Logf("✓ Tool call %s verified: status=%s, approval_action=%s",
		toolCallID, foundToolCall.Status.String(), foundToolCall.ApprovalAction.String())
}

// VerifyApprovalCleared verifies that pending_approval is cleared after approval submission.
func VerifyApprovalCleared(t *testing.T, execution *workflowexecutionv1.WorkflowExecution) {
	require.NotNil(t, execution, "Execution should not be nil")
	require.NotNil(t, execution.Status, "Execution status should not be nil")

	// pending_approval should be nil or have empty tool_call_id
	if execution.Status.PendingApproval != nil {
		assert.Empty(t, execution.Status.PendingApproval.ToolCallId,
			"pending_approval.tool_call_id should be empty after approval")
	}

	t.Logf("✓ pending_approval cleared successfully")
}

// VerifyWorkflowTaskStatus verifies a specific task has the expected status.
func VerifyWorkflowTaskStatus(
	t *testing.T,
	execution *workflowexecutionv1.WorkflowExecution,
	taskName string,
	expectedStatus workflowexecutionv1.WorkflowTaskStatus,
) {
	require.NotNil(t, execution, "Execution should not be nil")
	require.NotNil(t, execution.Status, "Execution status should not be nil")
	require.NotNil(t, execution.Status.Tasks, "Tasks should not be nil")

	var foundTask *workflowexecutionv1.WorkflowTaskExecutionStatus
	for _, task := range execution.Status.Tasks {
		if task.Name == taskName {
			foundTask = task
			break
		}
	}

	require.NotNil(t, foundTask, "Task %s not found in execution", taskName)
	assert.Equal(t, expectedStatus, foundTask.Status,
		"Task %s status should be %s, got %s", taskName, expectedStatus.String(), foundTask.Status.String())

	t.Logf("✓ Task %s verified: status=%s", taskName, foundTask.Status.String())
}

// VerifyWorkflowCompletedSuccessfully verifies the workflow completed without errors.
func VerifyWorkflowCompletedSuccessfully(t *testing.T, execution *workflowexecutionv1.WorkflowExecution) {
	require.NotNil(t, execution, "Execution should not be nil")
	require.NotNil(t, execution.Status, "Execution status should not be nil")

	assert.Equal(t, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase,
		"Workflow should be in COMPLETED phase")
	assert.Empty(t, execution.Status.Error, "Workflow should have no error")

	t.Logf("✓ Workflow completed successfully: phase=%s", execution.Status.Phase.String())
}

// VerifyWorkflowFailed verifies the workflow failed with an expected error pattern.
func VerifyWorkflowFailed(t *testing.T, execution *workflowexecutionv1.WorkflowExecution, errorContains string) {
	require.NotNil(t, execution, "Execution should not be nil")
	require.NotNil(t, execution.Status, "Execution status should not be nil")

	assert.Equal(t, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, execution.Status.Phase,
		"Workflow should be in FAILED phase")

	if errorContains != "" {
		assert.Contains(t, execution.Status.Error, errorContains,
			"Error message should contain '%s'", errorContains)
	}

	t.Logf("✓ Workflow failed as expected: phase=%s, error=%s",
		execution.Status.Phase.String(), execution.Status.Error)
}

// =============================================================================
// LATENCY MEASUREMENT HELPERS
// =============================================================================

// LatencyMeasurement holds timestamps for signal latency calculation
type LatencyMeasurement struct {
	AgentApprovalTime    time.Time
	WorkflowApprovalTime time.Time
	Latency              time.Duration
}

// MeasureSignalLatency measures the time between agent entering WAITING_FOR_APPROVAL
// and workflow pending_approval being populated. Returns the latency measurement.
func MeasureSignalLatency(
	t *testing.T,
	serverPort int,
	workflowExecutionID string,
	agentExecutionID string,
	timeout time.Duration,
) (*LatencyMeasurement, error) {
	// We need to poll both executions to capture the timestamps
	// Since we're measuring after the fact, we'll use the requested_at timestamp
	// from the pending_approval

	// Wait for workflow pending_approval to be populated
	workflowExec, err := WaitForPendingApproval(serverPort, workflowExecutionID, timeout)
	if err != nil {
		return nil, fmt.Errorf("failed to wait for workflow pending_approval: %w", err)
	}

	// Get the workflow pending_approval timestamp
	if workflowExec.Status == nil || workflowExec.Status.PendingApproval == nil {
		return nil, fmt.Errorf("workflow pending_approval not populated")
	}

	workflowApprovalTime := workflowExec.Status.PendingApproval.RequestedAt.AsTime()

	// Get the agent execution to compare timestamps
	agentExec, err := GetAgentExecutionViaAPI(serverPort, agentExecutionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get agent execution: %w", err)
	}

	if agentExec.Status == nil || agentExec.Status.PendingApproval == nil {
		return nil, fmt.Errorf("agent pending_approval not populated")
	}

	agentApprovalTime := agentExec.Status.PendingApproval.RequestedAt.AsTime()

	// Calculate latency (workflow time should be after or equal to agent time)
	latency := workflowApprovalTime.Sub(agentApprovalTime)

	measurement := &LatencyMeasurement{
		AgentApprovalTime:    agentApprovalTime,
		WorkflowApprovalTime: workflowApprovalTime,
		Latency:              latency,
	}

	t.Logf("✓ Signal latency measured: %v", latency)
	t.Logf("  - Agent approval time: %v", agentApprovalTime)
	t.Logf("  - Workflow approval time: %v", workflowApprovalTime)

	return measurement, nil
}

// VerifySignalLatencyBelowThreshold verifies the signal latency is below the threshold.
func VerifySignalLatencyBelowThreshold(t *testing.T, measurement *LatencyMeasurement, threshold time.Duration) {
	require.NotNil(t, measurement, "Latency measurement should not be nil")

	// Latency could be negative if clocks are slightly out of sync
	// We check the absolute value
	absLatency := measurement.Latency
	if absLatency < 0 {
		absLatency = -absLatency
	}

	assert.LessOrEqual(t, absLatency, threshold,
		"Signal latency %v should be below threshold %v", absLatency, threshold)

	t.Logf("✓ Signal latency %v is below threshold %v", absLatency, threshold)
}

// =============================================================================
// WORKFLOW RUN HELPERS (APPROVAL-SPECIFIC)
// =============================================================================

// RunApprovalTestWorkflow runs the HITL approval test workflow and returns the execution ID.
func RunApprovalTestWorkflow(t *testing.T, serverPort int) *ApprovalRunResult {
	t.Logf("Running HITL approval test workflow: %s", ApprovalTestWorkflowName)

	output, err := RunCLIWithServerAddr(serverPort, "run", ApprovalTestWorkflowName)
	require.NoError(t, err, "Run command should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractExecutionIDFromOutput(t, output)
	require.NotEmpty(t, executionID, "Should be able to extract execution ID from output")

	t.Logf("✓ Workflow execution created: %s", executionID)

	return &ApprovalRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}

// RunMultiAgentWorkflow runs the multi-agent workflow and returns the execution ID.
func RunMultiAgentWorkflow(t *testing.T, serverPort int) *ApprovalRunResult {
	t.Logf("Running multi-agent workflow: %s", ApprovalMultiAgentWorkflowName)

	output, err := RunCLIWithServerAddr(serverPort, "run", ApprovalMultiAgentWorkflowName)
	require.NoError(t, err, "Run command should succeed")

	t.Logf("Run command output:\n%s", output)

	executionID := extractExecutionIDFromOutput(t, output)
	require.NotEmpty(t, executionID, "Should be able to extract execution ID from output")

	t.Logf("✓ Multi-agent workflow execution created: %s", executionID)

	return &ApprovalRunResult{
		ExecutionID: executionID,
		Output:      output,
	}
}
