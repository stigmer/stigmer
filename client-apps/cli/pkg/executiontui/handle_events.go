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
		b := newAIBlock(renderAIContent(e.Content, e.ToolCalls, m.width))
		b.subAgentID = e.SubAgentID
		m.blocks = append(m.blocks, b)

	case AIStreamStartEvent:
		m.blocks = append(m.blocks, newAIBlock(renderStreamingAI(e.Content)))
		m.streaming = &streamingState{
			content:  e.Content,
			blockIdx: len(m.blocks) - 1,
		}

	case AIStreamDeltaEvent:
		if m.streaming != nil {
			m.streaming.content = e.Content
			// Update the streaming block in-place with the new content.
			// Uses the tracked blockIdx rather than len(m.blocks)-1 because
			// tool call state events can append blocks after the streaming
			// block was created, making the "last block" a tool block.
			if m.streaming.blockIdx < len(m.blocks) {
				m.blocks[m.streaming.blockIdx].content = renderStreamingAI(e.Content)
			}
		}

	case AIStreamEndEvent:
		// Replace the streaming block with the finalized content.
		// Uses the tracked blockIdx for the same reason as AIStreamDeltaEvent:
		// tool blocks may have been appended after the streaming block.
		if m.streaming != nil && m.streaming.blockIdx < len(m.blocks) {
			m.blocks[m.streaming.blockIdx] = newAIBlock(renderAIContent(e.Content, e.ToolCalls, m.width))
		}
		m.streaming = nil

	case ToolResultEvent:
		preview := renderToolResultPreview(e.Content, e.ToolCalls)
		full := renderToolResultExpanded(e.Content, e.ToolCalls)
		m.blocks = append(m.blocks, newToolCallBlock(preview, full))

	case ToolRunningEvent:
		m.updateToolBadge(e.ToolCallID, e.ToolCall, "running", e.SubAgentID)

	case ToolWaitingApprovalEvent:
		m.updateToolBadge(e.ToolCallID, e.ToolCall, "waiting_approval", e.SubAgentID)

	case ToolCompletedEvent:
		m.updateToolBadge(e.ToolCallID, e.ToolCall, e.ToolCall.Status, e.SubAgentID)
		delete(m.runningTools, e.ToolCallID)

	case ToolStreamDeltaEvent:
		if idx, ok := m.runningTools[e.ToolCallID]; ok && idx < len(m.blocks) {
			// Update the running tool block in-place with the streaming content.
			// Force non-expandable so displayContent() uses the content field
			// directly. Expandable blocks ignore content and return preview/full
			// instead, which would hide in-flight streaming updates. The block
			// reverts to expandable when the tool transitions to a terminal
			// state via ToolCompletedEvent → updateToolBadge.
			m.blocks[idx].content = renderStreamingTool(e.ToolCall, e.Content)
			m.blocks[idx].expandable = false
			m.blocks[idx].subAgentID = e.SubAgentID
		}

	case SystemMessageEvent:
		m.blocks = append(m.blocks, newSystemBlock(renderSystemContent(e.Content)))

	case PhaseChangeEvent:
		m.phase = e.Phase
		if m.cfg.Verbose {
			m.blocks = append(m.blocks, newSystemBlock(
				renderSystemContent("Phase: "+e.Previous+" → "+e.Phase),
			))
		}

	case ApprovalNeededEvent:
		m.approval = &approvalState{
			toolCallID:  e.ToolCallID,
			toolName:    e.ToolName,
			argsPreview: e.ArgsPreview,
			message:     e.Message,
		}
		// The tool block already exists from ToolWaitingApprovalEvent (or
		// ToolRunningEvent). Ensure it is in "waiting_approval" state so the
		// badge shows ⏸. The block stays collapsed — the header line shows
		// the tool type, file path, size, and line count, which is enough
		// context for the user to decide. They can Tab + Enter to expand
		// manually if needed. The footer shows [a]/[s]/[r].
		if idx, ok := m.runningTools[e.ToolCallID]; ok && idx < len(m.blocks) {
			if tc := m.blocks[idx].toolCall; tc != nil {
				m.updateToolBadge(e.ToolCallID, *tc, "waiting_approval", m.blocks[idx].subAgentID)
			}
		}

	case DoneEvent:
		m.phase = e.Phase
		m.finalizeRunningTools()

		if e.Error != "" {
			m.exitError = e.Error
			m.blocks = append(m.blocks, newErrorBlock(
				renderErrorContent(e.Error),
			))
		}

		// When conversational mode is enabled, activate the input composer
		// so the user can send a follow-up. This applies to all terminal
		// phases (completed, failed, cancelled) — the user can recover from
		// failures by sending corrective instructions.
		//
		// When FollowUpFn is nil, fall back to pre-Phase 2 behavior: mark
		// done so the footer shows "q exit" and the TUI prepares to exit.
		if m.cfg.FollowUpFn != nil {
			m.inputActive = true
			m.textarea.Focus()
		} else {
			m.done = true
		}

	case StreamErrorEvent:
		m.exitError = e.Err.Error()
		m.finalizeRunningTools()

		m.blocks = append(m.blocks, newErrorBlock(
			renderErrorContent("Stream error: "+e.Err.Error()),
		))

		// In conversational mode, treat stream errors like any other terminal
		// event: activate input so the user can send a follow-up (which creates
		// a new execution in the session) or press Esc to exit. The backend may
		// still be healthy — only the stream broke.
		//
		// Without FollowUpFn, fall back to pre-Phase 2 terminal behavior.
		if m.cfg.FollowUpFn != nil {
			m.inputActive = true
			m.textarea.Focus()
		} else {
			m.done = true
		}

	case TodoUpdateEvent:
		preview := renderTodoPreview(e.Todos)
		full := renderTodoExpanded(e.Todos)
		if m.todoBlockIdx >= 0 && m.todoBlockIdx < len(m.blocks) {
			wasExpanded := m.blocks[m.todoBlockIdx].expanded
			m.blocks[m.todoBlockIdx] = newTodoBlock(preview, full)
			m.blocks[m.todoBlockIdx].expanded = wasExpanded
		} else {
			m.blocks = append(m.blocks, newTodoBlock(preview, full))
			m.todoBlockIdx = len(m.blocks) - 1
		}
	}

	// Update viewport content and scroll position.
	m.refreshViewport()

	// When done or waiting for user input, stay open without listening
	// for events. The footer shows exit/input hints.
	if m.done || m.inputActive {
		return m, nil
	}
	return m, listenForEvents(m.activeEvents)
}

