package executiontui

import (
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// ReplayConfig holds the parameters for creating a replay TUI model.
type ReplayConfig struct {
	SessionID   string
	ExecutionID string
	Blocks      []contentBlock
}

// NewReplay creates a TUI model pre-populated with blocks from a completed
// execution. The model is read-only: no event channel, no approval, no cancel.
// The user can scroll, expand/collapse, and press q to exit.
func NewReplay(cfg ReplayConfig) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	return Model{
		cfg: Config{
			SessionID:   cfg.SessionID,
			ExecutionID: cfg.ExecutionID,
		},
		blocks:            cfg.Blocks,
		autoScroll:        false,
		phase:             "completed",
		focusedBlockIndex: -1,
		runningTools:      make(map[string]int),
		done:              true,
		spinner:           s,
		lastEventAt:       time.Now(),
	}
}

// ResumableConfig holds the parameters for creating a resumable TUI model.
// A resumable model is pre-populated with blocks from completed executions
// but allows the user to continue the conversation via FollowUpFn.
type ResumableConfig struct {
	SessionID   string
	ExecutionID string
	Blocks      []contentBlock
	FollowUpFn  FollowUpFn
	LastPhase   string
	Verbose     bool
}

// NewResumable creates a TUI model pre-populated with blocks from a
// completed session. Unlike NewReplay, the model starts with the input
// composer active — the user can type a follow-up message that creates a
// new execution in the session. This makes `stigmer run <session-id>`
// seamlessly resume any session, regardless of whether it's live or done.
func NewResumable(cfg ResumableConfig) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot

	ta := textarea.New()
	ta.Placeholder = "Type a message, or press Esc to exit"
	ta.ShowLineNumbers = false
	ta.SetHeight(1)
	ta.CharLimit = 4096
	ta.Focus()

	return Model{
		cfg: Config{
			SessionID:   cfg.SessionID,
			ExecutionID: cfg.ExecutionID,
			FollowUpFn:  cfg.FollowUpFn,
			Verbose:     cfg.Verbose,
		},
		blocks:            cfg.Blocks,
		autoScroll:        true,
		phase:             cfg.LastPhase,
		focusedBlockIndex: -1,
		runningTools:      make(map[string]int),
		spinner:           s,
		lastEventAt:       time.Now(),
		textarea:          ta,
		inputActive:       true,
		latestExecutionID: cfg.ExecutionID,
	}
}

// Init implements tea.Model for replay mode.
// No event listener or activity tick — just wait for window size.
func (m Model) replayInit() tea.Cmd {
	return nil
}

// BuildSessionReplayBlocks builds a unified block list from multiple
// executions in a session. Executions must be in chronological order
// (oldest first). The result is a seamless conversation transcript with
// no execution boundaries — consistent with the design decision to hide
// execution internals from the user.
func BuildSessionReplayBlocks(executions []*agentexecutionv1.AgentExecution) []contentBlock {
	var blocks []contentBlock
	for _, exec := range executions {
		blocks = append(blocks, BuildReplayBlocks(exec)...)
	}
	return blocks
}

