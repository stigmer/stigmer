package root

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// =============================================================================
// handleKeyPress — global Ctrl+O toggle
// =============================================================================

func TestHandleKeyPress_CtrlO_SendsOnToggleCh(t *testing.T) {
	toggleCh := make(chan struct{}, 1)
	m := newInlineBubbleModelWithChannels(toggleCh, nil, nil)

	m.Update(tea.KeyPressMsg{Code: 'o', Mod: tea.ModCtrl})

	select {
	case <-toggleCh:
	default:
		t.Error("Ctrl+O should send on toggleExpandCh")
	}
}

func TestHandleKeyPress_CtrlO_DuringApproval_StillToggles(t *testing.T) {
	toggleCh := make(chan struct{}, 1)
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModelWithChannels(toggleCh, nil, nil)
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh

	m.Update(tea.KeyPressMsg{Code: 'o', Mod: tea.ModCtrl})

	select {
	case <-toggleCh:
	default:
		t.Error("Ctrl+O during approval should still send toggle signal")
	}

	select {
	case <-decisionCh:
		t.Error("Ctrl+O should not produce an approval decision")
	default:
	}
}

func TestHandleKeyPress_CtrlO_DuringTextInput_StillToggles(t *testing.T) {
	toggleCh := make(chan struct{}, 1)
	inputCh := make(chan string, 1)
	m := newInlineBubbleModelWithChannels(toggleCh, nil, nil)
	m.inputBarMode = inputBarActive
	m.textInputCh = inputCh

	m.Update(tea.KeyPressMsg{Code: 'o', Mod: tea.ModCtrl})

	select {
	case <-toggleCh:
	default:
		t.Error("Ctrl+O during text input should still send toggle signal")
	}

	select {
	case <-inputCh:
		t.Error("Ctrl+O should not produce text input")
	default:
	}
}

func TestHandleKeyPress_CtrlO_NilChannel_NoPanic(t *testing.T) {
	m := newInlineBubbleModel()
	assert.NotPanics(t, func() {
		m.Update(tea.KeyPressMsg{Code: 'o', Mod: tea.ModCtrl})
	})
}

// =============================================================================
// handleApprovalKey — arrow keys, enter, number keys, esc
// =============================================================================

func TestHandleApprovalKey_ArrowDown_IncrementsSelected(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 0

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 1, model.approvalSelected)
}

func TestHandleApprovalKey_ArrowUp_DecrementsSelected(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 2

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 1, model.approvalSelected)
}

func TestHandleApprovalKey_ArrowUp_ClampsAtZero(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 0

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 0, model.approvalSelected)
}

func TestHandleApprovalKey_ArrowDown_ClampsAtMax(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 2

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 2, model.approvalSelected)
}

func TestHandleApprovalKey_Enter_SendsSelectedAction(t *testing.T) {
	tests := []struct {
		selected int
		expected approval.Action
	}{
		{0, approval.ActionApprove},
		{1, approval.ActionSkip},
		{2, approval.ActionReject},
	}

	for _, tt := range tests {
		decisionCh := make(chan approvalDecision, 1)
		m := newInlineBubbleModel()
		m.approvalActive = true
		m.approvalDecisionCh = decisionCh
		m.approvalSelected = tt.selected

		m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})

		d := <-decisionCh
		assert.Equal(t, tt.expected, d.action)
		assert.NoError(t, d.err)
	}
}

func TestHandleApprovalKey_NumberKeys_SendDirectAction(t *testing.T) {
	tests := []struct {
		key      string
		expected approval.Action
	}{
		{"1", approval.ActionApprove},
		{"2", approval.ActionSkip},
		{"3", approval.ActionReject},
	}

	for _, tt := range tests {
		decisionCh := make(chan approvalDecision, 1)
		m := newInlineBubbleModel()
		m.approvalActive = true
		m.approvalDecisionCh = decisionCh

		m.Update(tea.KeyPressMsg{Code: rune(tt.key[0]), Text: tt.key})

		d := <-decisionCh
		assert.Equal(t, tt.expected, d.action)
	}
}

func TestHandleApprovalKey_Esc_SendsSessionExit(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh

	m.Update(tea.KeyPressMsg{Code: tea.KeyEsc})

	d := <-decisionCh
	assert.ErrorIs(t, d.err, approval.ErrSessionExit)
}

func TestHandleApprovalKey_CtrlC_SendsSessionExit(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh

	m.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})

	d := <-decisionCh
	assert.ErrorIs(t, d.err, approval.ErrSessionExit)
}

// =============================================================================
// handleTextInputKey — textinput delegation, submit/cancel intercept
// =============================================================================

