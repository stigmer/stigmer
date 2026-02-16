package executiontui

import (
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

// Update implements tea.Model. It dispatches incoming messages to focused
// handlers based on the message type.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.handleKeyPress(msg)

	case tea.WindowSizeMsg:
		return m.handleWindowSize(msg)

	case executionEventMsg:
		return m.handleExecutionEvent(msg.event)

	case streamClosedMsg:
		return m.handleStreamClosed()

	case cancelResultMsg:
		return m.handleCancelResult(msg)

	case activityTickMsg:
		return m.handleActivityTick()

	case spinner.TickMsg:
		// Animate the spinner during the pending phase and when the
		// thinking indicator is visible (idle during in_progress).
		// Once neither condition holds, stop issuing tick commands so
		// the spinner sleeps until restarted by the activity tick.
		if m.phase == "pending" || m.thinkingVisible {
			var cmd tea.Cmd
			m.spinner, cmd = m.spinner.Update(msg)
			return m, cmd
		}
		return m, nil
	}

	// Forward unhandled messages to the viewport for scroll handling.
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	m.autoScroll = m.viewport.AtBottom()
	return m, cmd
}

// handleKeyPress processes keyboard input. Priority order:
//  1. Quit/detach keys (always available)
//  2. Cancel confirmation keys (when cancel confirm is shown)
//  3. Help toggle (? key — available except during approval/cancel confirm)
//  4. Help dismiss (esc — only when help is shown)
//  5. Help blocks all other keys when active
//  6. Approval keys (when approval is active, captures all input)
//  7. Cancel key (c — when execution is running)
//  8. Focus/toggle keys (Tab, Shift+Tab, Enter)
//  9. Navigation keys (g top, G bottom)
//  10. Viewport scroll keys (forwarded to bubbles/viewport)
func (m Model) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Always allow quit/detach.
	switch msg.String() {
	case "ctrl+c", "q":
		m.cancelConfirm = false // dismiss any pending confirmation
		return m, tea.Quit
	}

	// Cancel confirmation captures input — only y/n/esc are accepted.
	if m.cancelConfirm {
		return m.handleCancelConfirmKey(msg)
	}

	// Help toggle — available in all states except approval and cancel confirm.
	if msg.String() == "?" && m.approval == nil {
		m.showHelp = !m.showHelp
		return m, nil
	}

	// When help is shown, only esc dismisses — all other keys are blocked.
	if m.showHelp {
		if msg.String() == "esc" {
			m.showHelp = false
		}
		return m, nil
	}

	// Route to approval handler when active — approval captures all input.
	if m.approval != nil {
		return m.handleApprovalKey(msg)
	}

	// Cancel key — available when execution is running and not already cancelling.
	if msg.String() == "c" && !m.done && !m.cancelling && m.cfg.CancelFn != nil {
		m.cancelConfirm = true
		return m, nil
	}

	// Focus and toggle keys for expandable blocks.
	switch msg.String() {
	case "tab":
		m.focusNextExpandable()
		m.refreshViewport()
		m.scrollFocusedBlockIntoView()
		m.autoScroll = m.viewport.AtBottom()
		return m, nil
	case "shift+tab":
		m.focusPrevExpandable()
		m.refreshViewport()
		m.scrollFocusedBlockIntoView()
		m.autoScroll = m.viewport.AtBottom()
		return m, nil
	case "enter":
		if m.focusedBlockIndex >= 0 {
			m.toggleFocusedBlock()
			m.refreshViewport()
			return m, nil
		}
	}

	// Navigation keys: jump to top/bottom of viewport.
	switch msg.String() {
	case "g":
		m.viewport.GotoTop()
		m.autoScroll = false
		return m, nil
	case "G":
		m.viewport.GotoBottom()
		m.autoScroll = true
		return m, nil
	}

	// Forward to viewport for default scroll handling (arrow keys, page
	// up/down, etc.). After the viewport processes the key, update autoScroll
	// based on whether we ended up at the bottom.
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	m.autoScroll = m.viewport.AtBottom()
	return m, cmd
}

