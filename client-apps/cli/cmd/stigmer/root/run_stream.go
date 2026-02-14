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
// defaultAction is the --approve-default flag value; when set, non-TTY approvals
// are auto-resolved without prompting.
func streamAgentExecution(executionID string, prompter approval.Prompter, defaultAction approval.Action, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
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

	// Delta-based message renderer — streams AI content incrementally instead
	// of waiting for the complete message. See run_display_stream.go.
	renderer := newMessageStreamRenderer(os.Stdout)

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
			if err := handleAgentApprovalPrompt(ctx, conn, executionID, pendingApproval, prompter, defaultAction); err != nil {
				return nil, errors.Wrap(err, "agent approval failed")
			}
			lastPendingToolCallID = pendingApproval.ToolCallId
			sp.Start("Resuming after approval...")
		}

		// Render messages with delta-based streaming for AI content.
		// The renderer tracks which messages have been displayed and only prints
		// new content — including incremental token deltas for in-progress AI messages.
		rendered, streaming := renderer.render(execution.Status.Messages)
		if rendered {
			sp.Stop()
		}
		if rendered && !streaming {
			// Batch of complete messages finished — restart spinner while waiting.
			sp.Start("Agent is thinking...")
		}
		// When streaming is active, the spinner stays stopped: the flowing
		// text is the progress indicator.

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
// defaultAction is the --approve-default flag value; when set, non-TTY approvals
// are auto-resolved without prompting.
func streamWorkflowExecution(executionID string, prompter approval.Prompter, defaultAction approval.Action, conn *grpc.ClientConn) (*workflowexecutionv1.WorkflowExecution, error) {
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
			if err := handleWorkflowApprovalPrompt(ctx, conn, executionID, pendingApproval, prompter, defaultAction); err != nil {
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
