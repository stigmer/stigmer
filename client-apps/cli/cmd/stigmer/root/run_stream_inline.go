package root

import (
	"context"
	"fmt"
	"io"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// inlineRenderConfig configures the inline (non-TUI) event renderer.
type inlineRenderConfig struct {
	events            <-chan executiontui.Event
	approvalResponses chan<- executiontui.ApprovalResponse
	prompter          approval.Prompter
	defaultAction     approval.Action
	data              io.Writer // AI content (stdout)
	status            io.Writer // status/progress (stderr)
	sessionID         string
}

// inlineRenderer consumes execution events and renders them to the terminal
// without the Bubbletea alt-screen TUI. AI content flows to the data writer
// (stdout) while all status/progress goes to the status writer (stderr).
//
// This enables piping: `stigmer run agent x | process_output` captures only
// the agent's response, while progress and tool activity remain visible on
// the terminal via stderr.
type inlineRenderer struct {
	cfg inlineRenderConfig

	// AI streaming state — tracks incremental delta output so each render
	// only prints the bytes appended since the last delta event.
	inAIStream    bool
	streamedBytes int
}

// renderInline consumes events from the channel and renders them inline until
// a terminal event (DoneEvent or StreamErrorEvent) arrives. Returns the final
// phase string and any error message from the done event.
func renderInline(ctx context.Context, cfg inlineRenderConfig) (phase string, exitErr string) {
	r := &inlineRenderer{cfg: cfg}

	for {
		select {
		case <-ctx.Done():
			r.statusf("⚠ Stream cancelled\n")
			return "", "context cancelled"

		case event, ok := <-cfg.events:
			if !ok {
				return "", ""
			}

			done, p, e := r.handleEvent(ctx, event)
			if done {
				return p, e
			}
		}
	}
}

// handleEvent dispatches a single event to the appropriate render method.
// Returns (true, phase, error) when a terminal event is received.
func (r *inlineRenderer) handleEvent(ctx context.Context, event executiontui.Event) (done bool, phase string, exitErr string) {
	switch e := event.(type) {
	case executiontui.AIStreamStartEvent:
		r.renderAIStreamStart(e)
	case executiontui.AIStreamDeltaEvent:
		r.renderAIStreamDelta(e)
	case executiontui.AIStreamEndEvent:
		r.renderAIStreamEnd(e)
	case executiontui.AIMessageEvent:
		r.renderAIMessage(e)
	case executiontui.HumanMessageEvent:
		r.renderHumanMessage(e)
	case executiontui.ToolRunningEvent:
		r.renderToolRunning(e)
	case executiontui.ToolCompletedEvent:
		r.renderToolCompleted(e)
	case executiontui.ToolWaitingApprovalEvent:
		r.renderToolWaitingApproval(e)
	case executiontui.ToolStreamDeltaEvent:
		// Intentionally ignored in inline mode — the completed event
		// carries the final result. Streaming partial output to stderr
		// would produce excessive noise without scrollback management.
	case executiontui.SystemMessageEvent:
		r.renderSystemMessage(e)
	case executiontui.PhaseChangeEvent:
		r.renderPhaseChange(e)
	case executiontui.ApprovalNeededEvent:
		r.handleApproval(ctx, e)
	case executiontui.TodoUpdateEvent:
		r.renderTodoUpdate(e)
	case executiontui.SubAgentStartedEvent:
		r.renderSubAgentStarted(e)
	case executiontui.SubAgentCompletedEvent:
		r.renderSubAgentCompleted(e)
	case executiontui.DoneEvent:
		r.renderDone(e)
		return true, e.Phase, e.Error
	case executiontui.StreamErrorEvent:
		r.renderStreamError(e)
		return true, "", e.Err.Error()
	}
	return false, "", ""
}

// ---------------------------------------------------------------------------
// AI message rendering — content goes to data writer (stdout)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderAIStreamStart(e executiontui.AIStreamStartEvent) {
	r.finishAIStreamIfNeeded()
	prefix := r.agentPrefix(e.SubAgentID)
	fmt.Fprint(r.cfg.data, prefix)
	if len(e.Content) > 0 {
		fmt.Fprint(r.cfg.data, e.Content)
	}
	r.streamedBytes = len(e.Content)
	r.inAIStream = true
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamDelta(e executiontui.AIStreamDeltaEvent) {
	if len(e.Content) <= r.streamedBytes {
		return
	}
	fmt.Fprint(r.cfg.data, e.Content[r.streamedBytes:])
	r.streamedBytes = len(e.Content)
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamEnd(e executiontui.AIStreamEndEvent) {
	if len(e.Content) > r.streamedBytes {
		fmt.Fprint(r.cfg.data, e.Content[r.streamedBytes:])
	}
	fmt.Fprint(r.cfg.data, "\n\n")
	r.inAIStream = false
	r.streamedBytes = 0
	r.flushData()

	if len(e.ToolCalls) > 0 {
		r.renderToolCalls(e.ToolCalls)
	}
}

func (r *inlineRenderer) renderAIMessage(e executiontui.AIMessageEvent) {
	r.finishAIStreamIfNeeded()
	if e.Content != "" {
		fmt.Fprintf(r.cfg.data, "%s\n\n", formatNonTUIAIText(e.Content))
		r.flushData()
	}
	if len(e.ToolCalls) > 0 {
		r.renderToolCalls(e.ToolCalls)
	}
}

func (r *inlineRenderer) renderHumanMessage(e executiontui.HumanMessageEvent) {
	r.finishAIStreamIfNeeded()
	r.statusf("💬 You: %s\n\n", e.Content)
}

// ---------------------------------------------------------------------------
// Tool call rendering — status goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderToolRunning(e executiontui.ToolRunningEvent) {
	line := toolrender.RenderWithBadge(e.ToolCall, toolrender.StateBadge("running"))
	r.statusf("%s\n", line)
}

func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
	badge := toolrender.StateBadge(e.ToolCall.Status)
	line := toolrender.RenderWithBadge(e.ToolCall, badge)
	r.statusf("%s\n", line)
}

