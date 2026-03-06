package root

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/termctl"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// renderInline consumes events from the channel and renders them inline until
// a terminal event (DoneEvent or StreamErrorEvent) arrives. Returns a
// renderResult with the final phase, error, accumulated history, and optional
// follow-up input.
//
// When cfg.followUpEnabled is true and the terminal event's phase is eligible,
// the renderer activates the follow-up text input and continues the event
// loop instead of returning. This keeps toggleExpandCh active so Ctrl+O
// triggers immediate re-commit during the follow-up prompt. The renderer
// returns only when the user submits or cancels the follow-up.
//
// When cfg.initialHistory is non-nil (continuation from a prior execution),
// the renderer seeds its buffer from it. Otherwise it creates a fresh history
// with the session header as the first entry.
func renderInline(ctx context.Context, cfg inlineRenderConfig) renderResult {
	thinkTimer := time.NewTimer(0)
	thinkTimer.Stop()
	select {
	case <-thinkTimer.C:
	default:
	}

	var initialHistory []committedItem
	isNewSession := len(cfg.initialHistory) == 0
	if isNewSession {
		initialHistory = []committedItem{{
			kind:   kindHeader,
			header: &cfg.headerInfo,
		}}
	} else {
		initialHistory = cfg.initialHistory
	}

	r := &inlineRenderer{
		cfg:       cfg,
		dataIsTTY: termctl.IsSupported(cfg.data),
		compactOpts: toolrender.CompactOptions{
			HyperlinksEnabled: toolrender.HyperlinksEnabled(cfg.status),
			WorkspaceRoots:    cfg.workspaceRoots,
		},
		suppressedToolIDs: make(map[string]bool),
		thinkTimer:        thinkTimer,
		history:           initialHistory,
	}

	if isNewSession {
		header := renderHeaderItem(initialHistory[0], false)
		if header != "" {
			r.writeToScrollback(kindHeader, header)
		}
	} else {
		r.lastScrollbackKind = lastKindFromHistory(initialHistory)
	}

	for {
		recommitNeeded := false

		select {
		case <-ctx.Done():
			r.stopThinkingSpinner()
			r.flushPendingReads()
			r.statusf("Stream cancelled\n")
			return renderResult{exitErr: "context cancelled", history: r.history}

		case subject, ok := <-cfg.subjectUpdate:
			if ok && subject != "" {
				r.history[0].header.Subject = subject
				cfg.subjectUpdate = nil
				recommitNeeded = true
			}

		case sessions, ok := <-cfg.recentSessionsCh:
			if ok && len(sessions) > 0 {
				r.history[0].header.RecentSessions = sessions
				cfg.recentSessionsCh = nil
				recommitNeeded = true
			}

		case <-cfg.toggleExpandCh:
			r.expandMode = !r.expandMode
			recommitNeeded = true

		case <-cfg.interruptCh:
			r.stopThinkingSpinner()
			r.flushPendingReads()
			r.finishAIStreamIfNeeded()
			if r.cfg.cancelExecFn != nil {
				go r.cfg.cancelExecFn()
			}
			r.commitToScrollback(committedItem{
				kind: kindSystemMessage,
				text: systemMsgStyle.Render("Interrupted"),
			})
			if cfg.followUpEnabled {
				r.activateFollowUp("interrupted", "")
				cfg.events = nil
				cfg.subjectUpdate = nil
				continue
			}
			return renderResult{phase: "cancelled", history: r.history}

		case <-cfg.cancelCh:
			r.stopThinkingSpinner()
			r.flushPendingReads()
			if r.cfg.cancelExecFn != nil {
				go r.cfg.cancelExecFn()
			}
			r.statusf("\nSession ended by user\n")
			if r.cfg.sessionID != "" {
				r.statusf("Resume later with: stigmer run %s\n", r.cfg.sessionID)
			}
			return renderResult{phase: "cancelled", history: r.history}

		case event, ok := <-cfg.events:
			r.stopThinkingSpinner()
			r.thinkTimer.Stop()

			if !ok {
				r.flushPendingReads()
				return renderResult{history: r.history}
			}

			done, p, e := r.handleEvent(ctx, event)
			if done {
				if cfg.followUpEnabled && isFollowUpEligible(p, e) {
					r.activateFollowUp(p, e)
					cfg.events = nil
					cfg.subjectUpdate = nil
					continue
				}
				return renderResult{phase: p, exitErr: e, history: r.history}
			}
			r.resetThinkTimer()

		case input := <-r.followUpInputCh:
			return r.completeFollowUp(strings.TrimSpace(input))

		case <-r.thinkTimer.C:
			r.startThinkingSpinner()
		}

		// Coalesce additional recommit triggers that are already queued.
		// After processing one channel that sets recommitNeeded, drain any
		// other ready channels before issuing a single triggerReCommit.
		if recommitNeeded {
			r.drainRecommitTriggers(&cfg)
			r.triggerReCommit()
		}
	}
}

