package root

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// readGroupThreshold is the minimum number of consecutive read tool completions
// that triggers grouped rendering via RenderReadGroup. Below this threshold,
// reads are rendered individually via RenderCompact.
const readGroupThreshold = 3

// inlineRenderConfig configures the inline (non-TUI) event renderer.
type inlineRenderConfig struct {
	events            <-chan executiontui.Event
	approvalResponses chan<- executiontui.ApprovalResponse
	prompter          approval.Prompter
	defaultAction     approval.Action
	data              io.Writer // AI content (stdout)
	status            io.Writer // status/progress (stderr)
	sessionID         string
}

// pendingRead wraps a read tool completion with the sub-agent context it
// originated from. This allows flushPendingReads to apply gutter-wrapping
// when reads belong to a sub-agent.
type pendingRead struct {
	tc         toolrender.ToolCallInfo
	subAgentID string
}

// waitingApprovalState holds context saved from ToolWaitingApprovalEvent
// for use by handleApproval when the subsequent ApprovalNeededEvent arrives.
type waitingApprovalState struct {
	tc                  toolrender.ToolCallInfo
	subAgentID          string
	runningLineRendered bool
	contentStreamed     bool // content was shown via ToolStreamDeltaEvent
	streamedRows        int  // total display rows of streamed content
}

// inlineRenderer consumes execution events and renders them to the terminal
// without the Bubbletea alt-screen TUI. AI content flows to the data writer
// (stdout) while all status/progress goes to the status writer (stderr).
//
// This enables piping: `stigmer run agent x | process_output` captures only
// the agent's response, while progress and tool activity remain visible on
// the terminal via stderr.
type inlineRenderer struct {
	cfg         inlineRenderConfig
	compactOpts toolrender.CompactOptions

	// Thinking spinner state — shows an animated indicator on stderr when
	// the agent is idle (reasoning between tool calls). The timer fires
	// after thinkingIdleDelay of inactivity; the spinner is cleared before
	// processing any event.
	spinner    *spinner.Spinner
	thinkTimer *time.Timer
	phase      string

	// AI streaming state — tracks incremental delta output so each render
	// only prints the bytes appended since the last delta event.
	inAIStream    bool
	streamedBytes int

	// pendingReads buffers consecutive read tool completions for grouped
	// rendering. Flushed when a non-read event arrives that produces visible
	// output, or when the stream terminates. Each entry is tagged with its
	// sub-agent context so gutter-wrapping is applied correctly on flush.
	pendingReads []pendingRead

	// lastRenderedRunningID is the ToolCallID of the tool whose running
	// indicator line was last printed to stderr. Used by handleApproval
	// to safely erase the running line before rendering the expanded view.
	lastRenderedRunningID string

	// waitingApproval holds the ToolCallInfo saved from the most recent
	// ToolWaitingApprovalEvent. handleApproval uses this to render the
	// expanded view and the collapsed result with full tool metadata.
	waitingApproval *waitingApprovalState

	// suppressedToolIDs tracks tool call IDs whose ToolCompletedEvent
	// should be suppressed because the approval result already rendered
	// the outcome. Write/edit/delete completions are suppressed; shell
	// completions are handled by the streaming interception instead.
	suppressedToolIDs map[string]bool

	// Tool content streaming state — tracks a tool call that is actively
	// streaming content via ToolStreamDeltaEvent. Used for both pre-approval
	// streaming (write/edit typewriter effect) and post-approval streaming
	// (shell output after user approves).
	activeStreamToolID string // tool call ID currently streaming
	toolStreamedBytes  int    // tool content bytes already printed (delta rendering)
	streamHeaderRows   int    // display rows for header portion (set at init)
	streamLineCount    int    // total display rows including content (for erase)
	streamSubAgentID   string // sub-agent context for gutter wrapping
}

