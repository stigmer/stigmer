package executiontui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// handleExecutionEvent dispatches a single execution event to the appropriate
// handler based on its concrete type.
func (m Model) handleExecutionEvent(event Event) (tea.Model, tea.Cmd) {
	// Reset the activity tracker — a meaningful event arrived, so the
	// agent is active. Clear the thinking indicator if it was visible;
	// the header will re-render with the static phase icon on the next
	// View() call.
	m.lastEventAt = time.Now()
	m.thinkingVisible = false

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

	case ToolRunningEvent:
		m.updateToolBadge(e.ToolCallID, e.ToolCall, "running")

	case ToolWaitingApprovalEvent:
		m.updateToolBadge(e.ToolCallID, e.ToolCall, "waiting_approval")

	case ToolCompletedEvent:
		m.updateToolBadge(e.ToolCallID, e.ToolCall, e.ToolCall.Status)
		delete(m.runningTools, e.ToolCallID)

	case ToolStreamDeltaEvent:
		if idx, ok := m.runningTools[e.ToolCallID]; ok && idx < len(m.blocks) {
			// Update the running tool block in-place with the streaming content.
			m.blocks[idx].content = renderStreamingTool(e.ToolCall, e.Content)
		}

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
		// The tool block already exists from ToolWaitingApprovalEvent (or
		// ToolRunningEvent). We just ensure it is in "waiting_approval" state
		// and auto-expand it so the user can review content before deciding.
		// No separate approval block is created — the footer shows [a]/[s]/[r].
		if idx, ok := m.runningTools[e.ToolCallID]; ok && idx < len(m.blocks) {
			if tc := m.blocks[idx].toolCall; tc != nil {
				m.updateToolBadge(e.ToolCallID, *tc, "waiting_approval")
				m.blocks[m.runningTools[e.ToolCallID]].expanded = true
			}
		}

	case DoneEvent:
		m.done = true
		previousPhase := m.phase
		m.phase = e.Phase

		// Finalize any tools still tracked as running. When execution
		// completes (or fails/cancels), these tools will never receive a
		// ToolCompletedEvent. When the stored ToolCallInfo is available,
		// we create a proper expandable block; otherwise we fall back to
		// replacing the running indicator (⏳) with a completion mark (✓).
		m.finalizeRunningTools()

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

		// Finalize running tools (same rationale as DoneEvent above).
		m.finalizeRunningTools()

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

		// Finalize running tools (same rationale as DoneEvent above).
		m.finalizeRunningTools()

		m.blocks = append(m.blocks, newErrorBlock(
			renderErrorContent("Stream closed unexpectedly"),
		))
		m.refreshViewport()
	}
	// Stay open — user presses q to exit.
	return m, nil
}

// updateToolBadge updates a tool call block in-place with a new lifecycle state.
// If a block already exists for this toolCallID (tracked in runningTools), it is
// replaced in-place — preserving the block's position and expand/collapse state.
// If no block exists, a new one is appended.
//
// When the state is "waiting_approval", the block is auto-expanded so the user
// can review its content before deciding. This is the only "smart" behavior;
// all other transitions just swap the badge.
func (m *Model) updateToolBadge(toolCallID string, tc toolrender.ToolCallInfo, state string) {
	if idx, ok := m.runningTools[toolCallID]; ok && idx < len(m.blocks) {
		wasExpanded := m.blocks[idx].expanded
		m.blocks[idx] = newStatefulToolBlock(tc, toolCallID, state)
		m.blocks[idx].expanded = wasExpanded
		if state == "waiting_approval" {
			m.blocks[idx].expanded = true
		}
	} else {
		block := newStatefulToolBlock(tc, toolCallID, state)
		m.blocks = append(m.blocks, block)
		m.runningTools[toolCallID] = len(m.blocks) - 1
	}
}

// finalizeRunningTools converts all tracked running tool blocks into their
// final display state. When a stored ToolCallInfo is available, the block is
// promoted to a completed stateful block. When no info is stored, the running
// indicator is replaced with a static completion mark as a fallback.
func (m *Model) finalizeRunningTools() {
	for toolCallID, idx := range m.runningTools {
		if idx >= len(m.blocks) {
			continue
		}
		b := m.blocks[idx]
		if b.toolCall != nil {
			tc := *b.toolCall
			tc.Status = "completed"
			wasExpanded := b.expanded
			m.blocks[idx] = newStatefulToolBlock(tc, toolCallID, "completed")
			m.blocks[idx].expanded = wasExpanded
		} else {
			m.blocks[idx].content = renderToolFinalized(m.blocks[idx].content)
		}
	}
	m.runningTools = make(map[string]int)
}

// refreshViewport rebuilds the viewport content from blocks and applies
// auto-scroll if enabled.
//
// When the thinking indicator is active (agent idle during in_progress),
// an ephemeral animated indicator is appended after the last content block.
// This is purely a rendering concern — no block state is modified.
func (m *Model) refreshViewport() {
	if !m.ready {
		return
	}
	content := rebuildViewportContent(m.blocks, m.focusedBlockIndex)
	if m.thinkingVisible {
		indicator := renderThinkingIndicator(m.spinner.View())
		if content != "" {
			content += "\n\n" + indicator
		} else {
			content = indicator
		}
	}
	m.viewport.SetContent(content)
	if m.autoScroll {
		m.viewport.GotoBottom()
	}
}
