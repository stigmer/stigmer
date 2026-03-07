package root

import (
	"context"
	"errors"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// approvalOverheadRows is the number of display rows consumed by the
// non-content parts of the expanded approval view: top separator (1),
// header (1), bottom separator (1), question (1-2), menu (4), plus a
// small margin (2) for safety. This is subtracted from terminal height
// to compute the maximum content lines.
const approvalOverheadRows = 10

// approvalContentBudget computes the maximum number of content lines
// that can be displayed in the expanded approval view without exceeding
// the terminal height. This prevents scrolling, which would invalidate
// the collapse mechanism (Bubbletea View() replacement or EraseLines).
func approvalContentBudget(termHeight int) int {
	budget := termHeight - approvalOverheadRows
	if budget < 5 {
		budget = 5
	}
	return budget
}

// resolveApprovalContext returns the ToolCallInfo, sub-agent ID, and
// streaming state for this tool. Prefers the state saved by
// renderToolWaitingApproval; falls back to constructing a minimal
// ToolCallInfo from ApprovalNeededEvent fields.
func (r *inlineRenderer) resolveApprovalContext(e executiontui.ApprovalNeededEvent) (
	tc toolrender.ToolCallInfo, subAgentID string, contentStreamed bool, streamedRows int,
) {
	if r.waitingApproval != nil {
		w := r.waitingApproval
		return w.tc, w.subAgentID, w.contentStreamed, w.streamedRows
	}
	return toolrender.ToolCallInfo{
		Name:   e.ToolName,
		Status: "waiting_approval",
	}, "", false, 0
}

// buildExpandedView assembles the expanded approval content shown before
// the user makes a decision: separator + header + content + separator.
// Content is height-capped to maxContentLines and width-clamped to
// width-1 to prevent line wrapping, making the row count deterministic.
// Separators span the given terminal width. The question and menu are
// rendered by the caller below the bottom separator.
func (r *inlineRenderer) buildExpandedView(tc toolrender.ToolCallInfo, width, maxContentLines int) string {
	var b strings.Builder
	sep := toolrender.ApprovalSeparator(width)

	b.WriteString(sep)
	b.WriteByte('\n')

	header := toolrender.ExpandedApprovalHeader(tc, r.compactOpts)
	b.WriteString(header)
	b.WriteByte('\n')

	content := toolrender.ExpandedApprovalContent(tc)
	if content != "" {
		maxWidth := width - 1
		if maxWidth < 20 {
			maxWidth = 20
		}
		content = toolrender.TruncateContent(content, maxContentLines, maxWidth)
		b.WriteString(content)
		if !strings.HasSuffix(content, "\n") {
			b.WriteByte('\n')
		}
	}

	b.WriteString(sep)
	b.WriteByte('\n')

	return b.String()
}

// buildFullExpandedView assembles the expanded approval content without any
// truncation: separator + header + ALL content lines + separator. This is
// committed to scrollback via tea.Println where there is no height limit.
// The existing buildExpandedView (with truncation) is kept for the
// direct-write fallback path that does not use split-commit.
func (r *inlineRenderer) buildFullExpandedView(tc toolrender.ToolCallInfo, width int) string {
	var b strings.Builder
	sep := toolrender.ApprovalSeparator(width)

	b.WriteString(sep)
	b.WriteByte('\n')

	header := toolrender.ExpandedApprovalHeader(tc, r.compactOpts)
	b.WriteString(header)
	b.WriteByte('\n')

	content := toolrender.ExpandedApprovalContent(tc)
	if content != "" {
		b.WriteString(content)
		if !strings.HasSuffix(content, "\n") {
			b.WriteByte('\n')
		}
	}

	b.WriteString(sep)
	b.WriteByte('\n')

	return b.String()
}

// promptForDecision calls the prompter and returns the decision with line
// count. Uses PromptWithLineCount when an InlinePrompter is available;
// falls back to the Prompter interface with lineCount 0.
func (r *inlineRenderer) promptForDecision(ctx context.Context, opts approval.Options) (*approval.Decision, int, error) {
	if ip, ok := r.cfg.prompter.(*approval.InlinePrompter); ok {
		return ip.PromptWithLineCount(ctx, opts)
	}
	decision, err := r.cfg.prompter.Prompt(ctx, opts)
	return decision, 0, err
}

// formatCollapsedResult builds the post-decision compact summary string
// without printing it. Used by the Bubbletea path where the result is
// committed via tea.Println through the approvalHideMsg Cmd.
func (r *inlineRenderer) formatCollapsedResult(tc toolrender.ToolCallInfo, action string, subAgentID string) string {
	result := toolrender.RenderApprovalResult(tc, action, r.compactOpts)
	if subAgentID != "" {
		result = toolrender.GutterWrap(result)
	}
	return result
}

// printCollapsedResult renders the post-decision compact summary via
// commitToScrollback. When the tool belongs to an active sub-agent block,
// the item is appended to the block's children instead. Used by the
// direct-write fallback and non-interactive paths.
func (r *inlineRenderer) printCollapsedResult(tc toolrender.ToolCallInfo, action string, subAgentID string) {
	item := committedItem{
		kind:       kindApproval,
		toolCalls:  []toolrender.ToolCallInfo{tc},
		action:     action,
		subAgentID: subAgentID,
	}
	if r.hasActiveSubAgent(subAgentID) {
		r.appendToSubAgentBlock(subAgentID, item, true)
	} else {
		r.commitToScrollback(item)
	}
}

// recordApproval appends a kindApproval item to history via recordToHistory.
// When the tool belongs to an active sub-agent block, the item is appended
// to the block's children instead. Called from the Bubbletea path where
// formatCollapsedResult is used with approvalHideMsg/streamingHideMsg.
func (r *inlineRenderer) recordApproval(tc toolrender.ToolCallInfo, action string, subAgentID string) {
	item := committedItem{
		kind:       kindApproval,
		toolCalls:  []toolrender.ToolCallInfo{tc},
		action:     action,
		subAgentID: subAgentID,
	}
	if r.hasActiveSubAgent(subAgentID) {
		r.appendToSubAgentBlock(subAgentID, item, true)
	} else {
		r.recordToHistory(item)
	}
}

// trackSuppression records the tool call ID for ToolCompletedEvent
// suppression when the tool's completion would duplicate the approval
// result. Write/edit/delete completions are suppressed for all approval
// actions (approve, skip, reject). Shell tool completions are handled
// separately by the streaming interception (completeStreamingTool) and
// do not use suppressedToolIDs.
func (r *inlineRenderer) trackSuppression(toolCallID, toolName, action string) {
	if action == "approve" && toolrender.ShouldSuppressCompletion(toolName) {
		r.suppressedToolIDs[toolCallID] = true
	}
}

// handlePromptError routes prompt errors to the appropriate handler.
// Used by the direct-write fallback path. Erases any rendered content
// before handling the error.
func (r *inlineRenderer) handlePromptError(e executiontui.ApprovalNeededEvent, err error, renderedRows int, canCollapse bool) {
	if canCollapse && renderedRows > 0 {
		termHeight := termctl.Height(r.cfg.status, 40)
		if renderedRows > termHeight {
			renderedRows = termHeight
		}
		termctl.EraseLines(r.cfg.status, renderedRows)
	}

	if errors.Is(err, approval.ErrSessionExit) {
		r.handleSessionExit(e)
		return
	}

	r.statusf("Approval prompt error: %s — auto-skipping\n", err)
	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     "skip",
		ToolCallID: e.ToolCallID,
	}
	r.waitingApproval = nil
}