// renderInline consumes events from the channel and renders them inline until
// a terminal event (DoneEvent or StreamErrorEvent) arrives. Returns the final
// phase string and any error message from the done event.
func renderInline(ctx context.Context, cfg inlineRenderConfig) (phase string, exitErr string) {
	thinkTimer := time.NewTimer(0)
	thinkTimer.Stop()
	select {
	case <-thinkTimer.C:
	default:
	}

	r := &inlineRenderer{
		cfg: cfg,
		compactOpts: toolrender.CompactOptions{
			HyperlinksEnabled: toolrender.HyperlinksEnabled(cfg.status),
		},
		suppressedToolIDs: make(map[string]bool),
		spinner:           spinner.New(cfg.status),
		thinkTimer:        thinkTimer,
	}

	for {
		select {
		case <-ctx.Done():
			r.stopThinkingSpinner()
			r.flushPendingReads()
			r.statusf("⚠ Stream cancelled\n")
			return "", "context cancelled"

		case event, ok := <-cfg.events:
			r.stopThinkingSpinner()
			r.thinkTimer.Stop()

			if !ok {
				r.flushPendingReads()
				return "", ""
			}

			done, p, e := r.handleEvent(ctx, event)
			if done {
				return p, e
			}
			r.resetThinkTimer()

		case <-r.thinkTimer.C:
			r.startThinkingSpinner()
		}
	}
}

// handleEvent dispatches a single event to the appropriate render method.
// Returns (true, phase, error) when a terminal event is received.
//
// Pre-switch interceptions handle four concerns:
//  1. Read grouping: completed reads buffer in pendingReads; running reads
//     and tool stream deltas are suppressed.
//  2. Approval completion suppression: tools whose outcome was already
//     rendered by the approval flow (write/edit/delete) have their
//     ToolCompletedEvent suppressed to avoid duplicate output.
//  3. Task tool suppression: the backend emits ToolRunning/ToolCompleted for
//     the parent "task" tool AND SubAgentStarted/Completed lifecycle events.
//     These are redundant — we suppress the tool events and use the lifecycle
//     events (which carry richer data: Description, ToolCount, Status).
//  4. Sub-agent AI redirection: sub-agent AI messages are intermediate
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
	// Suppress running indicators for read tools — reads complete fast,
	// the grouped completion renders the result.
	if e, ok := event.(executiontui.ToolRunningEvent); ok && toolrender.IsReadTool(e.ToolCall.Name) {
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

	// Initiate pre-approval streaming for write/edit tools whose content
	// is being generated by the AI (IsStreaming=true). The content will
	// appear progressively below the header until ToolWaitingApprovalEvent
	// transitions to the approval flow.
	if e, ok := event.(executiontui.ToolRunningEvent); ok && e.ToolCall.IsStreaming && toolrender.IsWriteOrEditTool(e.ToolCall.Name) {
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
			r.statusf("%s\n", toolrender.GutterWrap("🤖 "+e.Content))
		}
		return false, "", ""
	}
	if e, ok := event.(executiontui.AIMessageEvent); ok && e.SubAgentID != "" {
		r.flushPendingReads()
		r.finishAIStreamIfNeeded()
		if e.Content != "" {
			r.statusf("%s\n", toolrender.GutterWrap("🤖 "+e.Content))
		}
		return false, "", ""
	}

	// All remaining events produce visible output. Flush pending reads first.
	r.flushPendingReads()

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
	case executiontui.ToolRunningEvent:
		r.renderToolRunning(e)
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

// ---------------------------------------------------------------------------
// AI message rendering — content goes to data writer (stdout)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderAIStreamStart(e executiontui.AIStreamStartEvent) {
	r.finishAIStreamIfNeeded()
	prefix := r.agentPrefix(e.SubAgentID)
	fmt.Fprint(r.cfg.data, prefix)
	if len(e.Content) > 0 {
		fmt.Fprint(r.cfg.data, e.Content)
	}
	r.streamedBytes = len(e.Content)
	r.inAIStream = true
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamDelta(e executiontui.AIStreamDeltaEvent) {
	if len(e.Content) <= r.streamedBytes {
		return
	}
	fmt.Fprint(r.cfg.data, e.Content[r.streamedBytes:])
	r.streamedBytes = len(e.Content)
	r.flushData()
}