// newFocusedTextInputModel creates a model with text input activated and
// focused, ready to process keystrokes through the textinput child model.
func newFocusedTextInputModel(inputCh chan string) inlineBubbleModel {
	m := newInlineBubbleModel()
	m.inputBarMode = inputBarActive
	m.textInputCh = inputCh
	m.textInput.Focus()
	return m
}

func TestHandleTextInputKey_Runes_InsertedViaTextInput(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyExtended, Text: "hello"})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hello", model.textInput.Value())
}

func TestHandleTextInputKey_Space_InsertedViaTextInput(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello")

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeySpace, Text: " "})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hello ", model.textInput.Value())
}

func TestHandleTextInputKey_Backspace_RemovesLastRune(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello")

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hell", model.textInput.Value())
}

func TestHandleTextInputKey_Backspace_EmptyBuffer_NoPanic(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))

	assert.NotPanics(t, func() {
		updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
		model := updated.(inlineBubbleModel)
		assert.Equal(t, "", model.textInput.Value())
	})
}

func TestHandleTextInputKey_Backspace_MultibyteRune(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello 世界")

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hello 世", model.textInput.Value())
}

func TestHandleTextInputKey_Enter_SubmitsValue(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newFocusedTextInputModel(inputCh)
	m.textInput.SetValue("fix the bug")

	m.Update(tea.KeyPressMsg{Code: tea.KeyEnter})

	result := <-inputCh
	assert.Equal(t, "fix the bug", result)
}

func TestHandleTextInputKey_CtrlC_SubmitsEmpty(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newFocusedTextInputModel(inputCh)
	m.textInput.SetValue("partial input")

	m.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})

	result := <-inputCh
	assert.Equal(t, "", result)
}

func TestHandleTextInputKey_CtrlD_EmptyInput_SubmitsEmpty(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newFocusedTextInputModel(inputCh)

	m.Update(tea.KeyPressMsg{Code: 'd', Mod: tea.ModCtrl})

	result := <-inputCh
	assert.Equal(t, "", result)
}

func TestHandleTextInputKey_CtrlD_NonEmpty_DeletesForward(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newFocusedTextInputModel(inputCh)
	m.textInput.SetValue("hello")
	m.textInput.SetCursor(0)

	updated, _ := m.Update(tea.KeyPressMsg{Code: 'd', Mod: tea.ModCtrl})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "ello", model.textInput.Value())

	select {
	case <-inputCh:
		t.Error("Ctrl+D on non-empty input should not submit")
	default:
	}
}

func TestHandleTextInputKey_CursorMovement_LeftRight(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello")
	assert.Equal(t, 5, m.textInput.Position())

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyLeft})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 4, model.textInput.Position())

	updated, _ = model.Update(tea.KeyPressMsg{Code: tea.KeyRight})
	model = updated.(inlineBubbleModel)
	assert.Equal(t, 5, model.textInput.Position())
}

func TestHandleTextInputKey_HomeEnd(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello world")

	updated, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyHome})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 0, model.textInput.Position())

	updated, _ = model.Update(tea.KeyPressMsg{Code: tea.KeyEnd})
	model = updated.(inlineBubbleModel)
	assert.Equal(t, 11, model.textInput.Position())
}

func TestHandleTextInputKey_Paste(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("start ")

	updated, _ := m.Update(tea.PasteMsg{Content: "pasted text"})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "start pasted text", model.textInput.Value())
}

// =============================================================================
// handleIdleKey — Ctrl+C cancel
// =============================================================================

func TestHandleIdleKey_CtrlC_SendsOnCancelCh(t *testing.T) {
	cancelCh := make(chan struct{}, 1)
	m := newInlineBubbleModelWithChannels(nil, cancelCh, nil)

	m.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})

	select {
	case <-cancelCh:
	default:
		t.Error("Ctrl+C in idle state should send on cancelCh")
	}
}

func TestHandleIdleKey_CtrlC_NilChannel_NoPanic(t *testing.T) {
	m := newInlineBubbleModel()
	assert.NotPanics(t, func() {
		m.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
	})
}

func TestHandleIdleKey_OtherKeys_Ignored(t *testing.T) {
	cancelCh := make(chan struct{}, 1)
	m := newInlineBubbleModelWithChannels(nil, cancelCh, nil)

	m.Update(tea.KeyPressMsg{Code: 'x', Text: "x"})

	select {
	case <-cancelCh:
		t.Error("non-Ctrl+C keys should not send on cancelCh")
	default:
	}
}

// =============================================================================
// approvalStartMsg / textInputStartMsg message handlers
// =============================================================================

