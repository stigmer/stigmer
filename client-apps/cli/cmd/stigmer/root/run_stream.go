package root

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/pkg/errors"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"google.golang.org/grpc"
)

// streamAgentExecution subscribes to execution updates and displays them in real-time.
// It handles approval prompts inline and returns the final execution state when
// the execution reaches a terminal phase.
//
// The prompter is injected to support both interactive (TTY) and non-interactive (CI) modes.
func streamAgentExecution(executionID string, prompter approval.Prompter, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	cliprint.PrintSuccess("Streaming agent execution logs")
	fmt.Println()

	// Create streaming client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		return nil, errors.Wrap(err, "failed to subscribe to agent execution")
	}

	// Activity spinner — shows progress between streaming updates.
	// Deferred Stop ensures cleanup on error exits.
	sp := spinner.New(os.Stdout)
	sp.Start("Waiting for agent...")
	defer sp.Stop()

	// Track last displayed phase and approval state
	var lastPhase agentexecutionv1.ExecutionPhase
	var lastPendingToolCallID string
	messageCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			sp.Stop()
			if err == io.EOF {
				return nil, errors.New("agent execution stream ended unexpectedly")
			}
			return nil, errors.Wrap(err, "agent execution stream error")
		}

		// Display phase changes
		if execution.Status.Phase != lastPhase {
			sp.Stop()
			displayAgentPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase

			if !isTerminalAgentPhase(lastPhase) {
				sp.Start(spinnerLabelForAgentPhase(lastPhase))
			}
		}

		// Handle approval flow when entering WAITING_FOR_APPROVAL
		if needsAgentApprovalPrompt(
			execution.Status.Phase,
			execution.Status.GetPendingApproval(),
			lastPendingToolCallID,
		) {
			sp.Stop()
			pendingApproval := execution.Status.GetPendingApproval()
			if err := handleAgentApprovalPrompt(ctx, conn, executionID, pendingApproval, prompter); err != nil {
				return nil, errors.Wrap(err, "agent approval failed")
			}
			lastPendingToolCallID = pendingApproval.ToolCallId
			sp.Start("Resuming after approval...")
		}

		// Display new messages
		if len(execution.Status.Messages) > messageCount {
			sp.Stop()
			for i := messageCount; i < len(execution.Status.Messages); i++ {
				displayAgentMessage(execution.Status.Messages[i])
			}
			messageCount = len(execution.Status.Messages)
			sp.Start("Agent is thinking...")
		}

		// Check if execution reached terminal state
		if isTerminalAgentPhase(execution.Status.Phase) {
			sp.Stop()
			displayAgentExecutionComplete(execution)
			return execution, nil
		}
	}
}

// streamWorkflowExecution subscribes to workflow execution updates and displays them in real-time.
// When a child agent execution requires approval, it prompts the user for a decision
// and submits it via the workflow API (which forwards to the child agent).
//
// The prompter is injected to support both interactive (TTY) and non-interactive (CI) modes.
func streamWorkflowExecution(executionID string, prompter approval.Prompter, conn *grpc.ClientConn) (*workflowexecutionv1.WorkflowExecution, error) {
	cliprint.PrintSuccess("Streaming workflow execution logs")
	fmt.Println()

	// Create streaming client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to subscribe to workflow execution")
	}

	// Activity spinner — shows progress between streaming updates.
	sp := spinner.New(os.Stdout)
	sp.Start("Waiting for workflow...")
	defer sp.Stop()

	// Track last displayed phase, tasks, and approval state
	var lastPhase workflowexecutionv1.ExecutionPhase
	var lastPendingToolCallID string
	taskCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			sp.Stop()
			if err == io.EOF {
				return nil, errors.New("workflow execution stream ended unexpectedly")
			}
			return nil, errors.Wrap(err, "workflow execution stream error")
		}

		// Display phase changes
		if execution.Status.Phase != lastPhase {
			sp.Stop()
			displayWorkflowPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase

			if !isTerminalWorkflowPhase(lastPhase) {
				sp.Start(spinnerLabelForWorkflowPhase(lastPhase))
			}
		}

		// Handle approval flow when child agent requires approval
		// Workflows surface approvals via PendingApproval field (populated by child agent signal)
		if needsWorkflowApprovalPrompt(
			execution.Status.GetPendingApproval(),
			lastPendingToolCallID,
		) {
			sp.Stop()
			pendingApproval := execution.Status.GetPendingApproval()
			if err := handleWorkflowApprovalPrompt(ctx, conn, executionID, pendingApproval, prompter); err != nil {
				return nil, errors.Wrap(err, "workflow approval failed")
			}
			lastPendingToolCallID = pendingApproval.ToolCallId
			sp.Start("Resuming after approval...")
		}

		// Display new tasks
		if len(execution.Status.Tasks) > taskCount {
			sp.Stop()
			for i := taskCount; i < len(execution.Status.Tasks); i++ {
				displayWorkflowTask(execution.Status.Tasks[i])
			}
			taskCount = len(execution.Status.Tasks)
			sp.Start("Workflow running...")
		}

		// Check if execution reached terminal state
		if isTerminalWorkflowPhase(execution.Status.Phase) {
			sp.Stop()
			displayWorkflowExecutionComplete(execution)
			return execution, nil
		}
	}
}