// handlePromptErrorAfterHide routes prompt errors when the Bubbletea
// panel has already been hidden via approvalHideMsg. No manual erasure
// is needed — View()="" cleared the panel.
func (r *inlineRenderer) handlePromptErrorAfterHide(e executiontui.ApprovalNeededEvent, err error) {
	if errors.Is(err, approval.ErrSessionExit) {
		r.handleSessionExit(e)
		return
	}

	r.statusf("Approval prompt error: %s — auto-skipping\n", err)
	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     "skip",
		ToolCallID: e.ToolCallID,
	}
	r.waitingApproval = nil
}

// handleSessionExit performs a clean session exit when the user presses
// Ctrl+C at an approval prompt. It unblocks the stream goroutine with a
// skip response, fires backend cancellation in a goroutine (so the CLI
// exits immediately), and sets exitRequested so renderInline terminates.
func (r *inlineRenderer) handleSessionExit(e executiontui.ApprovalNeededEvent) {
	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     "skip",
		ToolCallID: e.ToolCallID,
	}
	if r.cfg.cancelExecFn != nil {
		go r.cfg.cancelExecFn()
	}
	r.statusf("\nSession ended by user\n")
	if r.cfg.sessionID != "" {
		r.statusf("Resume later with: stigmer resume %s\n", r.cfg.sessionID)
	}
	r.waitingApproval = nil
	r.exitRequested = true
}
