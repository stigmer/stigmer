package executiontui

// focusNextExpandable moves focus to the next visible expandable block after
// the current position. Hidden blocks (children of collapsed sub-agent
// sections) are skipped. If no block is currently focused
// (focusedBlockIndex == -1), it starts searching from the beginning. Wraps
// around to the start if the end of the block list is reached.
//
// If there are no visible expandable blocks, focus remains unchanged.
func (m *Model) focusNextExpandable() {
	count := len(m.blocks)
	if count == 0 {
		return
	}

	start := m.focusedBlockIndex + 1
	for i := 0; i < count; i++ {
		idx := (start + i) % count
		if m.blocks[idx].expandable && !m.blocks[idx].hidden {
			m.focusedBlockIndex = idx
			return
		}
	}
}

// focusPrevExpandable moves focus to the previous visible expandable block
// before the current position. Hidden blocks are skipped. If no block is
// currently focused (focusedBlockIndex == -1), it starts searching from the
// last block. Wraps around to the end if the start is reached.
//
// If there are no visible expandable blocks, focus remains unchanged.
func (m *Model) focusPrevExpandable() {
	count := len(m.blocks)
	if count == 0 {
		return
	}

	start := m.focusedBlockIndex - 1
	if start < 0 {
		start = count - 1
	}
	for i := 0; i < count; i++ {
		idx := (start - i + count) % count
		if m.blocks[idx].expandable && !m.blocks[idx].hidden {
			m.focusedBlockIndex = idx
			return
		}
	}
}

// toggleFocusedBlock flips the expanded state of the currently focused block.
// Does nothing if no block is focused or the focused block is not expandable.
//
// When the toggled block is a blockSubAgent header, all child blocks with
// matching subAgentID have their hidden state toggled accordingly: collapsing
// the header hides children, expanding it reveals them.
func (m *Model) toggleFocusedBlock() {
	if m.focusedBlockIndex < 0 || m.focusedBlockIndex >= len(m.blocks) {
		return
	}
	b := &m.blocks[m.focusedBlockIndex]
	if !b.expandable {
		return
	}
	b.expanded = !b.expanded

	if b.blockType == blockSubAgent && b.subAgentID != "" {
		m.toggleSubAgentChildren(b.subAgentID, b.expanded)
	}
}

// toggleSubAgentChildren sets the hidden state on all blocks that belong to
// the given sub-agent (excluding the header block itself). When visible is
// true, children are shown; when false, they are hidden.
func (m *Model) toggleSubAgentChildren(subAgentID string, visible bool) {
	for i := range m.blocks {
		if m.blocks[i].subAgentID == subAgentID && m.blocks[i].blockType != blockSubAgent {
			m.blocks[i].hidden = !visible
		}
	}
}

// hasExpandableBlocks returns true if at least one visible block supports
// expand/collapse. Used by the footer to decide whether to show focus/toggle
// key hints.
func (m Model) hasExpandableBlocks() bool {
	for _, b := range m.blocks {
		if b.expandable && !b.hidden {
			return true
		}
	}
	return false
}