// activateFollowUp transitions the renderer from execution mode to follow-up
// mode. Stops any active spinner, flushes buffered reads, stores the terminal
// event's phase/error, and activates the Bubbletea text input.
func (r *inlineRenderer) activateFollowUp(phase, exitErr string) {
	r.stopThinkingSpinner()
	r.flushPendingReads()
	r.thinkTimer.Stop()

	r.donePhase = phase
	r.doneExitErr = exitErr

	inputCh := make(chan string, 1)
	r.followUpInputCh = inputCh
	r.cfg.program.Send(textInputStartMsg{inputCh: inputCh})
}

// drainRecommitTriggers non-blockingly absorbs any additional recommit
// triggers (subjectUpdate, recentSessionsCh) that are already queued.
// Called after the main select fires a recommit-worthy case, so that
// multiple near-simultaneous triggers produce a single triggerReCommit.
func (r *inlineRenderer) drainRecommitTriggers(cfg *inlineRenderConfig) {
	for {
		select {
		case subject, ok := <-cfg.subjectUpdate:
			if ok && subject != "" {
				r.history[0].header.Subject = subject
				cfg.subjectUpdate = nil
			}
		case sessions, ok := <-cfg.recentSessionsCh:
			if ok && len(sessions) > 0 {
				r.history[0].header.RecentSessions = sessions
				cfg.recentSessionsCh = nil
			}
		default:
			return
		}
	}
}

// completeFollowUp processes the user's follow-up input and returns a
// renderResult. On non-empty input, the styled human message is committed
// to both the terminal (via textInputHideMsg) and the history buffer.
func (r *inlineRenderer) completeFollowUp(input string) renderResult {
	if input == "" {
		r.cfg.program.Send(textInputHideMsg{})
		return renderResult{
			phase:   r.donePhase,
			exitErr: r.doneExitErr,
			history: r.history,
		}
	}

	styledMsg := fmt.Sprintf("%s\n\n", formatHumanMessage(input))
	r.cfg.program.Send(textInputHideMsg{styledMessage: styledMsg})

	r.recordToHistory(committedItem{
		kind: kindHumanMessage,
		text: formatHumanMessage(input),
	})

	return renderResult{
		phase:         r.donePhase,
		exitErr:       r.doneExitErr,
		history:       r.history,
		followUpInput: input,
	}
}

