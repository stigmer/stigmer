package executiontui

import "strings"

// scrollFocusedBlockIntoView adjusts the viewport scroll position so that the
// currently focused block is visible. If no block is focused, the focused index
// is out of range, or the block is already fully visible, no adjustment is made.
//
// When the focused block is above the viewport, the viewport scrolls up so the
// block's first line is at the top. When it is below, the viewport scrolls down
// so the block's last line is at the bottom.
func (m *Model) scrollFocusedBlockIntoView() {
	if m.focusedBlockIndex < 0 || m.focusedBlockIndex >= len(m.blocks) {
		return
	}

	startLine := blockStartLine(m.blocks, m.focusedBlockIndex, m.focusedBlockIndex)
	blockLines := blockLineCount(m.blocks, m.focusedBlockIndex, m.focusedBlockIndex)

	viewTop := m.viewport.YOffset
	viewBottom := viewTop + m.viewport.Height

	// Block starts above the visible area — scroll up to show it.
	if startLine < viewTop {
		m.viewport.SetYOffset(startLine)
		return
	}

	// Block ends below the visible area — scroll down so it fits.
	blockEnd := startLine + blockLines
	if blockEnd > viewBottom {
		m.viewport.SetYOffset(blockEnd - m.viewport.Height)
	}
}

// blockStartLine computes the starting line number of a block in the rendered
// viewport content. Line numbers are 0-based. Blocks are separated by blank
// lines (\n\n produces one separator line between consecutive blocks).
//
// This function uses renderedBlockText to determine each block's rendered text,
// ensuring consistency with rebuildViewportContent which uses the same helper.
//
// targetIdx must be a valid index into blocks. If targetIdx is 0 or the first
// non-empty block, the start line is 0.
func blockStartLine(blocks []contentBlock, focusedIdx, targetIdx int) int {
	nest := hasMultipleSubAgents(blocks)
	line := 0
	for i, b := range blocks {
		if i == targetIdx {
			return line
		}

		text := renderedBlockText(b, i, focusedIdx, nest)
		if text == "" {
			continue
		}

		// Lines in this block + 1 separator blank line before the next block.
		line += strings.Count(text, "\n") + 1 // lines in the block itself
		line++                                // blank separator line (\n\n)
	}
	return line
}

// blockLineCount returns the number of rendered lines for a single block,
// including its decorations. Returns 0 if the block renders as empty.
func blockLineCount(blocks []contentBlock, blockIdx, focusedIdx int) int {
	nest := hasMultipleSubAgents(blocks)
	text := renderedBlockText(blocks[blockIdx], blockIdx, focusedIdx, nest)
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n") + 1
}