// BuildReplayBlocks converts a completed execution's stored state into
// the same block types that the live TUI produces.
func BuildReplayBlocks(exec *agentexecutionv1.AgentExecution) []contentBlock {
	var blocks []contentBlock

	for _, msg := range exec.GetStatus().GetMessages() {
		switch msg.GetType() {
		case agentexecutionv1.MessageType_MESSAGE_HUMAN:
			if msg.GetContent() != "" {
				blocks = append(blocks, newHumanBlock(renderHumanContent(msg.GetContent())))
			}

		case agentexecutionv1.MessageType_MESSAGE_AI:
			tcInfos := replayConvertToolCalls(msg.GetToolCalls())
			rendered := renderAIContent(msg.GetContent(), tcInfos)
			if rendered != "" {
				blocks = append(blocks, newAIBlock(rendered))
			}

		case agentexecutionv1.MessageType_MESSAGE_TOOL:
			tcInfos := replayConvertToolCalls(msg.GetToolCalls())
			if len(tcInfos) > 0 {
				preview := renderToolResultPreview(msg.GetContent(), tcInfos)
				full := renderToolResultExpanded(msg.GetContent(), tcInfos)
				blocks = append(blocks, newToolCallBlock(preview, full))
			} else if msg.GetContent() != "" {
				preview := renderToolResultPreview(msg.GetContent(), nil)
				full := renderToolResultExpanded(msg.GetContent(), nil)
				blocks = append(blocks, newToolCallBlock(preview, full))
			}

		case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
			if msg.GetContent() != "" {
				blocks = append(blocks, newSystemBlock(renderSystemContent(msg.GetContent())))
			}
		}
	}

	// Also build blocks from the top-level tool calls that have results
	// but weren't captured in messages (tool call state tracking).
	toolCallBlocks := buildToolCallBlocks(exec.GetStatus().GetToolCalls())
	if len(toolCallBlocks) > 0 && len(blocks) == 0 {
		blocks = toolCallBlocks
	}

	return blocks
}

// buildToolCallBlocks converts top-level tool calls into expandable blocks.
func buildToolCallBlocks(toolCalls []*agentexecutionv1.ToolCall) []contentBlock {
	var blocks []contentBlock
	for _, tc := range toolCalls {
		info := replayConvertToolCall(tc)
		state := replayMapToolCallStatus(tc.GetStatus())
		block := newStatefulToolBlock(info, tc.GetId(), state)
		blocks = append(blocks, block)
	}
	return blocks
}

// replayConvertToolCalls converts proto tool calls to toolrender.ToolCallInfo.
func replayConvertToolCalls(toolCalls []*agentexecutionv1.ToolCall) []toolrender.ToolCallInfo {
	if len(toolCalls) == 0 {
		return nil
	}
	result := make([]toolrender.ToolCallInfo, len(toolCalls))
	for i, tc := range toolCalls {
		result[i] = replayConvertToolCall(tc)
	}
	return result
}

func replayConvertToolCall(tc *agentexecutionv1.ToolCall) toolrender.ToolCallInfo {
	info := toolrender.ToolCallInfo{
		ID:     tc.GetId(),
		Name:   tc.GetName(),
		Status: replayMapToolCallStatus(tc.GetStatus()),
		Result: tc.GetResult(),
		Error:  tc.GetError(),
	}
	if tc.GetArgs() != nil {
		info.Args = tc.GetArgs().AsMap()
	}
	info.Duration = replayComputeDuration(tc.GetStartedAt(), tc.GetCompletedAt())
	return info
}

func replayMapToolCallStatus(status agentexecutionv1.ToolCallStatus) string {
	switch status {
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_PENDING:
		return "pending"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING:
		return "running"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED:
		return "completed"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED:
		return "failed"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL:
		return "waiting_approval"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_SKIPPED:
		return "skipped"
	default:
		return "unknown"
	}
}

func replayComputeDuration(startedAt, completedAt string) time.Duration {
	if startedAt == "" || completedAt == "" {
		return 0
	}
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return 0
	}
	end, err := time.Parse(time.RFC3339, completedAt)
	if err != nil {
		return 0
	}
	d := end.Sub(start)
	if d < 0 {
		return 0
	}
	return d
}

// isReplayMode returns true if the model was created via NewReplay.
// In replay mode there are no events to listen for — the model starts done.
func (m Model) isReplayMode() bool {
	return m.cfg.Events == nil && m.done
}

// replayViewportInit initializes the viewport for replay mode with
// pre-populated content. Called from handleWindowSize when ready becomes true.
func (m *Model) replayViewportInit(width, height int) viewport.Model {
	vp := newViewport(width, height-headerHeight-footerHeight)
	content := rebuildViewportContent(m.blocks, m.focusedBlockIndex)
	vp.SetContent(content)
	// Start at top for replay — user scrolls down to read.
	vp.GotoTop()

	// If content fits in viewport, use a blank line separator style.
	if strings.Count(content, "\n") <= height-headerHeight-footerHeight {
		vp.GotoTop()
	}

	return vp
}