// handleEvent dispatches a single event to the appropriate render method.
// Returns (true, phase, error) when a terminal event is received.
//
// Pre-switch interceptions handle five concerns:
//  1. Read grouping: completed reads buffer in pendingReads; running reads
//     and tool stream deltas are suppressed.
//  2. Approval completion suppression: tools whose outcome was already
//     rendered by the approval flow (write/edit/delete) have their
//     ToolCompletedEvent suppressed to avoid duplicate output.
//  3. Task tool suppression: the backend emits ToolRunning/ToolCompleted for
//     the parent "task" tool AND SubAgentStarted/Completed lifecycle events.
//     These are redundant — we suppress the tool events and use the lifecycle
//     events (which carry richer data: Description, ToolCount, Status).
//  4. Running indicator suppression: all ToolRunningEvent are suppressed.
//     Non-streaming tools show only their completed result. The append-only
//     stream model cannot reliably erase running lines when events interleave.
//  5. Sub-agent AI redirection: sub-agent AI messages are intermediate
//     reasoning, not the final agent response. They render on stderr with
//     gutter prefix instead of stdout.
func (r *inlineRenderer) handleEvent(ctx context.Context, event executiontui.Event) (done bool, phase string, exitErr string) {
	// Buffer read completions for consecutive-event grouping.
	if e, ok := event.(executiontui.ToolCompletedEvent); ok && toolrender.IsReadTool(e.ToolCall.Name) {
		r.pendingReads = append(r.pendingReads, pendingRead{tc: e.ToolCall, subAgentID: e.SubAgentID})
		return false, "", ""
	}
	// Suppress ToolCompletedEvent for tools whose outcome was already
	// rendered by the approval collapse (write/edit/delete). Shell
	// completions are NOT suppressed — their output is the only way to
	// see shell results until Phase 3.4 enables streaming.
	if e, ok := event.(executiontui.ToolCompletedEvent); ok && r.suppressedToolIDs[e.ToolCallID] {
		r.flushPendingReads()
		delete(r.suppressedToolIDs, e.ToolCallID)
		return false, "", ""
	}
	// Handle completion of a tool that was streaming output via
	// ToolStreamDeltaEvent. Erases the streaming content and prints the
	// final compact result. This interception runs before the main switch
	// so the completion never reaches renderToolCompleted.
	if e, ok := event.(executiontui.ToolCompletedEvent); ok && e.ToolCallID == r.activeStreamToolID {
		r.flushPendingReads()
		r.completeStreamingTool(e)
		return false, "", ""
	}
	// Suppress running indicators for read and think tools — reads
	// complete fast and are grouped on completion; think tools complete
	// near-instantly once content is ready, and the thinking spinner
	// already provides idle feedback.
	if e, ok := event.(executiontui.ToolRunningEvent); ok &&
		(toolrender.IsReadTool(e.ToolCall.Name) || toolrender.IsThinkTool(e.ToolCall.Name)) {
		return false, "", ""
	}
	// Route tool stream deltas to the streaming renderer when a tool is
	// actively streaming. Otherwise suppress. Must NOT flush the read
	// buffer — a concurrent streaming tool would break read grouping.
	if e, ok := event.(executiontui.ToolStreamDeltaEvent); ok {
		if e.ToolCallID == r.activeStreamToolID {
			r.renderToolStreamDelta(e)
		}
		return false, "", ""
	}

	// Initiate pre-approval streaming for any tool whose content is being
	// generated by the AI (IsStreaming=true). The content is committed to
	// scrollback progressively as lines complete, giving the user a live
	// typewriter view of what the agent is producing. ToolWaitingApprovalEvent
	// transitions to the approval flow. Read, think, and task tools are
	// already intercepted above this point.
	if e, ok := event.(executiontui.ToolRunningEvent); ok && e.ToolCall.IsStreaming {
		r.flushPendingReads()
		r.initPreApprovalStreaming(e)
		return false, "", ""
	}

	// Suppress the parent "task" tool's running/completed events. The
	// SubAgentStarted/Completed lifecycle events handle the header and
	// footer with richer data. Flush pending reads first — a top-level
	// read might be buffered when the task tool event arrives.
	if e, ok := event.(executiontui.ToolRunningEvent); ok && toolrender.IsTaskTool(e.ToolCall.Name) && e.SubAgentID == "" {
		r.flushPendingReads()
		return false, "", ""
	}
	if e, ok := event.(executiontui.ToolCompletedEvent); ok && toolrender.IsTaskTool(e.ToolCall.Name) && e.SubAgentID == "" {
		r.flushPendingReads()
		return false, "", ""
	}

	// Suppress all remaining running indicators. Non-streaming tools
	// (list, search, find, execute, shell pre-approval, etc.) show only
	// their completed result — running indicators are not rendered because
	// the append-only stream model cannot reliably erase them when events
	// interleave. Read, think, task, and pre-approval streaming running
	// events are already handled by earlier interceptions above.
	if _, ok := event.(executiontui.ToolRunningEvent); ok {
		return false, "", ""
	}

	// Sub-agent AI messages are intermediate reasoning — render on stderr
	// with gutter prefix instead of stdout. We suppress Start/Delta and
	// emit the full content on End/Message to avoid character-by-character
	// streaming with per-line gutter insertion.
	if e, ok := event.(executiontui.AIStreamStartEvent); ok && e.SubAgentID != "" {
		return false, "", ""
	}
	if e, ok := event.(executiontui.AIStreamDeltaEvent); ok && e.SubAgentID != "" {
		return false, "", ""
	}
	if e, ok := event.(executiontui.AIStreamEndEvent); ok && e.SubAgentID != "" {
		r.flushPendingReads()
		r.finishAIStreamIfNeeded()
		if e.Content != "" {
			r.statusf("%s\n", toolrender.GutterWrap(e.Content))
		}
		return false, "", ""
	}
	if e, ok := event.(executiontui.AIMessageEvent); ok && e.SubAgentID != "" {
		r.flushPendingReads()
		r.finishAIStreamIfNeeded()
		if e.Content != "" {
			r.statusf("%s\n", toolrender.GutterWrap(e.Content))
		}
		return false, "", ""
	}

	// Flush buffered state before events that produce visible output.
	//
	// AIStreamStartEvent flushes pending reads to create a natural
	// grouping boundary: reads from the preceding AI message context
	// are rendered before the new message begins. finishAIStreamIfNeeded
	// is not called here because renderAIStreamStart handles it.
	//
	// AIStreamDeltaEvent and AIStreamEndEvent skip flushing entirely —
	// they are mid-stream events that manage the AI stream lifecycle
	// internally.
	//
	// All other events close any open AI stream and flush pending reads
	// before rendering to stderr, preventing garbled interleaving.

	switch event.(type) {
	case executiontui.AIStreamStartEvent:
		r.flushPendingReads()
	case executiontui.AIStreamDeltaEvent, executiontui.AIStreamEndEvent:
	default:
		r.finishAIStreamIfNeeded()
		r.flushPendingReads()
	}

	switch e := event.(type) {
	case executiontui.AIStreamStartEvent:
		r.renderAIStreamStart(e)
	case executiontui.AIStreamDeltaEvent:
		r.renderAIStreamDelta(e)
	case executiontui.AIStreamEndEvent:
		r.renderAIStreamEnd(e)
	case executiontui.AIMessageEvent:
		r.renderAIMessage(e)
	case executiontui.HumanMessageEvent:
		r.renderHumanMessage(e)
	case executiontui.ToolCompletedEvent:
		r.renderToolCompleted(e)
	case executiontui.ToolWaitingApprovalEvent:
		r.renderToolWaitingApproval(e)
	case executiontui.SystemMessageEvent:
		r.renderSystemMessage(e)
	case executiontui.PhaseChangeEvent:
		r.renderPhaseChange(e)
	case executiontui.ApprovalNeededEvent:
		r.handleApproval(ctx, e)
		if r.exitRequested {
			return true, "cancelled", ""
		}
	case executiontui.TodoUpdateEvent:
		r.renderTodoUpdate(e)
	case executiontui.SubAgentStartedEvent:
		r.renderSubAgentStarted(e)
	case executiontui.SubAgentCompletedEvent:
		r.renderSubAgentCompleted(e)
	case executiontui.DoneEvent:
		r.renderDone(e)
		return true, e.Phase, e.Error
	case executiontui.StreamErrorEvent:
		r.renderStreamError(e)
		return true, "", e.Err.Error()
	}
	return false, "", ""
}