func (r *inlineRenderer) renderToolWaitingApproval(e executiontui.ToolWaitingApprovalEvent) {
	line := toolrender.RenderWithBadge(e.ToolCall, toolrender.StateBadge("waiting_approval"))
	r.statusf("%s\n", line)
}

func (r *inlineRenderer) renderToolCalls(toolCalls []toolrender.ToolCallInfo) {
	for _, tc := range toolCalls {
		r.statusf("%s\n", toolrender.Render(tc))
	}
	if len(toolCalls) > 0 {
		r.statusf("\n")
	}
}

// ---------------------------------------------------------------------------
// Status / lifecycle rendering — goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderSystemMessage(e executiontui.SystemMessageEvent) {
	content := sanitizeSystemContent(e.Content)
	r.statusf("%s\n\n", systemMsgStyle.Render("ℹ️  "+content))
}

func (r *inlineRenderer) renderPhaseChange(e executiontui.PhaseChangeEvent) {
	switch e.Phase {
	case "pending":
		r.statusf("⏳ Execution pending...\n")
	case "in_progress":
		if e.Previous == "waiting_for_approval" {
			r.statusf("▶️  Resumed after approval\n")
		} else {
			r.statusf("▶️  Execution started\n")
		}
	case "completed":
		r.statusf("✅ Execution completed\n")
	case "failed":
		r.statusf("❌ Execution failed\n")
	case "cancelled":
		r.statusf("⚠️  Execution cancelled\n")
	case "waiting_for_approval":
		// Suppressed: the approval prompt itself is the signal.
		return
	}
}

func (r *inlineRenderer) renderTodoUpdate(e executiontui.TodoUpdateEvent) {
	r.statusf("📋 Plan:\n")
	for _, todo := range e.Todos {
		var icon string
		switch todo.Status {
		case "completed":
			icon = "✓"
		case "in_progress":
			icon = "⏳"
		case "cancelled":
			icon = "⏭"
		default:
			icon = "○"
		}
		r.statusf("  %s %s\n", icon, todo.Content)
	}
	r.statusf("\n")
}