// handleStreamClosed is called when the events channel is closed.
// If we haven't received a DoneEvent, treat this as an unexpected close.
//
// When inputActive is true, the stream closure is expected — the execution
// completed normally (via DoneEvent) and the user is composing a follow-up.
// A follow-up creation in progress also means the old channel closure is
// expected.
func (m Model) handleStreamClosed() (tea.Model, tea.Cmd) {
	if !m.done && !m.inputActive {
		m.exitError = "execution stream closed unexpectedly"
		m.finalizeRunningTools()

		m.blocks = append(m.blocks, newErrorBlock(
			renderErrorContent("Stream closed unexpectedly"),
		))

		// Same pattern as StreamErrorEvent: activate input in conversational
		// mode so the user can recover with a follow-up message.
		if m.cfg.FollowUpFn != nil {
			m.inputActive = true
			m.textarea.Focus()
		} else {
			m.done = true
		}

		m.refreshViewport()
	}
	return m, nil
}

// updateToolBadge updates a tool call block in-place with a new lifecycle state.
// If a block already exists for this toolCallID (tracked in runningTools), it is
// replaced in-place — preserving the block's position and expand/collapse state.
// If no block exists, a new one is appended.
//
// All transitions simply swap the badge; the expand/collapse state is always
// preserved from before the update. The subAgentID is propagated to the block
// so sub-agent tool calls render with the visual indent.
func (m *Model) updateToolBadge(toolCallID string, tc toolrender.ToolCallInfo, state, subAgentID string) {
	if idx, ok := m.runningTools[toolCallID]; ok && idx < len(m.blocks) {
		wasExpanded := m.blocks[idx].expanded
		m.blocks[idx] = newStatefulToolBlock(tc, toolCallID, state)
		m.blocks[idx].expanded = wasExpanded
		m.blocks[idx].subAgentID = subAgentID
	} else {
		block := newStatefulToolBlock(tc, toolCallID, state)
		block.subAgentID = subAgentID
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
			savedSubAgentID := b.subAgentID
			m.blocks[idx] = newStatefulToolBlock(tc, toolCallID, "completed")
			m.blocks[idx].expanded = wasExpanded
			m.blocks[idx].subAgentID = savedSubAgentID
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
