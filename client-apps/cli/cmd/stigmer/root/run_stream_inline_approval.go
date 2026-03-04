package root

import (
	"context"
	"errors"
	"fmt"
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
// EraseLines-based collapse.
func approvalContentBudget(termHeight int) int {
	budget := termHeight - approvalOverheadRows
	if budget < 5 {
		budget = 5
	}
	return budget
}

// handleApproval orchestrates the expand/prompt/collapse approval flow.
//
// For interactive prompts the flow is:
//  1. Prepare display: erase any prior streaming output and render the
//     full expanded view (header with path + content + separators)
//  2. Print the contextual question and show the arrow-key menu
//  3. Block until the user makes a decision
//  4. Erase the entire display + question + menu
//  5. Finalize: print collapsed result or start post-approval streaming
//  6. Suppress subsequent ToolCompletedEvent for non-shell tools
//
// For non-interactive mode (defaultAction set): skips the expanded view,
// erases any prior output, and either prints collapsed result or starts
// post-approval streaming for shell tools.
//
// Graceful degradation: when termctl.IsSupported is false, no erasure
// happens — content remains in scrollback.
func (r *inlineRenderer) handleApproval(ctx context.Context, e executiontui.ApprovalNeededEvent) {
	r.finishAIStreamIfNeeded()

	tc, subAgentID, runningRendered, contentStreamed, streamedRows := r.resolveApprovalContext(e)
	canCollapse := termctl.IsSupported(r.cfg.status)
	width := termctl.Width(r.cfg.status, 80)

	opts := approval.Options{
		ToolName:      e.ToolName,
		Message:       e.Message,
		ArgsPreview:   e.ArgsPreview,
		DefaultAction: r.cfg.defaultAction,
	}
	if r.cfg.defaultAction != approval.ActionUnspecified {
		opts.NonInteractive = true
	}

	if opts.NonInteractive {
		r.handleNonInteractiveApproval(e, tc, subAgentID, runningRendered, contentStreamed, canCollapse, streamedRows, opts)
		return
	}

	r.handleInteractiveApproval(ctx, e, tc, subAgentID, runningRendered, contentStreamed, canCollapse, streamedRows, width, opts)
}

// handleNonInteractiveApproval is the fast path when defaultAction is set.
// Erases any prior output (streamed content or running line), then either
// starts post-approval streaming (approved shell) or prints the collapsed
// result directly.
func (r *inlineRenderer) handleNonInteractiveApproval(
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	runningRendered, contentStreamed, canCollapse bool,
	streamedRows int,
	opts approval.Options,
) {
	if canCollapse {
		if contentStreamed {
			termctl.EraseLines(r.cfg.status, streamedRows)
		} else if runningRendered {
			termctl.EraseLines(r.cfg.status, 1)
		}
	}

	action := actionToString(opts.DefaultAction)

	if action == "approve" && toolrender.IsShellTool(tc.Name) {
		r.initPostApprovalStreaming(e.ToolCallID, tc, subAgentID)
	} else {
		r.printCollapsedResult(tc, action, subAgentID)
		r.trackSuppression(e.ToolCallID, tc.Name, action)
	}

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
	}
	r.waitingApproval = nil
}

// handleInteractiveApproval renders the full display/prompt/collapse flow.
//
// Two rendering paths based on whether a Bubbletea program is running:
//
// Bubbletea path (program != nil): the approval panel is rendered by View().
// Streaming content is erased (restoring cursor sync), then approvalShowMsg
// puts the panel into View(). Key events relay selection changes via Send().
// After the decision, approvalHideMsg clears the panel and commits the
// collapsed result via tea.Println Cmd.
//
// Direct-write fallback (program == nil): the legacy path using
// prepareApprovalDisplay, promptForDecision, and finalizeApproval with
// manual EraseLines. Used in non-TTY/CI environments and tests.
func (r *inlineRenderer) handleInteractiveApproval(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	runningRendered, contentStreamed, canCollapse bool,
	streamedRows, width int,
	opts approval.Options,
) {
	r.erasePreApprovalContent(contentStreamed, streamedRows, runningRendered, canCollapse)

	termHeight := termctl.Height(r.cfg.status, 40)
	maxContentLines := approvalContentBudget(termHeight)
	expanded := r.buildExpandedView(tc, width, maxContentLines)
	question := toolrender.ApprovalQuestion(tc)

	if r.cfg.program != nil {
		r.promptApprovalViaBubbletea(ctx, e, tc, subAgentID, expanded, question, opts)
		return
	}

	r.promptApprovalDirect(ctx, e, tc, subAgentID, expanded, question, width, canCollapse, opts)
}

// erasePreApprovalContent removes any prior streaming output or running
// indicator from stderr before the approval panel is displayed. This is
// shared by both the Bubbletea and direct-write paths.
//
// For the Bubbletea path, the erasure also restores cursor sync: the
// streaming content was written directly to stderr (bypassing Bubbletea),
// so EraseLines puts the cursor back to where Bubbletea thinks it is.
// Phase 5 will eliminate this by moving streaming into View().
func (r *inlineRenderer) erasePreApprovalContent(
	contentStreamed bool,
	streamedRows int,
	runningRendered, canCollapse bool,
) {
	if !canCollapse {
		return
	}
	if contentStreamed {
		termctl.EraseLines(r.cfg.status, streamedRows)
	} else if runningRendered {
		termctl.EraseLines(r.cfg.status, 1)
	}
}

