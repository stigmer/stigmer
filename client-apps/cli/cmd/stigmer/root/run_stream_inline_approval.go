package root

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

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

	tc, subAgentID, contentStreamed, streamedRows := r.resolveApprovalContext(e)
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
		r.handleNonInteractiveApproval(e, tc, subAgentID, contentStreamed, canCollapse, streamedRows, opts)
		return
	}

	r.handleInteractiveApproval(ctx, e, tc, subAgentID, contentStreamed, canCollapse, streamedRows, width, opts)
}

// handleNonInteractiveApproval is the fast path when defaultAction is set.
//
// Bubbletea path with streaming: sends streamingHideMsg to clear View().
// For shell-approve, initPostApprovalStreaming starts a new streaming
// session. For others, the collapsed result is committed via tea.Println
// through the streamingHideMsg Cmd.
//
// Direct-write path: erases any prior output via EraseLines, then prints
// the collapsed result or starts post-approval streaming.
func (r *inlineRenderer) handleNonInteractiveApproval(
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	contentStreamed, canCollapse bool,
	streamedRows int,
	opts approval.Options,
) {
	action := actionToString(opts.DefaultAction)

	if r.cfg.program != nil && contentStreamed {
		if action == "approve" && toolrender.IsShellTool(tc.Name) {
			r.cfg.program.Send(streamingHideMsg{})
			r.initPostApprovalStreaming(e.ToolCallID, tc, subAgentID)
		} else {
			collapsed := r.formatCollapsedResult(tc, action, subAgentID)
			r.cfg.program.Send(streamingHideMsg{collapsedResult: collapsed})
			r.trackSuppression(e.ToolCallID, tc.Name, action)
		}
	} else {
		if canCollapse && contentStreamed {
			termctl.EraseLines(r.cfg.status, streamedRows)
		}
		if action == "approve" && toolrender.IsShellTool(tc.Name) {
			r.initPostApprovalStreaming(e.ToolCallID, tc, subAgentID)
		} else {
			r.printCollapsedResult(tc, action, subAgentID)
			r.trackSuppression(e.ToolCallID, tc.Name, action)
		}
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
// Bubbletea path (program != nil): approvalShowMsg atomically replaces
// any active streaming content in View() with the approval panel. Key
// events relay selection changes via Send(). After the decision,
// approvalHideMsg clears the panel and commits the collapsed result via
// tea.Println Cmd.
//
// Direct-write fallback (program == nil): writes the expanded view and
// menu directly to stderr, uses EraseLines for collapse after the
// decision. Used in non-TTY/CI environments and tests.
func (r *inlineRenderer) handleInteractiveApproval(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	contentStreamed, canCollapse bool,
	streamedRows, width int,
	opts approval.Options,
) {
	r.erasePreApprovalContent(contentStreamed, streamedRows, canCollapse)

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

// erasePreApprovalContent removes any prior streaming output from stderr
// before the approval panel is displayed.
//
// Bubbletea path: streaming content is already in View(). approvalShowMsg
// atomically replaces it (handleApprovalShow clears streaming state).
// No manual erasure needed.
//
// Direct-write path: EraseLines removes the streamed content from stderr.
func (r *inlineRenderer) erasePreApprovalContent(
	contentStreamed bool,
	streamedRows int,
	canCollapse bool,
) {
	if r.cfg.program != nil {
		return
	}
	if canCollapse && contentStreamed {
		termctl.EraseLines(r.cfg.status, streamedRows)
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

// promptApprovalDirect is the direct-write fallback used when no
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
