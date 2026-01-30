package root

import (
	"context"
	"fmt"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/grpc"
)

// streamAgentExecutionLogs subscribes to execution updates and displays them in real-time
func streamAgentExecutionLogs(executionID string, conn *grpc.ClientConn) {
	cliprint.PrintSuccess("Streaming agent execution logs")
	fmt.Println()

	// Create streaming client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		cliprint.PrintError("Failed to subscribe to execution: %v", err)
		return
	}

	// Track last displayed phase
	var lastPhase agentexecutionv1.ExecutionPhase
	messageCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			// Stream ended
			if err.Error() == "EOF" {
				break
			}
			cliprint.PrintError("Stream error: %v", err)
			break
		}

		// Display phase changes
		if execution.Status.Phase != lastPhase {
			displayAgentPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase
		}

		// Display new messages
		for i := messageCount; i < len(execution.Status.Messages); i++ {
			displayAgentMessage(execution.Status.Messages[i])
		}
		messageCount = len(execution.Status.Messages)

		// Check if execution reached terminal state
		if isTerminalAgentPhase(execution.Status.Phase) {
			displayAgentExecutionComplete(execution)
			break
		}
	}
}

// streamWorkflowExecutionLogs subscribes to workflow execution updates and displays them in real-time
func streamWorkflowExecutionLogs(executionID string, conn *grpc.ClientConn) {
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
		cliprint.PrintError("Failed to subscribe to execution: %v", err)
		return
	}

	// Track last displayed phase and tasks
	var lastPhase workflowexecutionv1.ExecutionPhase
	taskCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			// Stream ended
			if err.Error() == "EOF" {
				break
			}
			cliprint.PrintError("Stream error: %v", err)
			break
		}

		// Display phase changes
		if execution.Status.Phase != lastPhase {
			displayWorkflowPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase
		}

		// Display new tasks
		for i := taskCount; i < len(execution.Status.Tasks); i++ {
			displayWorkflowTask(execution.Status.Tasks[i])
		}
		taskCount = len(execution.Status.Tasks)

		// Check if execution reached terminal state
		if isTerminalWorkflowPhase(execution.Status.Phase) {
			displayWorkflowExecutionComplete(execution)
			break
		}
	}
}
