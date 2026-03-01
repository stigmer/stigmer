package executiontui

import "github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"

// blockType categorizes content blocks for rendering and interaction.
type blockType int

const (
	blockAI          blockType = iota // Agent message (text and/or tool calls)
	blockHuman                        // User's input message
	blockToolResult                   // Tool execution result
	blockSystem                       // System/informational message
	blockPhaseChange                  // Execution phase transition
	blockApproval                     // Approval request display
	blockError                        // Error message (stream failure, execution error)
	blockTodo                         // Agent todo/planning items
	blockSubAgent                     // Sub-agent delegation header
)

// contentBlock represents one renderable unit in the execution output.
// All execution output is broken into an ordered sequence of blocks that
// the viewport renders top-to-bottom.
//
// Non-expandable blocks use the content field for display. Expandable blocks
// (tool call results) store both a collapsed preview and expanded full view,
// and displayContent() returns the appropriate one based on the expanded state.
type contentBlock struct {
	blockType blockType

	// content is the pre-rendered display text for non-expandable blocks.
	// For expandable blocks this field is unused — use displayContent() instead.
	content string

	// expandable indicates this block supports expand/collapse.
	// Set to true for all tool call blocks; false for text blocks.
	expandable bool

	// expanded tracks the current expand/collapse state.
	// Toggled by user interaction (Enter key on focused block).
	expanded bool

	// preview is the collapsed rendering for expandable blocks. This is the
	// current Render() output: header line with a truncated result preview.
	preview string

	// full is the expanded rendering for expandable blocks. This is the
	// RenderExpanded() output: header line with the complete result content.
	full string

	// toolCall is stored on running tool blocks so that DoneEvent
	// finalization can create a proper expandable block. Nil for
	// non-tool blocks and for already-expanded tool result blocks.
	toolCall *toolrender.ToolCallInfo

	// toolCallID tracks which tool call owns this block. Used to look up the
	// block from runningTools when state transitions arrive (approval events,
	// completion, etc.). Empty for non-tool blocks.
	toolCallID string

	// toolState tracks the current lifecycle state of a stateful tool block:
	// "running", "waiting_approval", "completed", "failed", "skipped".
	// Used to render the correct status badge. Empty for non-tool blocks.
	toolState string

	// subAgentID is set when this block originates from a sub-agent execution.
	// Used by the renderer to associate content blocks with their sub-agent
	// header block (blockSubAgent). When a header exists for this ID, no
	// separator is rendered; a fallback separator appears only for orphaned
	// blocks whose header was lost.
	subAgentID string

	// subAgentName is the human-readable name for the sub-agent (e.g.,
	// "generalPurpose", "explore"). Populated from the Model's subAgentMeta
	// map when the block is created. Used by the fallback separator label
	// when the header block is missing.
	subAgentName string
}

// displayContent returns the text that should be shown for this block.
// Non-expandable blocks return their content. Expandable blocks return
// either the collapsed preview or the expanded full view.
func (b contentBlock) displayContent() string {
	if !b.expandable {
		return b.content
	}
	if b.expanded {
		return b.full
	}
	return b.preview
}

// newAIBlock creates a block for an AI message with text content.
func newAIBlock(content string) contentBlock {
	return contentBlock{
		blockType: blockAI,
		content:   content,
	}
}

// newHumanBlock creates a block for a user message.
func newHumanBlock(content string) contentBlock {
	return contentBlock{
		blockType: blockHuman,
		content:   content,
	}
}

// newToolCallBlock creates an expandable block for a tool call result.
// preview is the collapsed rendering (toolrender.Render output) and full is
// the expanded rendering (toolrender.RenderExpanded output). The block starts
// collapsed by default.
func newToolCallBlock(preview, full string) contentBlock {
	return contentBlock{
		blockType:  blockToolResult,
		preview:    preview,
		full:       full,
		expandable: true,
	}
}

// newRunningToolBlock creates a non-expandable block for a tool that is
// currently executing. The content is the running indicator header (e.g.,
// "📝 Write: file.md ⏳"). This block is updated in-place and eventually
// replaced with an expandable newToolCallBlock when the tool completes.
//
// The ToolCallInfo is stored so that DoneEvent finalization can create a
// proper expandable block if the tool never receives a ToolCompletedEvent.
func newRunningToolBlock(content string, tc *toolrender.ToolCallInfo) contentBlock {
	return contentBlock{
		blockType: blockToolResult,
		content:   content,
		toolCall:  tc,
	}
}

// newStatefulToolBlock creates a single expandable block for a tool call that
// persists across the tool's entire lifecycle. Only the status badge changes
// as the tool transitions through states (running → waiting_approval →
// completed). The block identity (icon, label, path) and expandable content
// remain stable.
//
// When the tool has displayable content (Result for read tools, Args content
// for write tools), the block is immediately expandable. Otherwise it starts
// as a non-expandable header-only block and becomes expandable when content
// arrives via a later update.
func newStatefulToolBlock(tc toolrender.ToolCallInfo, toolCallID, state string) contentBlock {
	preview := toolrender.RenderWithBadge(tc, toolrender.StateBadge(state))
	full := toolrender.RenderExpandedWithBadge(tc, toolrender.StateBadge(state))
	hasContent := toolrender.HasDisplayableContent(tc)
	return contentBlock{
		blockType:  blockToolResult,
		expandable: hasContent,
		preview:    preview,
		full:       full,
		toolCall:   &tc,
		toolCallID: toolCallID,
		toolState:  state,
	}
}

// newSystemBlock creates a block for a system message.
func newSystemBlock(content string) contentBlock {
	return contentBlock{
		blockType: blockSystem,
		content:   content,
	}
}

// newPhaseBlock creates a block for a phase change notification.
func newPhaseBlock(content string) contentBlock {
	return contentBlock{
		blockType: blockPhaseChange,
		content:   content,
	}
}

// newApprovalBlock creates a block for an approval request display.
func newApprovalBlock(content string) contentBlock {
	return contentBlock{
		blockType: blockApproval,
		content:   content,
	}
}

// newErrorBlock creates a block for an error message.
// Used for stream failures and execution errors, rendered with distinct red
// styling to differentiate from informational system blocks.
func newErrorBlock(content string) contentBlock {
	return contentBlock{
		blockType: blockError,
		content:   content,
	}
}

// newTodoBlock creates an expandable block for the agent's todo/planning items.
// preview is the collapsed summary (e.g., "📋 Tasks (2/5 done)") and full is the
// expanded rendering with all items listed. The block starts expanded so users
// can see task progress immediately during execution.
func newTodoBlock(preview, full string) contentBlock {
	return contentBlock{
		blockType:  blockTodo,
		expandable: true,
		expanded:   true,
		preview:    preview,
		full:       full,
	}
}

// newSubAgentBlock creates a header block for a sub-agent delegation.
// When input is available, the block is expandable: collapsed view shows
// the sub-agent type and a short task description; expanded view adds the
// full prompt in a gutter-bordered section.
//
// When input is empty (no task prompt available), the block is
// non-expandable and uses the content field directly so that
// displayContent() returns the header text.
func newSubAgentBlock(name, description, input string) contentBlock {
	header := renderSubAgentHeader(name, description, input)
	if input == "" {
		return contentBlock{
			blockType: blockSubAgent,
			content:   header,
		}
	}
	return contentBlock{
		blockType:  blockSubAgent,
		expandable: true,
		preview:    header,
		full:       renderSubAgentHeaderExpanded(name, description, input),
	}
}
