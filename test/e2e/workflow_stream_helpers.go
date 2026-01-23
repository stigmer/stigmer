//go:build e2e
// +build e2e

package e2e

import (
	"context"
	"fmt"
	"io"
	"testing"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// WaitForWorkflowExecutionCompletionViaStream subscribes to execution updates via streaming RPC
// and waits for completion. This is more efficient than polling.
//
// Benefits over polling:
// - Real-time updates (no polling delay)
// - More efficient (single connection vs repeated requests)
// - Observes all phase transitions in real-time
// - Automatically closes when execution completes
func WaitForWorkflowExecutionCompletionViaStream(t *testing.T, serverPort int, executionID string, timeoutSeconds int) *workflowexecutionv1.WorkflowExecution {
	t.Logf("Subscribing to workflow execution stream (timeout: %ds)...", timeoutSeconds)

	// Create gRPC connection
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err, "Failed to connect to server")
	defer conn.Close()

	// Create query client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	// Subscribe to execution stream
	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	require.NoError(t, err, "Failed to subscribe to workflow execution stream")

	updateCount := 0
	var lastPhase workflowexecutionv1.ExecutionPhase

	// Receive updates from stream
	for {
		execution, err := stream.Recv()

		// Check for stream end
		if err == io.EOF {
			// Stream closed - this should only happen after terminal state
			t.Logf("   ✓ Stream closed after %d updates", updateCount)
			require.FailNow(t, "Stream closed before execution reached terminal state")
		}

		// Check for other errors
		if err != nil {
			require.NoError(t, err, "Error receiving from execution stream")
		}

		updateCount++

		// Extract current phase
		if execution.Status == nil {
			continue // Wait for status to be populated
		}

		currentPhase := execution.Status.Phase

		// Log phase transitions
		if currentPhase != lastPhase {
			t.Logf("   [Update %d] Phase transition: %s → %s",
				updateCount, lastPhase.String(), currentPhase.String())
			lastPhase = currentPhase
		} else {
			t.Logf("   [Update %d] Phase: %s (in progress)", updateCount, currentPhase.String())
		}

		// Check for terminal states
		switch currentPhase {
		case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
			t.Logf("   ✓ Workflow execution completed successfully after %d updates", updateCount)
			return execution

		case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
			t.Logf("   ❌ Workflow execution FAILED after %d updates", updateCount)
			if execution.Status.Error != "" {
				t.Logf("   Error: %s", execution.Status.Error)
			}
			require.FailNow(t, fmt.Sprintf("workflow execution failed (phase: %s)", currentPhase.String()))

		case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
			t.Logf("   ⚠️  Workflow execution was cancelled after %d updates", updateCount)
			require.FailNow(t, "workflow execution was cancelled")

		default:
			// Still in progress (PENDING or IN_PROGRESS), continue receiving
			continue
		}
	}
}

// WaitForWorkflowExecutionPhaseViaStream subscribes to execution updates and waits for a specific phase.
// Returns error instead of failing immediately, allowing test code to handle errors.
func WaitForWorkflowExecutionPhaseViaStream(serverPort int, executionID string, targetPhase workflowexecutionv1.ExecutionPhase, timeout time.Duration) (*workflowexecutionv1.WorkflowExecution, error) {
	// Create gRPC connection
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create query client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Subscribe to execution stream
	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to subscribe to workflow execution stream: %w", err)
	}

	// Receive updates from stream
	for {
		execution, err := stream.Recv()

		// Check for stream end
		if err == io.EOF {
			return nil, fmt.Errorf("stream closed before reaching target phase %s", targetPhase.String())
		}

		// Check for context timeout
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return nil, fmt.Errorf("timeout waiting for execution to reach phase %s after %v", targetPhase.String(), timeout)
			}
			return nil, fmt.Errorf("error receiving from execution stream: %w", err)
		}

		// Check if we've reached target phase
		if execution.Status != nil && execution.Status.Phase == targetPhase {
			return execution, nil
		}

		// Check if execution failed (before reaching target phase)
		if execution.Status != nil && execution.Status.Phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED {
			return execution, fmt.Errorf("execution failed (target phase was %s)", targetPhase.String())
		}

		// Check if execution was cancelled
		if execution.Status != nil && execution.Status.Phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
			return execution, fmt.Errorf("execution was cancelled (target phase was %s)", targetPhase.String())
		}

		// Not there yet, continue receiving
	}
}
