package executiontui

// focusNextExpandable moves focus to the next expandable block after the
// current position. If no block is currently focused (focusedBlockIndex == -1),
// it starts searching from the beginning. Wraps around to the start if the
// end of the block list is reached.
//
// If there are no expandable blocks, focus remains unchanged.
func (m *Model) focusNextExpandable() {
	count := len(m.blocks)
	if count == 0 {
		return
	}

	// Start searching from the position after the current focus.
	start := m.focusedBlockIndex + 1
	for i := 0; i < count; i++ {
		idx := (start + i) % count
		if m.blocks[idx].expandable {
			m.focusedBlockIndex = idx
			return
		}
	}
}

// focusPrevExpandable moves focus to the previous expandable block before the
// current position. If no block is currently focused (focusedBlockIndex == -1),
// it starts searching from the last block. Wraps around to the end if the
// start of the block list is reached.
//
// If there are no expandable blocks, focus remains unchanged.
func (m *Model) focusPrevExpandable() {
	count := len(m.blocks)
	if count == 0 {
		return
	}

	// Start searching from the position before the current focus.
	// When unfocused (-1), start from the last block.
	start := m.focusedBlockIndex - 1
	if start < 0 {
		start = count - 1
	}
	for i := 0; i < count; i++ {
		idx := (start - i + count) % count
		if m.blocks[idx].expandable {
			m.focusedBlockIndex = idx
			return
		}
	}
}

// toggleFocusedBlock flips the expanded state of the currently focused block.
// Does nothing if no block is focused or the focused block is not expandable.
func (m *Model) toggleFocusedBlock() {
	if m.focusedBlockIndex < 0 || m.focusedBlockIndex >= len(m.blocks) {
		return
	}
	b := &m.blocks[m.focusedBlockIndex]
	if !b.expandable {
		return
	}
	b.expanded = !b.expanded
}

// hasExpandableBlocks returns true if at least one block supports expand/collapse.
// Used by the footer to decide whether to show focus/toggle key hints.
func (m Model) hasExpandableBlocks() bool {
	for _, b := range m.blocks {
		if b.expandable {
			return true
		}
	}
	return false
}
