package approval

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// =============================================================================
// Initial State Tests
// =============================================================================

func TestPromptModel_InitialState(t *testing.T) {
	m := newPromptModel(true)

	if m.phase != phaseSelect {
		t.Errorf("expected phaseSelect, got %v", m.phase)
	}
	if m.cursor != 0 {
		t.Errorf("expected cursor at 0, got %d", m.cursor)
	}
	if m.decision != nil {
		t.Error("expected nil decision initially")
	}
	if m.sessionExit {
		t.Error("expected not sessionExit initially")
	}
	if len(m.choices) != 4 {
		t.Errorf("expected 4 choices, got %d", len(m.choices))
	}
	if !m.askComment {
		t.Error("expected askComment to be true when created with true")
	}
}

func TestPromptModel_Init_ReturnsNil(t *testing.T) {
	m := newPromptModel(true)
	cmd := m.Init()
	if cmd != nil {
		t.Error("Init() should return nil")
	}
}

// =============================================================================
// Navigation Tests
// =============================================================================

func TestPromptModel_NavigateDown(t *testing.T) {
	m := newPromptModel(true)

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	result := updated.(promptModel)

	if result.cursor != 1 {
		t.Errorf("expected cursor at 1 after down, got %d", result.cursor)
	}
}

func TestPromptModel_NavigateUp(t *testing.T) {
	m := newPromptModel(true)
	m.cursor = 2

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	result := updated.(promptModel)

	if result.cursor != 1 {
		t.Errorf("expected cursor at 1 after up from 2, got %d", result.cursor)
	}
}

func TestPromptModel_NavigateDown_VimKey(t *testing.T) {
	m := newPromptModel(true)

	updated, _ := m.Update(tea.KeyPressMsg{Code: 'j', Text: "j"})
	result := updated.(promptModel)

	if result.cursor != 1 {
		t.Errorf("expected cursor at 1 after 'j', got %d", result.cursor)
	}
}

func TestPromptModel_NavigateUp_VimKey(t *testing.T) {
	m := newPromptModel(true)
	m.cursor = 2

	updated, _ := m.Update(tea.KeyPressMsg{Code: 'k', Text: "k"})
	result := updated.(promptModel)

	if result.cursor != 1 {
		t.Errorf("expected cursor at 1 after 'k' from 2, got %d", result.cursor)
	}
}

func TestPromptModel_NavigateUp_AtTop_StaysAtTop(t *testing.T) {
	m := newPromptModel(true)

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	result := updated.(promptModel)

	if result.cursor != 0 {
		t.Errorf("expected cursor to stay at 0, got %d", result.cursor)
	}
}

func TestPromptModel_NavigateDown_AtBottom_StaysAtBottom(t *testing.T) {
	m := newPromptModel(true)
	m.cursor = 3 // last choice (Reject)

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	result := updated.(promptModel)

	if result.cursor != 3 {
		t.Errorf("expected cursor to stay at 3, got %d", result.cursor)
	}
}

func TestPromptModel_SelectApproveAll(t *testing.T) {
	m := newPromptModel(true)
	m.cursor = 1 // Approve & don't ask again

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	result := updated.(promptModel)

	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	if result.decision.Action != ActionApproveAll {
		t.Errorf("expected ActionApproveAll, got %v", result.decision.Action)
	}
	if result.phase != phaseSelect {
		t.Errorf("expected to remain in phaseSelect after ApproveAll, got %v", result.phase)
	}
}

// =============================================================================
// Selection Tests
// =============================================================================

func TestPromptModel_SelectApprove(t *testing.T) {
	m := newPromptModel(true)
	// cursor at 0 = Approve

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	result := updated.(promptModel)

	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	if result.decision.Action != ActionApprove {
		t.Errorf("expected ActionApprove, got %v", result.decision.Action)
	}
	if result.phase != phaseSelect {
		t.Errorf("expected to remain in phaseSelect after Approve, got %v", result.phase)
	}
}

func TestPromptModel_SelectSkip(t *testing.T) {
	m := newPromptModel(true)
	m.cursor = 2 // Skip

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	result := updated.(promptModel)

	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	if result.decision.Action != ActionSkip {
		t.Errorf("expected ActionSkip, got %v", result.decision.Action)
	}
}

func TestPromptModel_SelectReject_WithComment_TransitionsToComment(t *testing.T) {
	m := newPromptModel(true) // askComment = true
	m.cursor = 3              // Reject

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	result := updated.(promptModel)

	if result.phase != phaseComment {
		t.Errorf("expected phaseComment after Reject with askComment, got %v", result.phase)
	}
	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	if result.decision.Action != ActionReject {
		t.Errorf("expected ActionReject, got %v", result.decision.Action)
	}
}