func (r *inlineRenderer) renderSubAgentStarted(e executiontui.SubAgentStartedEvent) {
	label := e.Name
	if e.Description != "" {
		label = e.Description
	}
	r.statusf("🔀 Sub-agent started: %s\n", label)
}

func (r *inlineRenderer) renderSubAgentCompleted(e executiontui.SubAgentCompletedEvent) {
	badge := "✓"
	if e.Status == "failed" {
		badge = "✗"
	}
	r.statusf("🔀 Sub-agent %s %s (%d tools)\n\n", e.ID, badge, e.ToolCount)
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderDone(e executiontui.DoneEvent) {
	r.finishAIStreamIfNeeded()
	if e.Error != "" {
		r.statusf("❌ %s\n", e.Error)
	}
}

func (r *inlineRenderer) renderStreamError(e executiontui.StreamErrorEvent) {
	r.finishAIStreamIfNeeded()
	r.statusf("❌ Stream error: %s\n", e.Err.Error())
	if r.cfg.sessionID != "" {
		r.statusf("   Re-attach with: stigmer run %s\n", r.cfg.sessionID)
	}
}

// ---------------------------------------------------------------------------
// Approval handling
// ---------------------------------------------------------------------------

func (r *inlineRenderer) handleApproval(ctx context.Context, e executiontui.ApprovalNeededEvent) {
	r.finishAIStreamIfNeeded()

	// Display approval context on stderr.
	r.statusf("\n⏸  Approval required: %s\n", e.ToolName)
	if e.FromSubAgent {
		r.statusf("   Sub-agent: %s\n", e.SubAgentName)
	}
	if e.Message != "" {
		r.statusf("   %s\n", e.Message)
	}
	if e.ArgsPreview != "" {
		r.statusf("   Args: %s\n", display.TruncateWithEllipsis(e.ArgsPreview, 200))
	}

	opts := approval.Options{
		ToolName:      e.ToolName,
		Message:       e.Message,
		ArgsPreview:   e.ArgsPreview,
		DefaultAction: r.cfg.defaultAction,
	}

	if r.cfg.defaultAction != approval.ActionUnspecified {
		opts.NonInteractive = true
	}

	decision, err := r.cfg.prompter.Prompt(ctx, opts)
	if err != nil {
		r.statusf("   ⚠ Approval prompt failed: %s — auto-skipping\n\n", err)
		r.cfg.approvalResponses <- executiontui.ApprovalResponse{
			Action:     "skip",
			ToolCallID: e.ToolCallID,
		}
		return
	}

	actionStr := actionToString(decision.Action)
	r.statusf("   → %s\n\n", decision.Action.String())

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     actionStr,
		ToolCallID: e.ToolCallID,
		Comment:    decision.Comment,
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// finishAIStreamIfNeeded closes an in-progress AI stream with a newline if
// a non-AI event arrives mid-stream. Prevents garbled output when status
// events interleave with streaming AI content.
func (r *inlineRenderer) finishAIStreamIfNeeded() {
	if r.inAIStream {
		fmt.Fprint(r.cfg.data, "\n\n")
		r.flushData()
		r.inAIStream = false
		r.streamedBytes = 0
	}
}

// agentPrefix returns the AI message prefix, adjusted for sub-agent context.
func (r *inlineRenderer) agentPrefix(subAgentID string) string {
	if subAgentID != "" {
		return "🤖 Sub-agent: "
	}
	return "🤖 Agent: "
}

func (r *inlineRenderer) statusf(format string, args ...interface{}) {
	fmt.Fprintf(r.cfg.status, format, args...)
	r.flushWriter(r.cfg.status)
}

func (r *inlineRenderer) flushData() {
	r.flushWriter(r.cfg.data)
}

func (r *inlineRenderer) flushWriter(w io.Writer) {
	if f, ok := w.(interface{ Sync() error }); ok {
		_ = f.Sync()
	}
}

// actionToString converts an approval.Action to the string expected by
// the ApprovalResponse channel and backend API.
func actionToString(a approval.Action) string {
	switch a {
	case approval.ActionApprove:
		return "approve"
	case approval.ActionSkip:
		return "skip"
	case approval.ActionReject:
		return "reject"
	default:
		return "skip"
	}
}