func (r *inlineRenderer) renderAIStreamEnd(e executiontui.AIStreamEndEvent) {
	if len(e.Content) > r.streamedBytes {
		fmt.Fprint(r.cfg.data, e.Content[r.streamedBytes:])
	}
	fmt.Fprint(r.cfg.data, "\n\n")
	r.inAIStream = false
	r.streamedBytes = 0
	r.flushData()

	if len(e.ToolCalls) > 0 {
		r.renderToolCalls(e.ToolCalls)
	}
}

func (r *inlineRenderer) renderAIMessage(e executiontui.AIMessageEvent) {
	r.finishAIStreamIfNeeded()
	if e.Content != "" {
		fmt.Fprintf(r.cfg.data, "%s\n\n", formatNonTUIAIText(e.Content))
		r.flushData()
	}
	if len(e.ToolCalls) > 0 {
		r.renderToolCalls(e.ToolCalls)
	}
}

func (r *inlineRenderer) renderHumanMessage(e executiontui.HumanMessageEvent) {
	r.finishAIStreamIfNeeded()
	r.statusf("💬 You: %s\n\n", e.Content)
}

// ---------------------------------------------------------------------------
// Tool call rendering — status goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderToolRunning(e executiontui.ToolRunningEvent) {
	line := toolrender.RenderCompactRunning(e.ToolCall, r.compactOpts)
	if e.SubAgentID != "" {
		line = toolrender.GutterWrap(line)
	}
	r.statusf("%s\n", line)
	r.lastRenderedRunningID = e.ToolCallID
}

func (r *inlineRenderer) renderToolCompleted(e executiontui.ToolCompletedEvent) {
	line := toolrender.RenderCompact(e.ToolCall, r.compactOpts)
	if e.SubAgentID != "" {
		line = toolrender.GutterWrap(line)
	}
	r.statusf("%s\n", line)
}

func (r *inlineRenderer) renderToolWaitingApproval(e executiontui.ToolWaitingApprovalEvent) {
	contentStreamed := e.ToolCallID == r.activeStreamToolID
	streamedRows := 0
	if contentStreamed {
		streamedRows = r.streamLineCount
		r.clearStreamingState()
	}
	r.waitingApproval = &waitingApprovalState{
		tc:                  e.ToolCall,
		subAgentID:          e.SubAgentID,
		runningLineRendered: r.lastRenderedRunningID == e.ToolCallID,
		contentStreamed:     contentStreamed,
		streamedRows:        streamedRows,
	}
}

func (r *inlineRenderer) renderToolCalls(toolCalls []toolrender.ToolCallInfo) {
	for _, tc := range toolCalls {
		r.statusf("%s\n", toolrender.Render(tc))
	}
	if len(toolCalls) > 0 {
		r.statusf("\n")
	}
}

// ---------------------------------------------------------------------------
// Status / lifecycle rendering — goes to status writer (stderr)
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderSystemMessage(e executiontui.SystemMessageEvent) {
	content := sanitizeSystemContent(e.Content)
	r.statusf("%s\n\n", systemMsgStyle.Render("ℹ️  "+content))
}

func (r *inlineRenderer) renderPhaseChange(e executiontui.PhaseChangeEvent) {
	r.phase = e.Phase
	switch e.Phase {
	case "pending":
		r.statusf("⏳ Execution pending...\n")
	case "in_progress":
		if e.Previous == "waiting_for_approval" {
			r.statusf("▶️  Resumed after approval\n")
		} else {
			r.statusf("▶️  Execution started\n")
		}
	case "completed":
		r.statusf("✅ Execution completed\n")
	case "failed":
		r.statusf("❌ Execution failed\n")
	case "cancelled":
		r.statusf("⚠️  Execution cancelled\n")
	case "waiting_for_approval":
		// Suppressed: the approval prompt itself is the signal.
		return
	}
}

