package execution

import (
	"fmt"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func renderAgentTrace(exec *agentexecutionv1.AgentExecution) {
	name := exec.GetMetadata().GetName()
	if name == "" {
		name = exec.GetMetadata().GetId()
	}

	phase := FormatPhase(exec.GetStatus().GetPhase())
	duration := calculateDuration(exec.GetStatus().GetStartedAt(), exec.GetStatus().GetCompletedAt())

	fmt.Println()
	fmt.Printf("Agent: %s (%s, %s)\n", name, phase, duration)
	fmt.Println()

	messages := exec.GetStatus().GetMessages()
	if len(messages) == 0 {
		fmt.Println("  (no messages recorded)")
		fmt.Println()
		return
	}

	toolCalls := extractToolCallSummary(messages)
	if len(toolCalls) == 0 {
		fmt.Printf("  %d message(s), no tool calls\n", len(messages))
		fmt.Println()
		return
	}

	for _, tc := range toolCalls {
		icon := color.GreenString("[done]")
		fmt.Printf("  %s %-25s  %s\n",
			icon,
			display.TruncateWithEllipsis(tc.name, 25),
			color.New(color.FgHiBlack).Sprint(display.TruncateWithEllipsis(tc.summary, 40)),
		)
	}

	fmt.Println()
}

type toolCallSummary struct {
	name    string
	summary string
}

func extractToolCallSummary(messages []*agentexecutionv1.AgentMessage) []toolCallSummary {
	var calls []toolCallSummary
	for _, msg := range messages {
		if msg.GetType() != agentexecutionv1.MessageType_MESSAGE_AI {
			continue
		}
		for _, tc := range msg.GetToolCalls() {
			name := tc.GetName()
			if name == "" {
				name = "tool_call"
			}
			summary := tc.GetResult()
			if len(summary) > 40 {
				summary = summary[:37] + "..."
			}
			calls = append(calls, toolCallSummary{name: name, summary: summary})
		}
	}
	return calls
}
