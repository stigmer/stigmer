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
//  1. Erase the running indicator line (if cursor control is available)
//  2. Render expanded view: header + separator + content + separator
//  3. Print the contextual question and show the arrow-key menu
//  4. Block until the user makes a decision
//  5. Erase the entire expanded view + question + menu
//  6. Print the collapsed RenderApprovalResult in place
//  7. Suppress subsequent ToolCompletedEvent for non-shell tools
//
// For non-interactive mode (defaultAction set): skips the expanded view,
// erases the running line, and prints the collapsed result directly.
//
// Graceful degradation: when termctl.IsSupported is false, no erasure
// happens — both the expanded view and collapsed result remain in
// scrollback.
func (r *inlineRenderer) handleApproval(ctx context.Context, e executiontui.ApprovalNeededEvent) {
	r.finishAIStreamIfNeeded()

	tc, subAgentID, runningRendered := r.resolveApprovalContext(e)
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
		r.handleNonInteractiveApproval(e, tc, subAgentID, runningRendered, canCollapse, opts)
		return
	}

	r.handleInteractiveApproval(ctx, e, tc, subAgentID, runningRendered, canCollapse, width, opts)
}

// handleNonInteractiveApproval is the fast path when defaultAction is set.
// No expanded view or menu — erase the running line and print the collapsed
// result directly.
func (r *inlineRenderer) handleNonInteractiveApproval(
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	runningRendered, canCollapse bool,
	opts approval.Options,
) {
	if canCollapse && runningRendered {
		termctl.EraseLines(r.cfg.status, 1)
	}

	action := actionToString(opts.DefaultAction)
	r.printCollapsedResult(tc, action, subAgentID)
	r.trackSuppression(e.ToolCallID, tc.Name, action)

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
	}
	r.waitingApproval = nil
}

// handleInteractiveApproval renders the full expand/prompt/collapse flow.
func (r *inlineRenderer) handleInteractiveApproval(
	ctx context.Context,
	e executiontui.ApprovalNeededEvent,
	tc toolrender.ToolCallInfo,
	subAgentID string,
	runningRendered, canCollapse bool,
	width int,
	opts approval.Options,
) {
	if canCollapse && runningRendered {
		termctl.EraseLines(r.cfg.status, 1)
	}

	expanded := r.buildExpandedView(tc)
	fmt.Fprint(r.cfg.status, expanded)
	expandedRows := termctl.DisplayRows(expanded, width)

	question := toolrender.ApprovalQuestion(tc)
	fmt.Fprintf(r.cfg.status, "%s\n", question)
	questionRows := termctl.DisplayRows(question+"\n", width)

	decision, menuRows, err := r.promptForDecision(ctx, opts)
	if err != nil {
		r.handlePromptError(e, err, expandedRows+questionRows+menuRows, canCollapse)
		return
	}

	action := actionToString(decision.Action)

	totalRows := expandedRows + questionRows + menuRows
	if canCollapse {
		termctl.EraseLines(r.cfg.status, totalRows)
	}

	r.printCollapsedResult(tc, action, subAgentID)
	r.trackSuppression(e.ToolCallID, tc.Name, action)

	r.cfg.approvalResponses <- executiontui.ApprovalResponse{
		Action:     action,
		ToolCallID: e.ToolCallID,
		Comment:    decision.Comment,
	}
	r.waitingApproval = nil
}

// resolveApprovalContext returns the ToolCallInfo, sub-agent ID, and whether
// a running line was rendered for this tool. Prefers the state saved by
// renderToolWaitingApproval; falls back to constructing a minimal
// ToolCallInfo from ApprovalNeededEvent fields.
func (r *inlineRenderer) resolveApprovalContext(e executiontui.ApprovalNeededEvent) (toolrender.ToolCallInfo, string, bool) {
	if r.waitingApproval != nil {
		return r.waitingApproval.tc, r.waitingApproval.subAgentID, r.waitingApproval.runningLineRendered
	}
	tc := toolrender.ToolCallInfo{
		Name:   e.ToolName,
		Status: "waiting_approval",
	}
	return tc, "", false
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
// result. Shell tools are excluded because their output only arrives
// via the completion event.
func (r *inlineRenderer) trackSuppression(toolCallID, toolName, action string) {
	if action == "reject" {
		return
	}
	if toolrender.ShouldSuppressCompletion(toolName) {
		r.suppressedToolIDs[toolCallID] = true
	}
}
