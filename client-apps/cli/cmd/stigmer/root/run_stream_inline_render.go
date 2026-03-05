package root

import (
	"fmt"
	"io"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

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
	if !r.inAIStream {
		return
	}
	if len(e.Content) <= r.streamedBytes {
		return
	}
	fmt.Fprint(r.cfg.data, e.Content[r.streamedBytes:])
	r.streamedBytes = len(e.Content)
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamEnd(e executiontui.AIStreamEndEvent) {
	if !r.inAIStream {
		r.streamedBytes = 0
		return
	}
	if len(e.Content) > r.streamedBytes {
		fmt.Fprint(r.cfg.data, e.Content[r.streamedBytes:])
	}
	fmt.Fprint(r.cfg.data, "\n\n")
	r.inAIStream = false
	r.streamedBytes = 0
	r.flushData()
}

func (r *inlineRenderer) renderAIMessage(e executiontui.AIMessageEvent) {
	r.finishAIStreamIfNeeded()
	if e.Content != "" {
		prefix := r.agentPrefix(e.SubAgentID)
		fmt.Fprintf(r.cfg.data, "%s%s\n\n", prefix, formatNonTUIAIText(e.Content))
		r.flushData()
	}
}

func (r *inlineRenderer) renderHumanMessage(e executiontui.HumanMessageEvent) {
	if r.cfg.suppressHumanEcho {
		r.cfg.suppressHumanEcho = false
		return
	}
	r.finishAIStreamIfNeeded()
	r.statusf("%s\n\n", formatHumanMessage(e.Content))
}

// ---------------------------------------------------------------------------
// Tool call rendering — status goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
	line := toolrender.RenderCompact(e.ToolCall, r.compactOpts)
	if e.SubAgentID != "" {
		line = toolrender.GutterWrap(line)
	}
	r.statusf("%s\n", line)
	if strings.Contains(line, "\n") {
		r.statusf("\n")
	}
}

func (r *inlineRenderer) renderToolWaitingApproval(e executiontui.ToolWaitingApprovalEvent) {
	contentStreamed := e.ToolCallID == r.activeStreamToolID
	streamedRows := 0
	if contentStreamed {
		streamedRows = r.streamLineCount
		r.clearStreamingState()
	}
	r.waitingApproval = &waitingApprovalState{
		tc:              e.ToolCall,
		subAgentID:      e.SubAgentID,
		contentStreamed: contentStreamed,
		streamedRows:    streamedRows,
	}
}

// ---------------------------------------------------------------------------
// Status / lifecycle rendering — goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderSystemMessage(e executiontui.SystemMessageEvent) {
	content := sanitizeSystemContent(e.Content)
	r.statusf("%s\n\n", systemMsgStyle.Render(content))
}

func (r *inlineRenderer) renderPhaseChange(e executiontui.PhaseChangeEvent) {
	r.phase = e.Phase
	switch e.Phase {
	case "failed":
		r.statusf("Execution failed\n")
	case "cancelled":
		r.statusf("Execution cancelled\n")
	default:
		return
	}
}

func (r *inlineRenderer) renderTodoUpdate(e executiontui.TodoUpdateEvent) {
	r.statusf("Plan:\n")
	for _, todo := range e.Todos {
		var marker string
		switch todo.Status {
		case "completed":
			marker = "[x]"
		case "in_progress":
			marker = "[-]"
		case "cancelled":
			marker = "[~]"
		default:
			marker = "[ ]"
		}
		r.statusf("  %s %s\n", marker, todo.Content)
	}
	r.statusf("\n")
}

func (r *inlineRenderer) renderSubAgentStarted(e executiontui.SubAgentStartedEvent) {
	label := e.Name
	if e.Description != "" {
		label = e.Description
	}
	r.statusf("%s %s: %s\n",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Task"), label)
}

func (r *inlineRenderer) renderSubAgentCompleted(e executiontui.SubAgentCompletedEvent) {
	if e.Status == "failed" {
		r.statusf("  ✗ Failed (%d tools)\n\n", e.ToolCount)
	} else {
		r.statusf("  ✓ Done (%d tools)\n\n", e.ToolCount)
	}
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderDone(e executiontui.DoneEvent) {
	r.finishAIStreamIfNeeded()
	if e.Error != "" {
		r.statusf("Error: %s\n", e.Error)
	}
}

func (r *inlineRenderer) renderStreamError(e executiontui.StreamErrorEvent) {
	r.finishAIStreamIfNeeded()
	r.statusf("Error: %s\n", e.Err.Error())
	if r.cfg.sessionID != "" {
		r.statusf("   Re-attach with: stigmer run %s\n", r.cfg.sessionID)
	}
}

// ---------------------------------------------------------------------------
// Read grouping
// ---------------------------------------------------------------------------

// flushPendingReads renders any buffered read tool completions. When the buffer
// contains readGroupThreshold or more reads, they are rendered as a compact
// group. Otherwise, each read is rendered individually.
//
// All pending reads share the same sub-agent context (events don't interleave
// across agents), so checking the first entry's subAgentID is sufficient to
// determine whether gutter-wrapping is needed.
func (r *inlineRenderer) flushPendingReads() {
	if len(r.pendingReads) == 0 {
		return
	}
	r.finishAIStreamIfNeeded()

	subAgentID := r.pendingReads[0].subAgentID
	tcs := make([]toolrender.ToolCallInfo, len(r.pendingReads))
	for i, pr := range r.pendingReads {
		tcs[i] = pr.tc
	}

	var output string
	if len(tcs) >= readGroupThreshold {
		output = toolrender.RenderReadGroup(tcs, r.compactOpts)
	} else {
		var lines []string
		for _, tc := range tcs {
			lines = append(lines, toolrender.RenderCompact(tc, r.compactOpts))
		}
		output = strings.Join(lines, "\n")
	}

	if subAgentID != "" {
		output = toolrender.GutterWrap(output)
	}
	r.statusf("%s\n", output)
	if strings.Contains(output, "\n") {
		r.statusf("\n")
	}
	r.pendingReads = r.pendingReads[:0]
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
// Main-agent messages get a plain bullet marker matching Claude Code's visual
// language. Sub-agent messages are rendered separately with gutter wrapping
// and do not need a prefix here.
func (r *inlineRenderer) agentPrefix(subAgentID string) string {
	if subAgentID != "" {
		return ""
	}
	return "● "
}

func (r *inlineRenderer) statusf(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if r.cfg.program != nil {
		r.cfg.program.Println(strings.TrimRight(msg, "\n"))
		return
	}
	fmt.Fprint(r.cfg.status, msg)
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
