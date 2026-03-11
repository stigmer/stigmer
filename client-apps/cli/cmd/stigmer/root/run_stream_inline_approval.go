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
			r.recordApproval(tc, action, subAgentID)
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

	question := toolrender.ApprovalQuestion(tc)
	if e.FromSubAgent {
		question = r.prefixSubAgentQuestion(subAgentID, question)
	}

	if r.cfg.program != nil {
		expanded := r.buildFullExpandedView(tc, width)
		if contentStreamed {
			decisionCh := make(chan approvalDecision, 1)
			r.performReCommitWithApproval(expanded, question, decisionCh, 0)
			r.waitForApprovalDecision(ctx, e, tc, subAgentID, expanded, question, decisionCh)
			return
		}
		r.promptApprovalViaBubbletea(ctx, e, tc, subAgentID, expanded, question, opts)
		return
	}

	expanded := r.buildFullExpandedView(tc, width)
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
// and collects the user's decision.
//
// When Bubbletea owns stdin (cancelCh is non-nil), the model receives
// keystrokes as tea.KeyPressMsg and delivers the decision via a channel.
// When stdin is external (legacy path), PromptKeyOnly reads keys
// directly and sends approvalSelectMsg for menu updates.
func (r *inlineRenderer) promptApprovalViaBubbletea(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	expanded, question string,
	opts approval.Options,
) {
	if r.cfg.cancelCh != nil {
		r.promptApprovalViaChannel(ctx, e, tc, subAgentID, expanded, question)
		return
	}
	r.promptApprovalViaKeyReader(ctx, e, tc, subAgentID, expanded, question, opts)
}

// promptApprovalViaChannel uses the channel-based flow when Bubbletea
// owns stdin. Sends approvalStartMsg with a decision channel, then
// blocks until the model delivers a decision via handleApprovalKey.
//
// While waiting for the decision, it also listens on toggleExpandCh so
// Ctrl+O can refresh the scrollback in expand/collapse mode without
// disrupting the approval prompt (via performReCommitWithApproval).
func (r *inlineRenderer) promptApprovalViaChannel(
	_ context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	expanded, question string,
) {
	decisionCh := make(chan approvalDecision, 1)

	msg := approvalStartMsg{
		expandedContent: expanded,
		question:        question,
		decisionCh:      decisionCh,
	}
	r.cfg.program.Send(msg)

	r.waitForApprovalDecision(nil, e, tc, subAgentID, expanded, question, decisionCh)
}

// waitForApprovalDecision blocks until the user makes an approval decision,
// while also handling Ctrl+O toggles via performReCommitWithApproval. Shared
// by both the direct re-commit path (contentStreamed) and the normal channel
// path.
func (r *inlineRenderer) waitForApprovalDecision(
	_ context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	expanded, question string,
	decisionCh chan approvalDecision,
) {
	var d approvalDecision
	for {
		select {
		case d = <-decisionCh:
			goto decided
		case <-r.cfg.toggleExpandCh:
			r.expandMode = !r.expandMode
			decisionCh = make(chan approvalDecision, 1)
			r.performReCommitWithApproval(expanded, question, decisionCh, 0)
		}
	}
decided:

	if d.err != nil {
		r.cfg.program.Send(approvalHideMsg{})
		r.handlePromptErrorAfterHide(e, d.err)
		return
	}

	action := actionToString(d.action)
	r.finalizeApprovalViaBubbletea(e, tc, action, subAgentID)

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
	}
	r.waitingApproval = nil
}

// promptApprovalViaKeyReader is the legacy path using PromptKeyOnly when
// Bubbletea does not own stdin (tea.WithInput(nil)). In production,
// cancelCh is always non-nil when program is non-nil (both gated on
// termctl.IsSupported), so the channel path is always taken for TTY
// sessions. This function is effectively reachable only from tests that
// construct configs with cancelCh == nil. Retained for backward
// compatibility and InlinePrompter integration test coverage.
func (r *inlineRenderer) promptApprovalViaKeyReader(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	expanded, question string,
	opts approval.Options,
) {
	msg := approvalShowMsg{
		expandedContent: expanded,
		question:        question,
	}
	r.cfg.program.Send(msg)

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
	r.finalizeApprovalViaBubbletea(e, tc, action, subAgentID)
	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
		Comment:    decision.Comment,
	}
	r.waitingApproval = nil
}

// finalizeApprovalViaBubbletea handles the post-decision visual phase when
// a Bubbletea program is running. Hides the approval panel and either
// starts post-approval streaming (approved shell) or commits the collapsed
// result via re-commit. Does NOT send the approval response or clear
// state — callers handle that themselves so they can include path-specific
// fields (Comment).
//
// For non-shell tools the collapsed result is recorded in history and a
// re-commit replays the full history, which naturally excludes the expanded
// content that handleApprovalStart committed to scrollback.
func (r *inlineRenderer) finalizeApprovalViaBubbletea(
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	action string,
	subAgentID string,
) {
	if action == "approve" && toolrender.IsShellTool(tc.Name) {
		r.cfg.program.Send(approvalHideMsg{})
		r.initPostApprovalStreaming(e.ToolCallID, tc, subAgentID)
	} else {
		r.cfg.program.Send(approvalHideMsg{})
		r.recordApproval(tc, action, subAgentID)
		r.trackSuppression(e.ToolCallID, tc.Name, action)
		r.triggerReCommit()
	}
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
