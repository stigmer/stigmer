package executiontui

import (
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
	}

	// Forward unhandled messages to the viewport for scroll handling.
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

// handleKeyPress processes keyboard input. When approval is active, keys
// are routed to the approval handler; otherwise, only quit keys are handled.
func (m Model) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Always allow quit.
	switch msg.String() {
	case "ctrl+c", "q":
		return m, tea.Quit
	}

	// Route to approval handler when active.
	if m.approval != nil {
		return m.handleApprovalKey(msg)
	}

	// Forward to viewport for default scroll handling.
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
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
	m.viewport.SetContent(rebuildViewportContent(m.blocks))
	if m.autoScroll {
		m.viewport.GotoBottom()
	}

	return m, nil
}

// handleExecutionEvent dispatches a single execution event to the appropriate
// handler based on its concrete type.
func (m Model) handleExecutionEvent(event Event) (tea.Model, tea.Cmd) {
	switch e := event.(type) {
	case HumanMessageEvent:
		m.blocks = append(m.blocks, newHumanBlock(renderHumanContent(e.Content)))

	case AIMessageEvent:
		m.blocks = append(m.blocks, newAIBlock(renderAIContent(e.Content, e.ToolCalls)))

	case AIStreamStartEvent:
		m.streaming = &streamingState{content: e.Content}
		m.blocks = append(m.blocks, newAIBlock(renderStreamingAI(e.Content)))

	case AIStreamDeltaEvent:
		if m.streaming != nil {
			m.streaming.content = e.Content
			// Update the last block in-place with the new streaming content.
			if len(m.blocks) > 0 {
				m.blocks[len(m.blocks)-1].content = renderStreamingAI(e.Content)
			}
		}

	case AIStreamEndEvent:
		m.streaming = nil
		// Replace the streaming block with the finalized content.
		if len(m.blocks) > 0 {
			m.blocks[len(m.blocks)-1] = newAIBlock(renderAIContent(e.Content, e.ToolCalls))
		}

	case ToolResultEvent:
		m.blocks = append(m.blocks, newToolCallBlock(renderToolResultContent(e.Content, e.ToolCalls)))

	case SystemMessageEvent:
		m.blocks = append(m.blocks, newSystemBlock(renderSystemContent(e.Content)))

	case PhaseChangeEvent:
		m.phase = e.Phase
		rendered := renderPhaseChange(e.Phase, e.Previous)
		if rendered != "" {
			m.blocks = append(m.blocks, newPhaseBlock(rendered))
		}

	case ApprovalNeededEvent:
		m.approval = &approvalState{
			toolCallID:  e.ToolCallID,
			toolName:    e.ToolName,
			argsPreview: e.ArgsPreview,
			message:     e.Message,
		}
		m.blocks = append(m.blocks, newApprovalBlock(
			renderApprovalPrompt(e.ToolName, e.ArgsPreview, e.Message),
		))

	case DoneEvent:
		m.done = true
		m.phase = e.Phase
		if e.Error != "" {
			m.exitError = e.Error
		}
		// Render final phase change if displayable.
		rendered := renderPhaseChange(e.Phase, m.phase)
		if rendered != "" {
			m.blocks = append(m.blocks, newPhaseBlock(rendered))
		}

	case StreamErrorEvent:
		m.done = true
		m.exitError = e.Err.Error()
		m.blocks = append(m.blocks, newSystemBlock(
			renderSystemContent("Stream error: "+e.Err.Error()),
		))
	}

	// Update viewport content and scroll position.
	m.refreshViewport()

	// Continue listening for events unless the stream is done.
	if m.done {
		return m, tea.Quit
	}
	return m, listenForEvents(m.cfg.Events)
}

// handleStreamClosed is called when the events channel is closed.
// If we haven't received a DoneEvent, treat this as an unexpected close.
func (m Model) handleStreamClosed() (tea.Model, tea.Cmd) {
	if !m.done {
		m.done = true
		m.exitError = "execution stream closed unexpectedly"
		m.blocks = append(m.blocks, newSystemBlock(
			renderSystemContent("Stream closed unexpectedly"),
		))
		m.refreshViewport()
	}
	return m, tea.Quit
}

// refreshViewport rebuilds the viewport content from blocks and applies
// auto-scroll if enabled.
func (m *Model) refreshViewport() {
	if !m.ready {
		return
	}
	m.viewport.SetContent(rebuildViewportContent(m.blocks))
	if m.autoScroll {
		m.viewport.GotoBottom()
	}
}
