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
// Human message rendering
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderHumanMessage(e executiontui.HumanMessageEvent) {
	if r.cfg.suppressHumanEcho {
		r.cfg.suppressHumanEcho = false
		return
	}
	r.finishAIStreamIfNeeded()
	r.statusf("%s\n\n", formatHumanMessage(e.Content))
	r.history = append(r.history, committedItem{
		kind: kindHumanMessage,
		text: formatHumanMessage(e.Content),
	})
}

// ---------------------------------------------------------------------------
// Tool call rendering — status goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
	line := r.renderToolLine(e.ToolCall, e.SubAgentID)
	r.statusf("%s\n", line)
	if strings.Contains(line, "\n") {
		r.statusf("\n")
	}
	r.history = append(r.history, committedItem{
		kind:       kindToolCompact,
		toolCalls:  []toolrender.ToolCallInfo{e.ToolCall},
		subAgentID: e.SubAgentID,
	})
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
	r.history = append(r.history, committedItem{
		kind: kindSystemMessage,
		text: systemMsgStyle.Render(content),
	})
}

func (r *inlineRenderer) renderPhaseChange(e executiontui.PhaseChangeEvent) {
	r.phase = e.Phase
	var text string
	switch e.Phase {
	case "failed":
		text = "Execution failed"
	case "cancelled":
		text = "Execution cancelled"
	default:
		return
	}
	r.statusf("%s\n", text)
	r.history = append(r.history, committedItem{
		kind: kindPhaseChange,
		text: text,
	})
}

func (r *inlineRenderer) renderTodoUpdate(e executiontui.TodoUpdateEvent) {
	var b strings.Builder
	b.WriteString("Plan:")
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
		fmt.Fprintf(&b, "\n  %s %s", marker, todo.Content)
	}
	text := b.String()
	r.statusf("%s\n", text)
	r.statusf("\n")
	r.history = append(r.history, committedItem{
		kind: kindTodoUpdate,
		text: text,
	})
}

func (r *inlineRenderer) renderSubAgentStarted(e executiontui.SubAgentStartedEvent) {
	label := e.Name
	if e.Description != "" {
		label = e.Description
	}
	text := fmt.Sprintf("%s %s: %s",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Task"), label)
	r.statusf("%s\n", text)
	r.history = append(r.history, committedItem{
		kind: kindSubAgentStart,
		text: text,
	})
}

func (r *inlineRenderer) renderSubAgentCompleted(e executiontui.SubAgentCompletedEvent) {
	var text string
	if e.Status == "failed" {
		text = fmt.Sprintf("  ✗ Failed (%d tools)", e.ToolCount)
	} else {
		text = fmt.Sprintf("  ✓ Done (%d tools)", e.ToolCount)
	}
	r.statusf("%s\n\n", text)
	r.history = append(r.history, committedItem{
		kind: kindSubAgentComplete,
		text: text,
	})
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderDone(e executiontui.DoneEvent) {
	r.finishAIStreamIfNeeded()
	if e.Error != "" {
		text := fmt.Sprintf("Error: %s", e.Error)
		r.statusf("%s\n", text)
		r.history = append(r.history, committedItem{
			kind: kindText,
			text: text,
		})
	}
}

func (r *inlineRenderer) renderStreamError(e executiontui.StreamErrorEvent) {
	r.finishAIStreamIfNeeded()
	var text string
	if r.cfg.sessionID != "" {
		text = fmt.Sprintf("Error: %s\n   Re-attach with: stigmer run %s", e.Err.Error(), r.cfg.sessionID)
	} else {
		text = fmt.Sprintf("Error: %s", e.Err.Error())
	}
	r.statusf("%s\n", text)
	r.history = append(r.history, committedItem{
		kind: kindText,
		text: text,
	})
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
		if r.expandMode {
			output = toolrender.RenderReadGroupExpanded(tcs, r.compactOpts)
		} else {
			output = toolrender.RenderReadGroup(tcs, r.compactOpts)
		}
	} else {
		var lines []string
		for _, tc := range tcs {
			if r.expandMode {
				lines = append(lines, toolrender.RenderExpanded(tc, r.compactOpts))
			} else {
				lines = append(lines, toolrender.RenderCompact(tc, r.compactOpts))
			}
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
	r.history = append(r.history, committedItem{
		kind:       kindReadGroup,
		toolCalls:  tcs,
		subAgentID: subAgentID,
	})
	r.pendingReads = r.pendingReads[:0]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// renderToolLine renders a single tool call in the current expand mode,
// applying gutter-wrapping for sub-agent tools. Used by renderToolCompleted
// and completeStreamingTool to avoid duplicating mode-selection logic.
func (r *inlineRenderer) renderToolLine(tc toolrender.ToolCallInfo, subAgentID string) string {
	var line string
	if r.expandMode {
		line = toolrender.RenderExpanded(tc, r.compactOpts)
	} else {
		line = toolrender.RenderCompact(tc, r.compactOpts)
	}
	if subAgentID != "" {
		line = toolrender.GutterWrap(line)
	}
	return line
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