func (r *inlineRenderer) renderTodoUpdate(e executiontui.TodoUpdateEvent) {
	r.statusf("📋 Plan:\n")
	for _, todo := range e.Todos {
		var icon string
		switch todo.Status {
		case "completed":
			icon = "✓"
		case "in_progress":
			icon = "⏳"
		case "cancelled":
			icon = "⏭"
		default:
			icon = "○"
		}
		r.statusf("  %s %s\n", icon, todo.Content)
	}
	r.statusf("\n")
}

func (r *inlineRenderer) renderSubAgentStarted(e executiontui.SubAgentStartedEvent) {
	label := e.Name
	if e.Description != "" {
		label = e.Description
	}
	r.statusf("%s %s: %s\n",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Task"), label)
}

func (r *inlineRenderer) renderSubAgentCompleted(e executiontui.SubAgentCompletedEvent) {
	if e.Status == "failed" {
		r.statusf("  ✗ Failed (%d tools)\n\n", e.ToolCount)
	} else {
		r.statusf("  ✓ Done (%d tools)\n\n", e.ToolCount)
	}
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

func (r *inlineRenderer) renderDone(e executiontui.DoneEvent) {
	r.finishAIStreamIfNeeded()
	if e.Error != "" {
		r.statusf("❌ %s\n", e.Error)
	}
}

func (r *inlineRenderer) renderStreamError(e executiontui.StreamErrorEvent) {
	r.finishAIStreamIfNeeded()
	r.statusf("❌ Stream error: %s\n", e.Err.Error())
	if r.cfg.sessionID != "" {
		r.statusf("   Re-attach with: stigmer run %s\n", r.cfg.sessionID)
	}
}

// handleApproval is defined in run_stream_inline_approval.go — it
// orchestrates the expand/prompt/collapse/suppress approval flow.

// ---------------------------------------------------------------------------
// Read grouping
// ---------------------------------------------------------------------------

// flushPendingReads renders any buffered read tool completions. When the buffer
// contains readGroupThreshold or more reads, they are rendered as a compact
// group. Otherwise, each read is rendered individually.
//
// All pending reads share the same sub-agent context (events don't interleave
// across agents), so checking the first entry's subAgentID is sufficient to
// determine whether gutter-wrapping is needed.
func (r *inlineRenderer) flushPendingReads() {
	if len(r.pendingReads) == 0 {
		return
	}

	subAgentID := r.pendingReads[0].subAgentID
	tcs := make([]toolrender.ToolCallInfo, len(r.pendingReads))
	for i, pr := range r.pendingReads {
		tcs[i] = pr.tc
	}

	var output string
	if len(tcs) >= readGroupThreshold {
		output = toolrender.RenderReadGroup(tcs, r.compactOpts)
	} else {
		var lines []string
		for _, tc := range tcs {
			lines = append(lines, toolrender.RenderCompact(tc, r.compactOpts))
		}
		output = strings.Join(lines, "\n")
	}

	if subAgentID != "" {
		output = toolrender.GutterWrap(output)
	}
	r.statusf("%s\n", output)
	r.pendingReads = r.pendingReads[:0]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// finishAIStreamIfNeeded closes an in-progress AI stream with a newline if
// a non-AI event arrives mid-stream. Prevents garbled output when status
// events interleave with streaming AI content.
func (r *inlineRenderer) finishAIStreamIfNeeded() {
	if r.inAIStream {
		fmt.Fprint(r.cfg.data, "\n\n")
		r.flushData()
		r.inAIStream = false
		r.streamedBytes = 0
	}
}

// agentPrefix returns the AI message prefix, adjusted for sub-agent context.
func (r *inlineRenderer) agentPrefix(subAgentID string) string {
	if subAgentID != "" {
		return "🤖 Sub-agent: "
	}
	return "🤖 Agent: "
}

func (r *inlineRenderer) statusf(format string, args ...interface{}) {
	fmt.Fprintf(r.cfg.status, format, args...)
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