func TestApprovalStartMsg_ActivatesApproval(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()

	updated, _ := m.Update(approvalStartMsg{
		question:   "approval question",
		decisionCh: decisionCh,
	})

	model := updated.(inlineBubbleModel)
	assert.True(t, model.approvalActive)
	assert.Equal(t, "approval question\n", model.approvalContent)
	assert.Equal(t, 0, model.approvalSelected)
	require.NotNil(t, model.approvalDecisionCh)
}

func TestApprovalStartMsg_ClearsStreaming(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.streamingActive = true
	m.streamingHeader = "streaming header"

	updated, _ := m.Update(approvalStartMsg{
		question:   "question",
		decisionCh: decisionCh,
	})

	model := updated.(inlineBubbleModel)
	assert.False(t, model.streamingActive)
	assert.Empty(t, model.streamingHeader)
}

func TestApprovalHideMsg_ClearsDecisionCh(t *testing.T) {
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = make(chan approvalDecision, 1)

	updated, _ := m.Update(approvalHideMsg{})
	model := updated.(inlineBubbleModel)
	assert.Nil(t, model.approvalDecisionCh)
}

func TestTextInputStartMsg_ActivatesInput(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()

	updated, _ := m.Update(textInputStartMsg{inputCh: inputCh})

	model := updated.(inlineBubbleModel)
	assert.Equal(t, inputBarActive, model.inputBarMode)
	assert.Empty(t, model.textInput.Value())
	assert.True(t, model.textInput.Focused())
	require.NotNil(t, model.textInputCh)
}

func TestTextInputHideMsg_ClearsState(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("leftover")

	updated, _ := m.Update(textInputHideMsg{})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, inputBarDisabled, model.inputBarMode)
	assert.Empty(t, model.textInput.Value())
	assert.False(t, model.textInput.Focused())
	assert.Nil(t, model.textInputCh)
}

// =============================================================================
// View() — text input rendering
// =============================================================================

func TestView_TextInputActive_ShowsPromptAndBuffer(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello world")
	m.termWidth = 40

	view := m.View()
	assert.Contains(t, view.Content, ">")
	assert.Contains(t, view.Content, "hello world")
	assert.Contains(t, view.Content, "enter send")
	assert.Contains(t, view.Content, "─")
}

func TestView_TextInputActive_EmptyBuffer(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.termWidth = 40

	view := m.View()
	assert.Contains(t, view.Content, ">")
	assert.Contains(t, view.Content, "enter send")
}

func TestView_TextInput_TakesPrecedenceOverFollowUp(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.termWidth = 40
	m.followUpActive = true
	m.followUpContent = "old follow-up"

	view := m.View()
	assert.Contains(t, view.Content, ">")
	assert.NotContains(t, view.Content, "old follow-up")
}

func TestView_TextInput_CursorPosition(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.textInput.SetValue("hello")
	m.termWidth = 80

	view := m.View()
	require.NotNil(t, view.Cursor, "cursor should be set for text input")
	assert.Equal(t, tea.CursorBar, view.Cursor.Shape)
	assert.True(t, view.Cursor.Blink)
	assert.Equal(t, 1, view.Cursor.Y, "cursor should be on the input line (row 1: separator at 0)")
	assert.Greater(t, view.Cursor.X, 0, "cursor X should be positive")
}

func TestView_TextInput_CursorPosition_EmptyBuffer(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.termWidth = 80

	view := m.View()
	require.NotNil(t, view.Cursor)
	assert.Equal(t, 1, view.Cursor.Y)
	xEmpty := view.Cursor.X

	m.textInput.SetValue("abc")
	view2 := m.View()
	assert.Greater(t, view2.Cursor.X, xEmpty, "cursor X should advance with buffer content")
}

func TestView_TextInput_TermWidthSeparator(t *testing.T) {
	m := newFocusedTextInputModel(make(chan string, 1))
	m.termWidth = 60

	view := m.View()
	assert.Contains(t, view.Content, strings.Repeat("─", 60))
}

func TestUpdate_WindowSizeMsg_StoresWidth(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	model := updated.(inlineBubbleModel)
	assert.Equal(t, 120, model.termWidth)
	assert.Nil(t, cmd)
}

// =============================================================================
// approvalActionByIndex
// =============================================================================

func TestApprovalActionByIndex(t *testing.T) {
	assert.Equal(t, approval.ActionApprove, approvalActionByIndex(0))
	assert.Equal(t, approval.ActionSkip, approvalActionByIndex(1))
	assert.Equal(t, approval.ActionReject, approvalActionByIndex(2))
	assert.Equal(t, approval.ActionSkip, approvalActionByIndex(99))
}
