package executiontui

import "strings"

// scrollFocusedBlockIntoView adjusts the viewport scroll position so that the
// currently focused block is visible. If no block is focused, the focused index
// is out of range, or the block is already fully visible, no adjustment is made.
//
// When the focused block is above the viewport, the viewport scrolls up so the
// block's first line is at the top. When it is below, the viewport scrolls down
// so the block's last line is at the bottom.
//
// Hidden blocks (children of collapsed sub-agent sections) are never focused
// because focus navigation skips them, so this function never needs to scroll
// to a hidden block.
func (m *Model) scrollFocusedBlockIntoView() {
	if m.focusedBlockIndex < 0 || m.focusedBlockIndex >= len(m.blocks) {
		return
	}

	startLine := blockStartLine(m.blocks, m.focusedBlockIndex, m.focusedBlockIndex)
	blockLines := blockLineCount(m.blocks, m.focusedBlockIndex, m.focusedBlockIndex)

	viewTop := m.viewport.YOffset
	viewBottom := viewTop + m.viewport.Height

	if startLine < viewTop {
		m.viewport.SetYOffset(startLine)
		return
	}

	blockEnd := startLine + blockLines
	if blockEnd > viewBottom {
		m.viewport.SetYOffset(blockEnd - m.viewport.Height)
	}
}

// blockStartLine computes the starting line number of a block in the rendered
// viewport content. Line numbers are 0-based. Blocks are separated by blank
// lines (\n\n produces one separator line between consecutive blocks).
//
// Hidden blocks contribute zero height because renderedBlockText returns ""
// for them, which the empty-text skip handles naturally. This mirrors the
// layout logic of rebuildViewportContent.
//
// targetIdx must be a valid index into blocks. If targetIdx is 0 or the first
// non-empty visible block, the start line is 0.
func blockStartLine(blocks []contentBlock, focusedIdx, targetIdx int) int {
	line := 0
	for i, b := range blocks {
		if i == targetIdx {
			return line
		}

		text := renderedBlockText(b, i, focusedIdx)
		if text == "" {
			continue
		}

		if needsSubAgentSeparator(blocks, i) {
			sep := renderSubAgentSeparator(b.subAgentName)
			line += strings.Count(sep, "\n") + 1
			line++
		}

		line += strings.Count(text, "\n") + 1
		line++
	}
	return line
}

// blockLineCount returns the number of rendered lines for a single block,
// including its decorations. Returns 0 if the block renders as empty or is
// hidden. Context separators are between blocks, not within, so they are
// not counted.
func blockLineCount(blocks []contentBlock, blockIdx, focusedIdx int) int {
	text := renderedBlockText(blocks[blockIdx], blockIdx, focusedIdx)
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n") + 1
}
