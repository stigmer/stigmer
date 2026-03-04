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
// Delegates display setup to prepareApprovalDisplay and post-decision
// handling to finalizeApproval, keeping this function focused on the
// question and prompt orchestration.
func (r *inlineRenderer) handleInteractiveApproval(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	runningRendered, contentStreamed, canCollapse bool,
	streamedRows, width int,
	opts approval.Options,
) {
	displayRows := r.prepareApprovalDisplay(tc, contentStreamed, streamedRows, runningRendered, canCollapse, width)

	question := toolrender.ApprovalQuestion(tc)
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

// prepareApprovalDisplay renders the content shown above the approval
// question. Returns the number of display rows rendered, used for
// EraseLines-based erasure after the user decides.
//
// When contentStreamed is true and cursor control is available, the
// streamed content is erased and replaced with the full expanded view
// built from the now-complete Args. This ensures the header shows the
// file path and separators span the terminal width.
//
// When contentStreamed is false, the full expanded view (separator +
// header + content + separator) is printed from Args.
//
// Content is height-capped and width-clamped via buildExpandedView to
// keep the total display within the terminal height, making the row
// count deterministic for EraseLines.
func (r *inlineRenderer) prepareApprovalDisplay(
	tc toolrender.ToolCallInfo,
	contentStreamed bool,
	streamedRows int,
	runningRendered, canCollapse bool,
	width int,
) int {
	termHeight := termctl.Height(r.cfg.status, 40)

	if contentStreamed && canCollapse {
		termctl.EraseLines(r.cfg.status, streamedRows)
	}

	if !contentStreamed && canCollapse && runningRendered {
		termctl.EraseLines(r.cfg.status, 1)
	}

	maxContentLines := approvalContentBudget(termHeight)
	expanded := r.buildExpandedView(tc, width, maxContentLines)
	fmt.Fprint(r.cfg.status, expanded)
	return termctl.DisplayRows(expanded, width)
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
// Session exit (Esc/Ctrl+C) terminates the session. Any other error
// (context cancellation, unexpected failure) auto-skips the tool.
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

// printCollapsedResult renders the post-decision compact summary. Applies
// gutter-wrapping when the tool belongs to a sub-agent.
func (r *inlineRenderer) printCollapsedResult(tc toolrender.ToolCallInfo, action string, subAgentID string) {
	result := toolrender.RenderApprovalResult(tc, action, r.compactOpts)
	if subAgentID != "" {
		result = toolrender.GutterWrap(result)
	}
	r.statusf("%s\n", result)
}

// trackSuppression records the tool call ID for ToolCompletedEvent
// suppression when the tool's completion would duplicate the approval
// result. Write/edit/delete completions are suppressed. Shell tool
// completions are handled separately by the streaming interception
// (completeStreamingTool) and do not use suppressedToolIDs.
func (r *inlineRenderer) trackSuppression(toolCallID, toolName, action string) {
	if action == "reject" {
		return
	}
	if toolrender.ShouldSuppressCompletion(toolName) {
		r.suppressedToolIDs[toolCallID] = true
	}
}
