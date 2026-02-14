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
type contentBlock struct {
	blockType blockType

	// content is the pre-rendered display text for this block.
	// For tool call blocks, this is the output of toolrender.Render().
	content string

	// expandable indicates this block supports expand/collapse (T03).
	// Set to true for all tool call blocks; false for text blocks.
	expandable bool

	// expanded tracks the current expand/collapse state.
	// Always false in T02 — expand/collapse interaction is added in T03.
	expanded bool
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

// newToolCallBlock creates an expandable block for a tool call.
// The content is pre-rendered by the caller using toolrender.Render().
func newToolCallBlock(content string) contentBlock {
	return contentBlock{
		blockType:  blockToolResult,
		content:    content,
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
