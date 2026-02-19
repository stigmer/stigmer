package executiontui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// =============================================================================
// Help Rendering Tests
// =============================================================================

func TestRenderHelp_ContainsAllSections(t *testing.T) {
	result := renderHelp(80, 30)

	sections := []string{"Navigation", "Tool Results", "Approval", "General"}
	for _, section := range sections {
		if !strings.Contains(result, section) {
			t.Errorf("help should contain section %q", section)
		}
	}
}

func TestRenderHelp_ContainsKeyBindings(t *testing.T) {
	result := renderHelp(80, 30)

	bindings := []string{
		"Tab", "Shift+Tab", "Enter",
		"Approve", "Skip", "Reject",
		"Detach",
	}
	for _, binding := range bindings {
		if !strings.Contains(result, binding) {
			t.Errorf("help should contain binding %q", binding)
		}
	}
}

func TestRenderHelp_ContainsDismissHint(t *testing.T) {
	result := renderHelp(80, 30)

	if !strings.Contains(result, "Esc") {
		t.Error("help should contain Esc dismiss hint")
	}
}

// =============================================================================
// Help Toggle Tests
// =============================================================================

func TestHelp_QuestionMark_TogglesHelp(t *testing.T) {
	m, _, _ := newTestModel()

	if m.showHelp {
		t.Fatal("help should start hidden")
	}

	// Press ? to show help.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	model := result.(Model)

	if !model.showHelp {
		t.Error("help should be visible after pressing ?")
	}

	// Press ? again to hide help.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	model = result.(Model)

	if model.showHelp {
		t.Error("help should be hidden after pressing ? again")
	}
}

func TestHelp_Esc_DismissesHelp(t *testing.T) {
	m, _, _ := newTestModel()

	// Show help first.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	model := result.(Model)

	if !model.showHelp {
		t.Fatal("help should be visible (precondition)")
	}

	// Press Esc to dismiss.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyEsc})
	model = result.(Model)

	if model.showHelp {
		t.Error("help should be hidden after pressing Esc")
	}
}

func TestHelp_BlocksOtherKeys(t *testing.T) {
	m := newTestModelWithBlocks()

	// Show help.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	model := result.(Model)

	// Tab should not change focus while help is shown.
	result, _ = model.Update(tea.KeyMsg{Type: tea.KeyTab})
	model = result.(Model)

	if model.focusedBlockIndex != -1 {
		t.Errorf("Tab should be blocked during help, but focus changed to %d", model.focusedBlockIndex)
	}
	if !model.showHelp {
		t.Error("help should still be visible after Tab")
	}
}

func TestHelp_QuitStillWorks(t *testing.T) {
	m, _, _ := newTestModel()

	// Show help.
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	model := result.(Model)

	// q should still quit even with help shown.
	_, cmd := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})

	if cmd == nil {
		t.Fatal("q should return quit command even during help")
	}
	msg := cmd()
	if _, ok := msg.(tea.QuitMsg); !ok {
		t.Errorf("expected tea.QuitMsg, got %T", msg)
	}
}

func TestHelp_NotAvailableDuringApproval(t *testing.T) {
	m, _, _ := newTestModel()
	m = enterApproval(t, m, "tc-help", "shell")

	// ? during approval should be routed to approval handler (ignored).
	result, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	model := result.(Model)

	if model.showHelp {
		t.Error("help should not activate during approval")
	}
}
