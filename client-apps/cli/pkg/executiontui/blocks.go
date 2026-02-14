package executiontui

// blockType categorizes content blocks for rendering and interaction.
type blockType int

const (
	blockAI          blockType = iota // Agent message (text and/or tool calls)
	blockHuman                        // User's input message
	blockToolResult                   // Tool execution result
	blockSystem                       // System/informational message
	blockPhaseChange                  // Execution phase transition
	blockApproval                     // Approval request display
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
