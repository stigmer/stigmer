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
	r.commitToScrollback(committedItem{
		kind: kindHumanMessage,
		text: formatHumanMessage(e.Content),
	})
}

// ---------------------------------------------------------------------------
// Tool call rendering — status goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
	r.commitToScrollback(committedItem{
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
	r.commitToScrollback(committedItem{
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
	r.commitToScrollback(committedItem{
		kind: kindPhaseChange,
		text: text,
	})
}

func (r *inlineRenderer) renderTodoUpdate(e executiontui.TodoUpdateEvent) {
	var b strings.Builder
	var currentTask string
	b.WriteString("Plan:")
	for _, todo := range e.Todos {
		var marker string
		switch todo.Status {
		case "completed":
			marker = "[x]"
		case "in_progress":
			marker = "[-]"
			if currentTask == "" {
				currentTask = todo.Content
			}
		case "cancelled":
			marker = "[~]"
		default:
			marker = "[ ]"
		}
		fmt.Fprintf(&b, "\n  %s %s", marker, todo.Content)
	}

	if r.cfg.program != nil {
		r.cfg.program.Send(currentTaskMsg{task: currentTask})
	}

	newItem := committedItem{kind: kindTodoUpdate, text: b.String()}

	// In-place update: replace the most recent kindTodoUpdate in history
	// and re-render via triggerReCommit to avoid accumulating stale plan
	// snapshots in scrollback.
	for i := len(r.history) - 1; i >= 0; i-- {
		if r.history[i].kind == kindTodoUpdate {
			r.history[i] = newItem
			r.triggerReCommit()
			return
		}
	}

	r.commitToScrollback(newItem)
}

func (r *inlineRenderer) renderSubAgentStarted(e executiontui.SubAgentStartedEvent) {
	label := e.Name
	if e.Description != "" {
		label = e.Description
	}
	r.commitToScrollback(committedItem{
		kind: kindSubAgentStart,
		text: fmt.Sprintf("%s %s: %s",
			toolrender.BulletGreen("●"), toolrender.LabelBold("Task"), label),
	})
}

func (r *inlineRenderer) renderSubAgentCompleted(e executiontui.SubAgentCompletedEvent) {
	var text string
	if e.Status == "failed" {
		text = fmt.Sprintf("  ✗ Failed (%d tools)", e.ToolCount)
	} else {
		text = fmt.Sprintf("  ✓ Done (%d tools)", e.ToolCount)
	}
	r.commitToScrollback(committedItem{
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
		r.commitToScrollback(committedItem{
			kind: kindText,
			text: fmt.Sprintf("Error: %s", e.Error),
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
	r.commitToScrollback(committedItem{
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

	r.commitToScrollback(committedItem{
		kind:       kindReadGroup,
		toolCalls:  tcs,
		subAgentID: subAgentID,
	})
	r.pendingReads = r.pendingReads[:0]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// commitToScrollback appends an item to the history buffer and writes it
// to terminal scrollback with the same spacing that renderHistoryBatch
// would produce. This is the single source of truth for live-path spacing,
// ensuring that incrementally-committed output is byte-for-byte identical
// to what a subsequent recommit would render.
//
// Multi-line items (kindToolCompact, kindReadGroup) already carry a
// trailing \n inside their rendered text (from renderToolCompactItem /
// renderReadGroupItem). Combined with Println's implicit newline, this
// produces the blank-line gap that renderHistoryBatch creates via the
// inter-item \n + trailing \n.
func (r *inlineRenderer) commitToScrollback(item committedItem) {
	r.history = append(r.history, item)
	text := renderCommittedItem(item, r.compactOpts, r.expandMode)
	if text == "" {
		return
	}
	r.statusf("%s\n", text)
	if item.kind == kindHeader || needsTrailingGap(item.kind) {
		r.statusf("\n")
	}
}

// recordToHistory appends an item to the history buffer without writing
// to scrollback. Used when the visual output was already committed
// progressively (e.g. AI stream line-by-line commits) and only the
// history record is needed for future recommits.
func (r *inlineRenderer) recordToHistory(item committedItem) {
	r.history = append(r.history, item)
}

func (r *inlineRenderer) statusf(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if r.cfg.program != nil {
		r.cfg.program.Println(strings.TrimSuffix(msg, "\n"))
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
