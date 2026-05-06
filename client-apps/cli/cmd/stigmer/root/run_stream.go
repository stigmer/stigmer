package root

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/pkg/errors"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// streamAgentExecution subscribes to execution updates and renders them
// using the selected output mode:
//
//   - OutputJSON: Newline-delimited JSON events on stdout for scripting/CI.
//   - OutputInline + TTY: Delegates to the @stigmer/ink renderer (Node.js).
//   - OutputInline + non-TTY: Minimal plain text output for piped scenarios.
//
// For the JSON and plain text paths, a background goroutine reads the gRPC
// stream and converts updates into events sent over a channel. The Ink path
// cancels this subscription immediately — Ink manages its own connection
// via @stigmer/react hooks.
func streamAgentExecution(sessionID string, headerInfo sessionHeaderInfo, executionID, orgID string, prompter approval.Prompter, defaultAction approval.Action, verbose bool, outputMode OutputMode, client *stigmer.Client, workspaceRoots []string, dataW, statusW io.Writer) (*agentexecutionv1.AgentExecution, error) {
	streamCtx, streamCancel := context.WithCancel(context.Background())

	subStream, err := client.AgentExecution.Subscribe(streamCtx, executionID)
	if err != nil {
		streamCancel()
		return nil, errors.Wrap(err, "failed to subscribe to agent execution")
	}

	events := make(chan executiontui.Event, 16)
	approvalResponses := make(chan executiontui.ApprovalResponse, 1)

	go streamToEvents(streamCtx, streamToEventsConfig{
		executionID:       executionID,
		sessionID:         sessionID,
		stream:            subStream,
		events:            events,
		approvalResponses: approvalResponses,
		client:            client,
	})

	switch {
	case outputMode == OutputJSON:
		renderSessionHeader(statusW, headerInfo)
		return streamAgentJSON(streamCtx, streamCancel, sessionID, executionID, events, approvalResponses, defaultAction, client)
	case termctl.IsSupported(statusW):
		// Interactive TTY: delegate to the Ink renderer.
		streamCancel()
		return streamAgentInk(sessionID, headerInfo, executionID, orgID, client)
	default:
		// Non-TTY piped output: minimal plain text renderer.
		return streamAgentPlainText(streamCtx, streamCancel, sessionID, headerInfo, executionID, events, approvalResponses, client, dataW, statusW)
	}
}

// streamAgentJSON renders events as newline-delimited JSON on stdout.
func streamAgentJSON(streamCtx context.Context, streamCancel context.CancelFunc, sessionID, executionID string, events chan executiontui.Event, approvalResponses chan executiontui.ApprovalResponse, defaultAction approval.Action, sdkClient *stigmer.Client) (*agentexecutionv1.AgentExecution, error) {
	phase, exitErr := renderJSON(streamCtx, jsonRenderConfig{
		events:            events,
		approvalResponses: approvalResponses,
		defaultAction:     defaultAction,
		data:              os.Stdout,
		status:            os.Stderr,
	})
	streamCancel()

	return streamAgentEpilogue(sessionID, executionID, phase, exitErr, sdkClient)
}

// streamAgentEpilogue fetches the final execution and prints a summary.
// Shared by all rendering paths.
func streamAgentEpilogue(sessionID, executionID, phase, exitErr string, sdkClient *stigmer.Client) (*agentexecutionv1.AgentExecution, error) {
	if exitErr != "" && phase == "" {
		return nil, errors.New(exitErr)
	}

	finalExec, err := fetchFinalExecution(context.Background(), sdkClient, executionID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to fetch final execution state")
	}

	usage := fetchExecutionUsage(context.Background(), sdkClient, finalExec.GetMetadata().GetId())

	if sessionID != "" {
		displaySessionExitLine(sessionID, finalExec, usage)
	} else {
		displayAgentExecutionComplete(finalExec, usage)
	}

	return finalExec, nil
}

func fetchFinalExecution(ctx context.Context, sdkClient *stigmer.Client, executionID string) (*agentexecutionv1.AgentExecution, error) {
	resp, err := sdkClient.AgentExecution.Get(ctx, executionID)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get agent execution")
	}
	return resp, nil
}

// streamWorkflowExecution subscribes to workflow execution updates and
// displays them in real-time with tool approval handling.
func streamWorkflowExecution(executionID string, prompter approval.Prompter, defaultAction approval.Action, client *stigmer.Client) (*workflowexecutionv1.WorkflowExecution, error) {
	climsg.Success("Streaming workflow execution logs")
	fmt.Println()

	ctx := context.Background()

	subStream, err := client.WorkflowExecution.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to subscribe to workflow execution")
	}

	sp := spinner.New(os.Stdout)
	sp.Start("Waiting for workflow...")
	defer sp.Stop()

	var lastPhase workflowexecutionv1.ExecutionPhase
	promptedToolCallIDs := make(map[string]bool)
	taskCount := 0

	for {
		execution, err := subStream.Recv()
		if err != nil {
			sp.Stop()
			if err == io.EOF {
				return nil, errors.New("workflow execution stream ended unexpectedly")
			}
			return nil, errors.Wrap(err, "workflow execution stream error")
		}

		if len(execution.Status.Tasks) > taskCount {
			sp.Stop()
			for i := taskCount; i < len(execution.Status.Tasks); i++ {
				displayWorkflowTask(execution.Status.Tasks[i])
			}
			taskCount = len(execution.Status.Tasks)
			sp.Start("Workflow running...")
		}

		for _, wpa := range execution.Status.GetPendingApprovals() {
			pa := wpa.GetApproval()
			if pa.GetToolCallId() == "" || promptedToolCallIDs[pa.GetToolCallId()] {
				continue
			}
			sp.Stop()
			if err := handleWorkflowApprovalPrompt(ctx, client, executionID, pa, prompter, defaultAction); err != nil {
				return nil, errors.Wrap(err, "workflow approval failed")
			}
			promptedToolCallIDs[pa.GetToolCallId()] = true
			sp.Start("Resuming after approval...")
		}

		if execution.Status.Phase != lastPhase {
			sp.Stop()
			displayWorkflowPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase

			if !isTerminalWorkflowPhase(lastPhase) {
				sp.Start(spinnerLabelForWorkflowPhase(lastPhase))
			}
		}

		if isTerminalWorkflowPhase(execution.Status.Phase) {
			sp.Stop()
			displayWorkflowExecutionComplete(execution)
			return execution, nil
		}
	}
}