// handleCancelConfirmKey processes keys during the cancel confirmation prompt.
// Only y (confirm), n, and esc (dismiss) are accepted; other keys are ignored.
func (m Model) handleCancelConfirmKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y":
		m.cancelConfirm = false
		m.cancelling = true
		m.blocks = append(m.blocks, newSystemBlock(
			systemStyle.Render("Cancelling execution..."),
		))
		m.refreshViewport()
		return m, m.executeCancelCmd()
	case "n", "esc":
		m.cancelConfirm = false
		return m, nil
	default:
		// Ignore unrecognized keys during confirmation.
		return m, nil
	}
}

// executeCancelCmd returns a tea.Cmd that calls the CancelFn asynchronously.
// The result is delivered as a cancelResultMsg.
func (m Model) executeCancelCmd() tea.Cmd {
	cancelFn := m.cfg.CancelFn
	return func() tea.Msg {
		err := cancelFn()
		return cancelResultMsg{err: err}
	}
}

// handleCancelResult processes the result of an asynchronous cancel API call.
// On success, the TUI waits for the stream to deliver the phase change.
// On failure, the cancelling state is cleared and an error is shown.
func (m Model) handleCancelResult(msg cancelResultMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.cancelling = false
		m.blocks = append(m.blocks, newErrorBlock(
			renderErrorContent("Cancel failed: "+msg.err.Error()),
		))
		m.refreshViewport()
	}
	// On success: nothing to do here. The backend will transition the execution
	// to CANCELLED, and the stream will deliver a DoneEvent with phase "cancelled".
	return m, nil
}

// activityTickInterval is the interval between activity tick checks.
// A 1-second interval provides responsive idle detection without
// excessive CPU usage.
const activityTickInterval = 1 * time.Second

// idleThreshold is how long the TUI waits without events before showing
// the thinking indicator. Two seconds strikes a balance between
// responsiveness (not too long to wait) and avoiding flicker (not shown
// during brief gaps between rapid events).
const idleThreshold = 2 * time.Second

// scheduleActivityTick returns a tea.Cmd that delivers an activityTickMsg
// after the activity tick interval. The tick runs continuously during
// execution and is used to detect idle periods for the thinking indicator
// and stale connections for the health warning.
func scheduleActivityTick() tea.Cmd {
	return tea.Tick(activityTickInterval, func(time.Time) tea.Msg {
		return activityTickMsg{}
	})
}

// handleActivityTick processes the periodic activity tick. When the TUI is
// in the "in_progress" phase and no execution events have arrived for longer
// than the idle threshold, it activates the thinking indicator (animated
// spinner) in the header to signal that the agent is alive and processing.
func (m Model) handleActivityTick() (tea.Model, tea.Cmd) {
	// Don't schedule more ticks once execution is done.
	if m.done {
		return m, nil
	}

	// Detect idle: in_progress phase with no recent events.
	if m.phase == "in_progress" && time.Since(m.lastEventAt) > idleThreshold {
		if !m.thinkingVisible {
			m.thinkingVisible = true
			// Restart the spinner animation — it was stopped when the
			// phase transitioned from "pending" to "in_progress".
			return m, tea.Batch(m.spinner.Tick, scheduleActivityTick())
		}
	}

	return m, scheduleActivityTick()
}

// handleWindowSize initializes or resizes the viewport based on terminal
// dimensions. The viewport occupies the space between the header and footer.
func (m Model) handleWindowSize(msg tea.WindowSizeMsg) (tea.Model, tea.Cmd) {
	m.width = msg.Width
	m.height = msg.Height

	// Reserve lines for header and footer.
	viewportHeight := m.height - headerHeight - footerHeight
	if viewportHeight < 1 {
		viewportHeight = 1
	}

	if !m.ready {
		m.viewport = newViewport(m.width, viewportHeight)
		m.ready = true
	} else {
		m.viewport.Width = m.width
		m.viewport.Height = viewportHeight
	}

	// Rebuild and set content with current blocks.
	m.viewport.SetContent(rebuildViewportContent(m.blocks, m.focusedBlockIndex))
	if m.autoScroll {
		m.viewport.GotoBottom()
	}

	return m, nil
}
