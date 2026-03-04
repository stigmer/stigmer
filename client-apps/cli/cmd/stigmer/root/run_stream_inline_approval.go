package root

import (
	"context"
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// handleApproval orchestrates the expand/prompt/collapse approval flow.
//
// For interactive prompts the flow is:
//  1. Prepare display: if content was streamed (pre-approval), add bottom
//     separator; otherwise erase running line and print expanded view
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
// question. Returns the number of display rows rendered, used for cursor
// control erasure after the user decides.
//
// When contentStreamed is true, the content is already visible from
// pre-approval streaming. Only a bottom separator is added below the
// existing content. When false, the full expanded view (header +
// separator + content + separator) is printed from Args.
func (r *inlineRenderer) prepareApprovalDisplay(
	tc toolrender.ToolCallInfo,
	contentStreamed bool,
	streamedRows int,
	runningRendered, canCollapse bool,
	width int,
) int {
	if contentStreamed {
		sep := toolrender.ApprovalSeparator()
		fmt.Fprintf(r.cfg.status, "%s\n", sep)
		sepRows := termctl.DisplayRows(sep+"\n", width)
		return streamedRows + sepRows
	}

	if canCollapse && runningRendered {
		termctl.EraseLines(r.cfg.status, 1)
	}

	expanded := r.buildExpandedView(tc)
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

	if canCollapse {
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
// the user makes a decision: header + separator + content + separator.
// The trailing newline is included so the caller can count rows accurately.
func (r *inlineRenderer) buildExpandedView(tc toolrender.ToolCallInfo) string {
	var b strings.Builder

	header := toolrender.ExpandedApprovalHeader(tc, r.compactOpts)
	b.WriteString(header)
	b.WriteByte('\n')

	sep := toolrender.ApprovalSeparator()
	b.WriteString(sep)
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

// handlePromptError sends a skip response when the prompt fails. If cursor
// control is available, erases the expanded view first.
func (r *inlineRenderer) handlePromptError(e executiontui.ApprovalNeededEvent, err error, renderedRows int, canCollapse bool) {
	if canCollapse && renderedRows > 0 {
		termctl.EraseLines(r.cfg.status, renderedRows)
	}
	r.statusf("⚠ Approval prompt failed: %s — auto-skipping\n", err)
	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     "skip",
		ToolCallID: e.ToolCallID,
	}
	r.waitingApproval = nil
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
