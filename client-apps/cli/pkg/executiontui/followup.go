package executiontui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// FollowUpFn creates a new execution within the current session and returns
// the channels needed to stream its events. The TUI calls this when the user
// submits a follow-up message after an execution completes.
//
// The callback is responsible for:
//   - Creating a new execution via the backend (using the session ID)
//   - Subscribing to the new execution's gRPC stream
//   - Launching a goroutine that converts stream updates to TUI events
//   - Returning the new channels and cancel function
//
// When nil on Config, conversational follow-ups are disabled and the TUI
// exits on execution completion (pre-Phase 2 behavior).
type FollowUpFn func(message string) (*FollowUpResult, error)

// FollowUpResult contains the channels and callbacks for a newly created
// follow-up execution. Each field mirrors the corresponding Config field
// for the initial execution.
type FollowUpResult struct {
	// ExecutionID is the backend identifier for the new execution.
	ExecutionID string

	// Events is the channel from which the TUI receives events for the
	// new execution. Owned by the streamToEvents goroutine.
	Events <-chan Event

	// ApprovalResponses is the channel where the TUI sends approval
	// decisions for the new execution.
	ApprovalResponses chan<- ApprovalResponse

	// CancelFn cancels the new execution on the backend.
	CancelFn func() error
}

// handleFollowUpStarted processes a successful follow-up creation. It swaps
// the active channels to the new execution, resets execution-scoped state,
// and starts listening for events from the new stream.
//
// Session-scoped state (blocks, viewport, terminal dimensions) is preserved
// so the conversation continues seamlessly in the same viewport.
func (m Model) handleFollowUpStarted(msg followUpStartedMsg) (tea.Model, tea.Cmd) {
	r := msg.result

	// Swap active channels and execution tracking to the new execution.
	m.activeEvents = r.Events
	m.activeApprovals = r.ApprovalResponses
	m.activeCancelFn = r.CancelFn
	m.latestExecutionID = r.ExecutionID

	if m.cfg.Verbose {
		m.blocks = append(m.blocks, newSystemBlock(
			renderSystemContent("Follow-up execution: "+r.ExecutionID),
		))
	}

	// Reset execution-scoped state.
	m.phase = "pending"
	m.streaming = nil
	m.runningTools = make(map[string]int)
	m.subAgentMeta = make(map[string]subAgentInfo)
	m.subAgentBlockIdx = make(map[string]int)
	m.todoBlockIdx = -1
	m.approval = nil
	m.inputActive = false
	m.done = false
	m.exitError = ""
	m.thinkingVisible = false
	m.lastEventAt = time.Now()
	m.cancelling = false
	m.cancelConfirm = false

	m.refreshViewport()

	// Start listening for events from the new execution and restart the
	// spinner and activity tick for the pending phase.
	return m, tea.Batch(
		listenForEvents(m.activeEvents),
		m.spinner.Tick,
		scheduleActivityTick(),
	)
}

// handleFollowUpError processes a failed follow-up creation. It shows the
// error in the transcript and reactivates the input composer so the user
// can retry or exit.
func (m Model) handleFollowUpError(msg followUpErrorMsg) (tea.Model, tea.Cmd) {
	m.blocks = append(m.blocks, newErrorBlock(
		renderErrorContent("Follow-up failed: "+msg.err.Error()),
	))
	m.inputActive = true
	m.textarea.Focus()
	m.refreshViewport()
	return m, nil
}
