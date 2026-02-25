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

	case followUpStartedMsg:
		return m.handleFollowUpStarted(msg)

	case followUpErrorMsg:
		return m.handleFollowUpError(msg)

	case activityTickMsg:
		return m.handleActivityTick()

	case subjectFetchedMsg:
		return m.handleSubjectFetched(msg)

	case spinner.TickMsg:
		// Animate the spinner during the pending phase and when the
		// thinking indicator is visible (idle during in_progress).
		// Once neither condition holds, stop issuing tick commands so
		// the spinner sleeps until restarted by the activity tick.
		if m.phase == "pending" || m.thinkingVisible {
			var cmd tea.Cmd
			m.spinner, cmd = m.spinner.Update(msg)
			if m.thinkingVisible {
				// Refresh the viewport so the spinner frame in the
				// thinking indicator animates along with the header.
				m.refreshViewport()
			}
			return m, cmd
		}
		return m, nil
	}

	// Forward unhandled messages to the appropriate sub-component.
	// When the input composer is active, the textarea needs tick messages
	// for cursor blink. The viewport always gets a chance to handle scroll.
	var cmds []tea.Cmd

	if m.inputActive {
		var taCmd tea.Cmd
		m.textarea, taCmd = m.textarea.Update(msg)
		cmds = append(cmds, taCmd)
	}

	var vpCmd tea.Cmd
	m.viewport, vpCmd = m.viewport.Update(msg)
	m.autoScroll = m.viewport.AtBottom()
	cmds = append(cmds, vpCmd)

	return m, tea.Batch(cmds...)
}

// handleKeyPress processes keyboard input. Priority order:
//  1. Ctrl+C always quits (unchanged regardless of mode)
//  2. Input active — textarea captures all keys; Enter submits, Esc exits
//  3. Quit/detach keys (q)
//  4. Cancel confirmation keys (when cancel confirm is shown)
//  5. Help toggle (? key — available except during approval/cancel confirm)
//  6. Help dismiss (esc — only when help is shown)
//  7. Help blocks all other keys when active
//  8. Approval keys (a/s/r — when approval is active)
//  9. Cancel key (c — when execution is running)
//  10. Navigation keys (shared: focus, toggle, scroll — see handleNavigationKey)
func (m Model) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Ctrl+C always quits, regardless of input mode.
	if msg.String() == "ctrl+c" {
		return m, tea.Quit
	}

	// When the input composer is active, the textarea captures all keys.
	// Only Ctrl+C (above) and Esc bypass it.
	if m.inputActive {
		return m.handleInputKey(msg)
	}

	// q quits/detaches (only when input is not active).
	if msg.String() == "q" {
		m.cancelConfirm = false
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

	// Route to approval handler when active — processes a/s/r for approval
	// decisions, then falls through to navigation for all other keys so the
	// user can Tab/Enter to expand tool blocks and scroll the viewport while
	// deciding whether to approve.
	if m.approval != nil {
		return m.handleApprovalKey(msg)
	}

	// Cancel key — available when execution is running and not already cancelling.
	if msg.String() == "c" && !m.done && !m.cancelling && m.activeCancelFn != nil {
		m.cancelConfirm = true
		return m, nil
	}

	return m.handleNavigationKey(msg)
}

// handleNavigationKey processes focus, toggle, and scroll keys. This is the
// shared handler called from both the normal key path and the approval key
// path, ensuring that users can always navigate and expand/collapse tool
// blocks regardless of whether an approval prompt is active.
//
// Keys handled:
//   - Tab / Shift+Tab: cycle focus among expandable blocks
//   - Enter: toggle expand/collapse on the focused block
//   - g / G: jump to top / bottom of viewport
//   - Arrow keys, Page Up/Down, etc.: viewport scroll (forwarded to bubbles/viewport)
func (m Model) handleNavigationKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
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
	cancelFn := m.activeCancelFn
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
// than the idle threshold, it activates the thinking indicator — both in the
// header (animated spinner) and in the viewport (ephemeral "Thinking..." text)
// — to signal that the agent is alive and processing.
func (m Model) handleActivityTick() (tea.Model, tea.Cmd) {
	// Don't schedule more ticks once execution is done or the user is
	// composing a follow-up. The tick will be restarted when a follow-up
	// execution begins.
	if m.done || m.inputActive {
		return m, nil
	}

	// Detect idle: in_progress phase with no recent events and no active
	// approval prompt. During approval, the user is the one being waited on
	// — showing a "Thinking..." indicator would be misleading.
	if m.phase == "in_progress" && m.approval == nil && time.Since(m.lastEventAt) > idleThreshold {
		if !m.thinkingVisible {
			m.thinkingVisible = true
			// Show the viewport indicator immediately rather than
			// waiting for the first spinner tick to trigger a refresh.
			m.refreshViewport()
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

	// Reserve lines for header, footer, and (when conversational mode is
	// enabled) the input composer area.
	chrome := headerHeight + footerHeight
	if m.hasInputArea() {
		chrome += inputAreaHeight
		m.textarea.SetWidth(m.width)
	}

	viewportHeight := m.height - chrome
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

	// Rebuild viewport content through the shared path so the thinking
	// indicator is included when active.
	m.refreshViewport()

	return m, nil
}

// handleSubjectFetched processes the result of a background session-subject
// poll. When a real subject arrives it is written into the config so
// renderHeader() picks it up on the next frame — no viewport refresh needed
// because Bubbletea re-renders the full view on every state change.
//
// When the result is empty the backend has not yet replaced the sentinel;
// the handler schedules the next retry if attempts remain and the execution
// is still running. All retries are silently dropped once the execution
// reaches a terminal phase.
func (m Model) handleSubjectFetched(msg subjectFetchedMsg) (tea.Model, tea.Cmd) {
	if msg.subject != "" {
		m.cfg.SessionSubject = msg.subject
		return m, nil
	}
	if m.done || m.cfg.SubjectFetchFn == nil {
		return m, nil
	}
	if m.subjectFetchAttempt < len(subjectFetchBackoff) {
		delay := subjectFetchBackoff[m.subjectFetchAttempt]
		m.subjectFetchAttempt++
		return m, scheduleSubjectFetch(delay, m.cfg.SubjectFetchFn)
	}
	return m, nil
}
