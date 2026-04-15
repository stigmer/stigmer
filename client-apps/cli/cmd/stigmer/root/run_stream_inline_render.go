package root

import (
	"fmt"
	"io"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
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
	item := committedItem{
		kind:       kindToolCompact,
		toolCalls:  []toolrender.ToolCallInfo{e.ToolCall},
		subAgentID: e.SubAgentID,
	}
	if r.hasActiveSubAgent(e.SubAgentID) {
		r.appendToSubAgentBlock(e.SubAgentID, item, true)
	} else {
		r.commitToScrollback(item)
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
	r.commitToScrollback(committedItem{
		kind: kindSystemMessage,
		text: systemMsgStyle.Render(content),
	})
}

func (r *inlineRenderer) renderContextCompacted(e executiontui.ContextCompactedEvent) {
	reductionPct := e.CompressionRatio * 100
	text := fmt.Sprintf(
		"Context compacted: %dK → %dK tokens (%.0f%% reduction)",
		e.TokensBefore/1000, e.TokensAfter/1000, reductionPct,
	)
	r.commitToScrollback(committedItem{
		kind: kindSystemMessage,
		text: systemMsgStyle.Render(text),
	})
}

func (r *inlineRenderer) renderPhaseChange(e executiontui.PhaseChangeEvent) {
	r.phase = e.Phase
	var text string
	switch e.Phase {
	case "failed":
		text = "Execution failed"
	case "terminated":
		text = "Execution stopped"
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
	var historyBuf strings.Builder
	var currentTask string
	var completed int

	historyBuf.WriteString("Plan:")
	for _, todo := range e.Todos {
		var marker string
		switch todo.Status {
		case "completed":
			marker = "[x]"
			completed++
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
		fmt.Fprintf(&historyBuf, "\n  %s %s", marker, todo.Content)
	}

	r.trackedCurrentTask = currentTask
	r.trackedTodoTotal = len(e.Todos)
	r.trackedTodoCompleted = completed
	if r.cfg.program != nil {
		r.cfg.program.Send(currentTaskMsg{
			task:          currentTask,
			todoTotal:     len(e.Todos),
			todoCompleted: completed,
		})
	}

	newItem := committedItem{
		kind:          kindTodoUpdate,
		text:          historyBuf.String(),
		todoTotal:     len(e.Todos),
		todoCompleted: completed,
	}

	for i := len(r.history) - 1; i >= 0; i-- {
		if r.history[i].kind == kindTodoUpdate {
			r.history[i] = newItem
			return
		}
	}

	r.recordToHistory(newItem)
}

func (r *inlineRenderer) renderSubAgentStarted(e executiontui.SubAgentStartedEvent) {
	block := &subAgentBlock{
		id:        e.ID,
		name:      e.Name,
		subject:   e.Description,
		input:     e.Input,
		startedAt: time.Now(),
		status:    agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
	}
	r.activeSubAgents[e.ID] = block

	truncatedSubject := toolrender.Truncate(toolrender.FirstLine(e.Description), 80)
	if r.cfg.program != nil {
		r.cfg.program.Send(subAgentShowMsg{
			id:      e.ID,
			subject: truncatedSubject,
		})
	} else {
		r.statusf("%s %s: %s %s\n",
			toolrender.BulletGreen("●"), toolrender.LabelBold("Sub-agent"),
			truncatedSubject, "…")
	}
}

func (r *inlineRenderer) renderSubAgentCompleted(e executiontui.SubAgentCompletedEvent) {
	block, ok := r.activeSubAgents[e.ID]
	if !ok {
		return
	}

	block.status = e.Status
	block.output = e.Output
	if block.toolCount == 0 {
		block.toolCount = e.ToolCount
	}

	item := committedItem{
		kind:    kindSubAgentBlock,
		saBlock: block,
	}

	delete(r.activeSubAgents, e.ID)
	r.completedSubAgentIDs[e.ID] = true

	if r.cfg.program != nil {
		// Pre-render scrollback text with gap logic so the Bubbletea
		// model can show a brief completion indicator before committing
		// to scrollback via the staged dismissal path.
		text := renderCommittedItem(item, r.compactOpts, r.expandMode, r.expandHintEnabled())
		r.history = append(r.history, item)

		var scrollback string
		if text != "" {
			var sb strings.Builder
			if needsLeadingGap(r.lastScrollbackKind, item.kind) {
				sb.WriteByte('\n')
			}
			sb.WriteString(text)
			if item.kind == kindHeader || needsTrailingGap(item.kind) {
				sb.WriteByte('\n')
			}
			scrollback = sb.String()
		}
		r.lastScrollbackKind = item.kind

		subject := toolrender.Truncate(toolrender.FirstLine(block.subject), 80)
		displayLine := formatSubAgentCompletionLine(subject, block.status, block.toolCount)

		r.cfg.program.Send(subAgentCompleteMsg{
			id:              e.ID,
			displayLine:     displayLine,
			scrollbackLines: scrollback,
		})
	} else {
		r.commitToScrollback(item)
	}
}

// formatSubAgentCompletionLine builds the pre-styled single-line summary
// shown in the live View() during the completion visible window. Uses the
// same visual language as the scrollback collapsed rendering so the
// transition from live indicator to scrollback is seamless.
func formatSubAgentCompletionLine(subject string, status agentexecutionv1.SubAgentStatus, toolCount int) string {
	header := fmt.Sprintf("%s %s: %s",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Sub-agent"), subject)
	var suffix string
	switch status {
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED:
		suffix = fmt.Sprintf("✗ Failed (%d tools)", toolCount)
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED:
		suffix = fmt.Sprintf("⊘ Cancelled (%d tools)", toolCount)
	default:
		suffix = fmt.Sprintf("✓ Done (%d tools)", toolCount)
	}
	return header + " " + suffix
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
		text = fmt.Sprintf("Error: %s\n   Re-attach with: stigmer resume %s", e.Err.Error(), r.cfg.sessionID)
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
// When the reads belong to an active sub-agent block, they are appended to
// the block's children instead of committed to scrollback.
//
// All pending reads share the same sub-agent context (events don't interleave
// across agents), so checking the first entry's subAgentID is sufficient to
// determine whether gutter-wrapping or block routing is needed.
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

	item := committedItem{
		kind:       kindReadGroup,
		toolCalls:  tcs,
		subAgentID: subAgentID,
	}

	if block, ok := r.activeSubAgents[subAgentID]; ok && subAgentID != "" {
		block.children = append(block.children, item)
		block.toolCount += len(tcs)
		if r.cfg.program != nil {
			r.cfg.program.Send(subAgentToolCountMsg{id: subAgentID, count: block.toolCount})
		}
	} else {
		r.commitToScrollback(item)
	}
	r.pendingReads = r.pendingReads[:0]
}

// ---------------------------------------------------------------------------
// Sub-agent block helpers
// ---------------------------------------------------------------------------

// appendToSubAgentBlock adds a committed item to the active sub-agent block's
// children and increments the tool count when the item represents a tool
// completion. The updated count is pushed to the live Bubbletea view via
// subAgentToolCountMsg so the user sees progress while the sub-agent runs.
func (r *inlineRenderer) appendToSubAgentBlock(subAgentID string, item committedItem, isTool bool) {
	block, ok := r.activeSubAgents[subAgentID]
	if !ok {
		return
	}
	block.children = append(block.children, item)
	if isTool {
		block.toolCount++
		if r.cfg.program != nil {
			r.cfg.program.Send(subAgentToolCountMsg{id: subAgentID, count: block.toolCount})
		}
	}
}

// hasActiveSubAgent reports whether a sub-agent block with the given ID
// is currently buffering events (running, not yet committed to history).
func (r *inlineRenderer) hasActiveSubAgent(subAgentID string) bool {
	if subAgentID == "" {
		return false
	}
	_, ok := r.activeSubAgents[subAgentID]
	return ok
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// commitToScrollback appends an item to the history buffer and writes it
// to terminal scrollback via writeToScrollback. The rendered text and gap
// logic are handled by writeToScrollback, ensuring live output is
// byte-for-byte identical to what renderHistoryBatch would produce.
func (r *inlineRenderer) commitToScrollback(item committedItem) {
	r.history = append(r.history, item)
	text := renderCommittedItem(item, r.compactOpts, r.expandMode, r.expandHintEnabled())
	r.writeToScrollback(item.kind, text)
}

// writeToScrollback writes a single rendered text block to terminal
// scrollback with transition-aware gap logic. Every visible write to
// scrollback — whether from a history-tracked item or a transient
// streaming line — must go through this method so that spacing between
// live output and recommit output stays identical.
func (r *inlineRenderer) writeToScrollback(kind committedKind, text string) {
	if text == "" {
		return
	}
	if needsLeadingGap(r.lastScrollbackKind, kind) {
		r.statusf("\n")
	}
	r.statusf("%s\n", text)
	if kind == kindHeader || needsTrailingGap(kind) {
		r.statusf("\n")
	}
	r.lastScrollbackKind = kind
}

// recordToHistory appends an item to the history buffer without writing
// to scrollback. Used when the visual output was already committed
// progressively (e.g. AI stream line-by-line commits) and only the
// history record is needed for future recommits.
func (r *inlineRenderer) recordToHistory(item committedItem) {
	r.history = append(r.history, item)
}

// commitStreamEndGap emits the trailing blank-line gap that a completed
// AI message would produce (via needsTrailingGap(kindAIMessage)) and
// updates lastScrollbackKind to kindAIMessage. Called at AI stream end
// so that the next item sees the correct predecessor kind.
func (r *inlineRenderer) commitStreamEndGap() {
	if needsTrailingGap(kindAIMessage) {
		r.statusf("\n")
	}
	r.lastScrollbackKind = kindAIMessage
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
