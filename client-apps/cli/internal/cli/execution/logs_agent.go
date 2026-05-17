package execution

import (
	"context"
	"fmt"
	"io"

	"github.com/fatih/color"
	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// AgentLogsOptions contains options for viewing agent execution logs.
type AgentLogsOptions struct {
	ExecutionID string
	Follow      bool
	Client      *stigmer.Client
}

// AgentLogs fetches and displays agent execution logs.
func AgentLogs(opts *AgentLogsOptions) error {
	if opts.Follow {
		return streamAgentExecution(opts)
	}
	return fetchAgentExecutionMessages(opts)
}

func fetchAgentExecutionMessages(opts *AgentLogsOptions) error {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	exec, err := opts.Client.AgentExecution.Get(ctx, opts.ExecutionID)
	if err != nil {
		return errors.Wrapf(err, "failed to get agent execution '%s'", opts.ExecutionID)
	}

	messages := exec.GetStatus().GetMessages()
	if len(messages) == 0 {
		fmt.Println("No messages recorded for this execution.")
		return nil
	}

	for _, msg := range messages {
		renderAgentMessage(msg)
	}

	return nil
}

func streamAgentExecution(opts *AgentLogsOptions) error {
	ctx := context.Background()

	stream, err := opts.Client.AgentExecution.Subscribe(ctx, opts.ExecutionID)
	if err != nil {
		return errors.Wrapf(err, "failed to subscribe to agent execution '%s'", opts.ExecutionID)
	}

	var lastMsgCount int

	for {
		exec, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				fmt.Println("\n--- stream ended ---")
				return nil
			}
			return errors.Wrap(err, "agent execution stream error")
		}

		messages := exec.GetStatus().GetMessages()
		for i := lastMsgCount; i < len(messages); i++ {
			renderAgentMessage(messages[i])
		}
		lastMsgCount = len(messages)

		if isTerminalAgentPhase(exec.GetStatus().GetPhase()) {
			fmt.Printf("\n%s execution %s\n",
				color.New(color.FgHiBlack).Sprintf("[end]"),
				FormatPhase(exec.GetStatus().GetPhase()),
			)
			return nil
		}
	}
}

func renderAgentMessage(msg *agentexecutionv1.AgentMessage) {
	var label string
	var labelColor *color.Color

	switch msg.GetType() {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		label = "human"
		labelColor = color.New(color.FgBlue)
	case agentexecutionv1.MessageType_MESSAGE_AI:
		label = "ai"
		labelColor = color.New(color.FgGreen)
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		label = "tool"
		labelColor = color.New(color.FgCyan)
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		label = "system"
		labelColor = color.New(color.FgYellow)
	default:
		label = "unknown"
		labelColor = color.New(color.FgHiBlack)
	}

	content := msg.GetContent()
	if len(content) > 200 {
		content = content[:197] + "..."
	}

	fmt.Printf("[%s] %s\n", labelColor.Sprint(label), content)
}
