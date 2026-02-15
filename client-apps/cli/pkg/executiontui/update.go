package executiontui

import (
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

	case spinner.TickMsg:
		// Animate the spinner only during the pending phase.
		// Once the phase changes, stop issuing tick commands.
		if m.phase == "pending" {
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
//  1. Quit keys (always available)
//  2. Help toggle (? key — always available)
//  3. Help dismiss (esc — only when help is shown)
//  4. Help blocks all other keys when active
//  5. Approval keys (when approval is active, captures all input)
//  6. Focus/toggle keys (Tab, Shift+Tab, Enter)
//  7. Navigation keys (g top, G bottom)
//  8. Viewport scroll keys (forwarded to bubbles/viewport)
func (m Model) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Always allow quit.
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	}

	// Help toggle — available in all states except approval.
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

