package root

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

	content := r.resolveExpandedContent(tc)
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

	content := r.resolveExpandedContent(tc)
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

// resolveExpandedContent returns the content for the expanded approval view.
// For write tools (not create), it attempts to read the existing file from
// disk to show a diff. The resolved existing content is stored in
// waitingApprovalState for reuse in the collapsed result. For all other tools
// (including edit tools, where old_text is already in args), delegates to
// the standard ExpandedApprovalContent.
func (r *inlineRenderer) resolveExpandedContent(tc toolrender.ToolCallInfo) string {
	if toolrender.IsWriteTool(tc.Name) && !toolrender.IsCreateTool(tc.Name) {
		existing := r.resolveAndReadExistingFile(tc)
		if r.waitingApproval != nil {
			r.waitingApproval.existingContent = existing
		}
		if existing != "" {
			return toolrender.ExpandedApprovalContentWithExisting(tc, existing)
		}
	}
	return toolrender.ExpandedApprovalContent(tc)
}

// resolveAndReadExistingFile extracts the file path from a write tool's args,
// resolves it to an absolute path using workspace roots and sandbox root, and
// reads the file contents. Returns empty string on any failure (missing path,
// unresolvable path, read error, new file). This keeps file I/O in the TUI
// layer while toolrender stays pure.
func (r *inlineRenderer) resolveAndReadExistingFile(tc toolrender.ToolCallInfo) string {
	relPath := toolrender.ToolFilePath(tc)
	if relPath == "" {
		return ""
	}

	absPath := r.resolveAbsolutePath(relPath)
	if absPath == "" {
		return ""
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return ""
	}
	return string(data)
}

// resolveAbsolutePath resolves a relative file path to an absolute path using
// workspace roots and sandbox root. Tries the toolrender resolution strategy
// first (which includes stat-probing); for absolute paths, returns as-is.
func (r *inlineRenderer) resolveAbsolutePath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return toolrender.ResolveFilePath(path, r.compactOpts)
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
	var result string
	if r.waitingApproval != nil && r.waitingApproval.existingContent != "" && toolrender.IsWriteTool(tc.Name) {
		result = toolrender.RenderApprovalResultWithOldContent(tc, action, r.waitingApproval.existingContent, r.compactOpts)
	} else {
		result = toolrender.RenderApprovalResult(tc, action, r.compactOpts)
	}
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
	if r.waitingApproval != nil {
		item.existingContent = r.waitingApproval.existingContent
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
	if r.waitingApproval != nil {
		item.existingContent = r.waitingApproval.existingContent
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

// prefixSubAgentQuestion prepends the sub-agent's subject to an approval
// question so the user can tell which sub-agent is requesting approval.
// The subject is looked up from the active sub-agent block (populated by
// SubAgentStartedEvent). When the block is not found or the subject is
// empty, the question is returned unchanged — showing nothing is better
// than showing a generic type name like "general-purpose".
func (r *inlineRenderer) prefixSubAgentQuestion(subAgentID, question string) string {
	if subAgentID == "" {
		return question
	}
	block, ok := r.activeSubAgents[subAgentID]
	if !ok || block.subject == "" {
		return question
	}
	subject := toolrender.Truncate(toolrender.FirstLine(block.subject), 60)
	return fmt.Sprintf("Sub-agent '%s': %s", subject, question)
}

// handleSessionExit performs a clean session exit when the user presses
// Ctrl+C at an approval prompt. It unblocks the stream goroutine with a
// skip response and sets exitRequested so renderInline terminates. The
// backend execution is not cancelled -- it continues running and can be
// resumed later.
func (r *inlineRenderer) handleSessionExit(e executiontui.ApprovalNeededEvent) {
	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     "skip",
		ToolCallID: e.ToolCallID,
	}
	r.statusf("\nSession ended by user\n")
	if r.cfg.sessionID != "" {
		r.statusf("Resume later with: stigmer resume %s\n", r.cfg.sessionID)
	}
	r.waitingApproval = nil
	r.exitRequested = true
}