func TestPromptModel_SelectReject_WithoutComment_QuitsImmediately(t *testing.T) {
	m := newPromptModel(false) // askComment = false
	m.cursor = 3               // Reject

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	result := updated.(promptModel)

	// Should stay in phaseSelect (quitting immediately, no transition)
	if result.phase != phaseSelect {
		t.Errorf("expected phaseSelect when askComment=false, got %v", result.phase)
	}
	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	if result.decision.Action != ActionReject {
		t.Errorf("expected ActionReject, got %v", result.decision.Action)
	}
}

// =============================================================================
// Session Exit Tests — both Esc and Ctrl+C exit the session
// =============================================================================

func TestPromptModel_Esc_InSelect_SetsSessionExit(t *testing.T) {
	m := newPromptModel(true)

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEsc})
	result := updated.(promptModel)

	if !result.sessionExit {
		t.Error("expected sessionExit to be true after esc")
	}
}

func TestPromptModel_CtrlC_InSelect_SetsSessionExit(t *testing.T) {
	m := newPromptModel(true)

	updated, _ := m.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
	result := updated.(promptModel)

	if !result.sessionExit {
		t.Error("expected sessionExit to be true after ctrl+c")
	}
}

func TestPromptModel_CtrlC_InComment_SetsSessionExit(t *testing.T) {
	m := newPromptModel(true)
	m.phase = phaseComment
	m.decision = &Decision{Action: ActionReject}

	updated, _ := m.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
	result := updated.(promptModel)

	if !result.sessionExit {
		t.Error("expected sessionExit to be true after ctrl+c in comment")
	}
	if result.decision != nil {
		t.Error("expected decision to be cleared on ctrl+c in comment")
	}
}

// =============================================================================
// Comment Phase Tests
// =============================================================================

func TestPromptModel_Comment_SubmitWithEnter(t *testing.T) {
	m := newPromptModel(true)
	m.phase = phaseComment
	m.decision = &Decision{Action: ActionReject}

	// Simulate enter to submit
	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	result := updated.(promptModel)

	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	// Comment should be whatever the textInput contains (empty in this case)
	if result.decision.Comment != "" {
		t.Errorf("expected empty comment, got %q", result.decision.Comment)
	}
}

func TestPromptModel_Comment_SkipWithEsc(t *testing.T) {
	m := newPromptModel(true)
	m.phase = phaseComment
	m.decision = &Decision{Action: ActionReject}

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyEsc})
	result := updated.(promptModel)

	// Decision should be preserved but comment empty
	if result.decision == nil {
		t.Fatal("expected decision to be set")
	}
	if result.decision.Action != ActionReject {
		t.Errorf("expected ActionReject after esc, got %v", result.decision.Action)
	}
}

// =============================================================================
// View Tests
// =============================================================================

func TestPromptModel_ViewSelect_ContainsAllChoices(t *testing.T) {
	m := newPromptModel(true)
	view := m.View().Content

	for _, choice := range defaultChoices {
		if !strings.Contains(view, choice.label) {
			t.Errorf("view should contain choice label %q", choice.label)
		}
		if !strings.Contains(view, choice.desc) {
			t.Errorf("view should contain choice description %q", choice.desc)
		}
	}
}

func TestPromptModel_ViewSelect_ShowsActiveIndicator(t *testing.T) {
	m := newPromptModel(true)
	view := m.View().Content

	if !strings.Contains(view, "▸") {
		t.Error("view should contain active indicator '▸'")
	}
}

func TestPromptModel_ViewSelect_ShowsHints(t *testing.T) {
	m := newPromptModel(true)
	view := m.View().Content

	for _, fragment := range []string{"move", "select", "esc/ctrl+c exit"} {
		if !strings.Contains(view, fragment) {
			t.Errorf("view should contain hint %q", fragment)
		}
	}
}

func TestPromptModel_ViewComment_ShowsHints(t *testing.T) {
	m := newPromptModel(true)
	m.phase = phaseComment
	m.textInput.Focus()
	view := m.View().Content

	if !strings.Contains(view, "submit") {
		t.Error("comment view should contain submit hint")
	}
	if !strings.Contains(view, "skip") {
		t.Error("comment view should contain skip hint")
	}
}

func TestPromptModel_ViewComment_ShowsPrompt(t *testing.T) {
	m := newPromptModel(true)
	m.phase = phaseComment
	m.textInput.Focus()
	view := m.View().Content

	if !strings.Contains(view, "Rejection reason") {
		t.Error("comment view should contain 'Rejection reason' prompt text")
	}
}

// =============================================================================
// Non-KeyMsg Tests
// =============================================================================

func TestPromptModel_IgnoresNonKeyMessages(t *testing.T) {
	m := newPromptModel(true)

	// Send a non-key message
	updated, _ := m.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	result := updated.(promptModel)

	// State should be unchanged
	if result.cursor != 0 {
		t.Errorf("cursor should not change on non-key message, got %d", result.cursor)
	}
	if result.decision != nil {
		t.Error("decision should not change on non-key message")
	}
}
