package root

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/pkg/errors"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// streamAgentPlainText is a minimal renderer for non-TTY output.
//
// When stdout is piped (e.g. `stigmer run agent | tee output.txt`), the
// full Ink renderer is inappropriate (ANSI codes, frame-by-frame rendering).
// This path writes clean AI text to dataW and brief tool summaries to statusW,
// using only fmt.Fprintf — no Bubble Tea, no Lip Gloss.
//
// Approvals are auto-skipped in non-TTY mode since there is no keyboard input.
// Use --json for a machine-readable non-TTY alternative with full event detail.
func streamAgentPlainText(
	streamCtx context.Context,
	streamCancel context.CancelFunc,
	sessionID string,
	headerInfo sessionHeaderInfo,
	executionID string,
	events chan executiontui.Event,
	approvalResponses chan executiontui.ApprovalResponse,
	client *stigmer.Client,
	dataW, statusW io.Writer,
) (*agentexecutionv1.AgentExecution, error) {
	renderSessionHeader(statusW, headerInfo)

	var lastPhase string
	for event := range events {
		switch e := event.(type) {
		case executiontui.AIStreamDeltaEvent:
			fmt.Fprint(dataW, e.Content)
		case executiontui.AIStreamEndEvent:
			fmt.Fprintln(dataW)
		case executiontui.AIMessageEvent:
			if e.Content != "" {
				fmt.Fprintln(dataW, e.Content)
			}
		case executiontui.HumanMessageEvent:
			fmt.Fprintf(statusW, "\n> %s\n\n", e.Content)

		case executiontui.ToolRunningEvent:
			fmt.Fprintf(statusW, "  ⠋ %s\n", e.ToolCall.Name)
		case executiontui.ToolCompletedEvent:
			tc := e.ToolCall
			if tc.Error != "" {
				fmt.Fprintf(statusW, "  ✗ %s: %s\n", tc.Name, truncate(tc.Error, 100))
			} else {
				fmt.Fprintf(statusW, "  ✓ %s\n", tc.Name)
			}

		case executiontui.ApprovalNeededEvent:
			fmt.Fprintf(statusW, "  ⚠ Approval needed: %s (auto-skipped in non-TTY mode)\n", e.ToolName)
			approvalResponses <- executiontui.ApprovalResponse{
				ToolCallID: e.ToolCallID,
				Action:     "skip",
			}

		case executiontui.PhaseChangeEvent:
			lastPhase = e.Phase

		case executiontui.SubAgentStartedEvent:
			label := e.Description
			if label == "" {
				label = e.Name
			}
			fmt.Fprintf(statusW, "  ↳ Sub-agent: %s\n", label)
		case executiontui.SubAgentCompletedEvent:
			fmt.Fprintf(statusW, "  ✓ Sub-agent completed: %s\n", e.ID)

		case executiontui.ContextCompactedEvent:
			fmt.Fprintf(statusW, "  … Context compacted (%dK → %dK tokens)\n", e.TokensBefore/1000, e.TokensAfter/1000)

		case executiontui.SystemMessageEvent:
			fmt.Fprintf(statusW, "[system] %s\n", e.Content)

		case executiontui.DoneEvent:
			lastPhase = e.Phase
		case executiontui.StreamErrorEvent:
			return nil, errors.Wrap(e.Err, "execution stream error")
		}
	}

	streamCancel()
	return streamAgentEpilogue(sessionID, executionID, lastPhase, "", client)
}

func truncate(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}