// promptApprovalViaBubbletea renders the approval panel through View()
// and reads the user's decision via PromptKeyOnly. The panel is shown by
// sending approvalShowMsg; arrow keys send approvalSelectMsg to update
// the menu; the decision triggers approvalHideMsg which clears the panel
// and commits the collapsed result via tea.Println.
func (r *inlineRenderer) promptApprovalViaBubbletea(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	expanded, question string,
	opts approval.Options,
) {
	r.cfg.program.Send(approvalShowMsg{content: expanded + question + "\n"})

	ip, ok := r.cfg.prompter.(*approval.InlinePrompter)
	if !ok {
		r.cfg.program.Send(approvalHideMsg{})
		r.statusf("Approval prompt error: inline prompter required — auto-skipping\n")
		r.cfg.approvalResponses <- executiontui.ApprovalResponse{
			Action: "skip", ToolCallID: e.ToolCallID,
		}
		r.waitingApproval = nil
		return
	}

	decision, err := ip.PromptKeyOnly(ctx, opts, func(selected int) {
		r.cfg.program.Send(approvalSelectMsg{selected: selected})
	})
	if err != nil {
		r.cfg.program.Send(approvalHideMsg{})
		r.handlePromptErrorAfterHide(e, err)
		return
	}

	action := actionToString(decision.Action)

	if action == "approve" && toolrender.IsShellTool(tc.Name) {
		r.cfg.program.Send(approvalHideMsg{})
		r.initPostApprovalStreaming(e.ToolCallID, tc, subAgentID)
	} else {
		collapsed := r.formatCollapsedResult(tc, action, subAgentID)
		r.cfg.program.Send(approvalHideMsg{collapsedResult: collapsed})
		r.trackSuppression(e.ToolCallID, tc.Name, action)
	}

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
		Comment:    decision.Comment,
	}
	r.waitingApproval = nil
}

// promptApprovalDirect is the legacy direct-write fallback used when no
// Bubbletea program is running (non-TTY, CI, tests). It writes the
// expanded view and menu directly to stderr and uses EraseLines for
// collapse after the decision.
func (r *inlineRenderer) promptApprovalDirect(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	expanded, question string,
	width int,
	canCollapse bool,
	opts approval.Options,
) {
	fmt.Fprint(r.cfg.status, expanded)
	displayRows := termctl.DisplayRows(expanded, width)

	fmt.Fprintf(r.cfg.status, "%s\n", question)
	questionRows := termctl.DisplayRows(question+"\n", width)

	decision, menuRows, err := r.promptForDecision(ctx, opts)
	if err != nil {
		r.handlePromptError(e, err, displayRows+questionRows+menuRows, canCollapse)
		return
	}

	totalRows := displayRows + questionRows + menuRows
	r.finalizeApproval(e, tc, decision, subAgentID, totalRows, canCollapse)
}

// finalizeApproval handles the post-decision phase: erases the display,
// prints the collapsed result (or starts shell streaming for approved
// shell tools), sends the approval response, and clears state.
func (r *inlineRenderer) finalizeApproval(
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	decision *approval.Decision,
	subAgentID string,
	totalRows int,
	canCollapse bool,
) {
	action := actionToString(decision.Action)

	if canCollapse && totalRows > 0 {
		termHeight := termctl.Height(r.cfg.status, 40)
		if totalRows > termHeight {
			totalRows = termHeight
		}
		termctl.EraseLines(r.cfg.status, totalRows)
	}

	if action == "approve" && toolrender.IsShellTool(tc.Name) {
		r.initPostApprovalStreaming(e.ToolCallID, tc, subAgentID)
	} else {
		r.printCollapsedResult(tc, action, subAgentID)
		r.trackSuppression(e.ToolCallID, tc.Name, action)
	}

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
		Comment:    decision.Comment,
	}
	r.waitingApproval = nil
}

// resolveApprovalContext returns the ToolCallInfo, sub-agent ID, whether
// a running line was rendered, and streaming state for this tool. Prefers
// the state saved by renderToolWaitingApproval; falls back to constructing
// a minimal ToolCallInfo from ApprovalNeededEvent fields.
func (r *inlineRenderer) resolveApprovalContext(e executiontui.ApprovalNeededEvent) (
	tc toolrender.ToolCallInfo, subAgentID string, runningRendered, contentStreamed bool, streamedRows int,
) {
	if r.waitingApproval != nil {
		w := r.waitingApproval
		return w.tc, w.subAgentID, w.runningLineRendered, w.contentStreamed, w.streamedRows
	}
	return toolrender.ToolCallInfo{
		Name:   e.ToolName,
		Status: "waiting_approval",
	}, "", false, false, 0
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
		r.statusf("Resume later with: stigmer run %s\n", r.cfg.sessionID)
	}
	r.waitingApproval = nil
	r.exitRequested = true
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

// printCollapsedResult renders the post-decision compact summary. Applies
// gutter-wrapping when the tool belongs to a sub-agent. Used by the
// direct-write fallback and non-interactive paths.
func (r *inlineRenderer) printCollapsedResult(tc toolrender.ToolCallInfo, action string, subAgentID string) {
	r.statusf("%s\n", r.formatCollapsedResult(tc, action, subAgentID))
}

// trackSuppression records the tool call ID for ToolCompletedEvent
// suppression when the tool's completion would duplicate the approval
// result. Write/edit/delete completions are suppressed for all approval
// actions (approve, skip, reject). Shell tool completions are handled
// separately by the streaming interception (completeStreamingTool) and
// do not use suppressedToolIDs.
func (r *inlineRenderer) trackSuppression(toolCallID, toolName, action string) {
	if toolrender.ShouldSuppressCompletion(toolName) {
		r.suppressedToolIDs[toolCallID] = true
	}
}
