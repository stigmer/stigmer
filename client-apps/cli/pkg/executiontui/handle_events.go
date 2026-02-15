package executiontui

import tea "github.com/charmbracelet/bubbletea"

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
		preview := renderToolResultPreview(e.Content, e.ToolCalls)
		full := renderToolResultExpanded(e.Content, e.ToolCalls)
		m.blocks = append(m.blocks, newToolCallBlock(preview, full))

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
		previousPhase := m.phase
		m.phase = e.Phase
		if e.Error != "" {
			m.exitError = e.Error
			m.blocks = append(m.blocks, newErrorBlock(
				renderErrorContent(e.Error),
			))
		}
		// Render final phase change if displayable.
		rendered := renderPhaseChange(e.Phase, previousPhase)
		if rendered != "" {
			m.blocks = append(m.blocks, newPhaseBlock(rendered))
		}

	case StreamErrorEvent:
		m.done = true
		m.exitError = e.Err.Error()
		m.blocks = append(m.blocks, newErrorBlock(
			renderErrorContent("Stream error: "+e.Err.Error()),
		))
	}

	// Update viewport content and scroll position.
	m.refreshViewport()

	// When done, stay open so the user can browse content at leisure.
	// The footer shows "q to exit". No more events to listen for.
	if m.done {
		return m, nil
	}
	return m, listenForEvents(m.cfg.Events)
}

// handleStreamClosed is called when the events channel is closed.
// If we haven't received a DoneEvent, treat this as an unexpected close.
func (m Model) handleStreamClosed() (tea.Model, tea.Cmd) {
	if !m.done {
		m.done = true
		m.exitError = "execution stream closed unexpectedly"
		m.blocks = append(m.blocks, newErrorBlock(
			renderErrorContent("Stream closed unexpectedly"),
		))
		m.refreshViewport()
	}
	// Stay open — user presses q to exit.
	return m, nil
}

// refreshViewport rebuilds the viewport content from blocks and applies
// auto-scroll if enabled.
func (m *Model) refreshViewport() {
	if !m.ready {
		return
	}
	m.viewport.SetContent(rebuildViewportContent(m.blocks, m.focusedBlockIndex))
	if m.autoScroll {
		m.viewport.GotoBottom()
	}
}
