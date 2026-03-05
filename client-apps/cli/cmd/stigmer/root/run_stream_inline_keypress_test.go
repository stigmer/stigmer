package root

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// =============================================================================
// handleKeyPress — global Ctrl+O toggle
// =============================================================================

func TestHandleKeyPress_CtrlO_SendsOnToggleCh(t *testing.T) {
	toggleCh := make(chan struct{}, 1)
	m := newInlineBubbleModelWithChannels(toggleCh, nil)

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})

	select {
	case <-toggleCh:
	default:
		t.Error("Ctrl+O should send on toggleExpandCh")
	}
}

func TestHandleKeyPress_CtrlO_DuringApproval_StillToggles(t *testing.T) {
	toggleCh := make(chan struct{}, 1)
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModelWithChannels(toggleCh, nil)
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})

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
	m := newInlineBubbleModelWithChannels(toggleCh, nil)
	m.textInputActive = true
	m.textInputCh = inputCh

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})

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
		m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
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

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 1, model.approvalSelected)
}

func TestHandleApprovalKey_ArrowUp_DecrementsSelected(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 2

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyUp})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 1, model.approvalSelected)
}

func TestHandleApprovalKey_ArrowUp_ClampsAtZero(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 0

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyUp})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, 0, model.approvalSelected)
}

func TestHandleApprovalKey_ArrowDown_ClampsAtMax(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh
	m.approvalSelected = 2

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
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

		m.Update(tea.KeyMsg{Type: tea.KeyEnter})

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

		m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(tt.key)})

		d := <-decisionCh
		assert.Equal(t, tt.expected, d.action)
	}
}

func TestHandleApprovalKey_Esc_SendsSessionExit(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh

	m.Update(tea.KeyMsg{Type: tea.KeyEsc})

	d := <-decisionCh
	assert.ErrorIs(t, d.err, approval.ErrSessionExit)
}

func TestHandleApprovalKey_CtrlC_SendsSessionExit(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.approvalActive = true
	m.approvalDecisionCh = decisionCh

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})

	d := <-decisionCh
	assert.ErrorIs(t, d.err, approval.ErrSessionExit)
}

// =============================================================================
// handleTextInputKey — runes, backspace, enter, ctrl+c/d
// =============================================================================

func TestHandleTextInputKey_Runes_AppendToBuffer(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("hello")})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hello", model.textInputBuffer)
}

func TestHandleTextInputKey_Space_AppendsSpace(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh
	m.textInputBuffer = "hello"

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeySpace})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hello ", model.textInputBuffer)
}

func TestHandleTextInputKey_Backspace_RemovesLastRune(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh
	m.textInputBuffer = "hello"

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hell", model.textInputBuffer)
}

func TestHandleTextInputKey_Backspace_EmptyBuffer_NoPanic(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh

	assert.NotPanics(t, func() {
		updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyBackspace})
		model := updated.(inlineBubbleModel)
		assert.Equal(t, "", model.textInputBuffer)
	})
}

func TestHandleTextInputKey_Backspace_MultibyteRune(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh
	m.textInputBuffer = "hello 世界"

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyBackspace})
	model := updated.(inlineBubbleModel)
	assert.Equal(t, "hello 世", model.textInputBuffer)
}

func TestHandleTextInputKey_Enter_SubmitsBuffer(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh
	m.textInputBuffer = "fix the bug"

	m.Update(tea.KeyMsg{Type: tea.KeyEnter})

	result := <-inputCh
	assert.Equal(t, "fix the bug", result)
}

func TestHandleTextInputKey_CtrlC_SubmitsEmpty(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh
	m.textInputBuffer = "partial input"

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})

	result := <-inputCh
	assert.Equal(t, "", result)
}

func TestHandleTextInputKey_CtrlD_SubmitsEmpty(t *testing.T) {
	inputCh := make(chan string, 1)
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputCh = inputCh
	m.textInputBuffer = "partial input"

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlD})

	result := <-inputCh
	assert.Equal(t, "", result)
}

// =============================================================================
// handleIdleKey — Ctrl+C cancel
// =============================================================================

func TestHandleIdleKey_CtrlC_SendsOnCancelCh(t *testing.T) {
	cancelCh := make(chan struct{}, 1)
	m := newInlineBubbleModelWithChannels(nil, cancelCh)

	m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})

	select {
	case <-cancelCh:
	default:
		t.Error("Ctrl+C in idle state should send on cancelCh")
	}
}

func TestHandleIdleKey_CtrlC_NilChannel_NoPanic(t *testing.T) {
	m := newInlineBubbleModel()
	assert.NotPanics(t, func() {
		m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	})
}

func TestHandleIdleKey_OtherKeys_Ignored(t *testing.T) {
	cancelCh := make(chan struct{}, 1)
	m := newInlineBubbleModelWithChannels(nil, cancelCh)

	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("x")})

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
		content:    "approval content",
		decisionCh: decisionCh,
	})

	model := updated.(inlineBubbleModel)
	assert.True(t, model.approvalActive)
	assert.Equal(t, "approval content", model.approvalContent)
	assert.Equal(t, 0, model.approvalSelected)
	require.NotNil(t, model.approvalDecisionCh)
}

func TestApprovalStartMsg_ClearsStreaming(t *testing.T) {
	decisionCh := make(chan approvalDecision, 1)
	m := newInlineBubbleModel()
	m.streamingActive = true
	m.streamingHeader = "streaming header"

	updated, _ := m.Update(approvalStartMsg{
		content:    "content",
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

	updated, _ := m.Update(textInputStartMsg{
		prompt:  "> ",
		inputCh: inputCh,
	})

	model := updated.(inlineBubbleModel)
	assert.True(t, model.textInputActive)
	assert.Equal(t, "> ", model.textInputPrompt)
	assert.Empty(t, model.textInputBuffer)
	require.NotNil(t, model.textInputCh)
}

func TestTextInputHideMsg_ClearsState(t *testing.T) {
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputBuffer = "leftover"
	m.textInputCh = make(chan string, 1)

	updated, _ := m.Update(textInputHideMsg{})
	model := updated.(inlineBubbleModel)
	assert.False(t, model.textInputActive)
	assert.Empty(t, model.textInputBuffer)
	assert.Nil(t, model.textInputCh)
}

// =============================================================================
// View() — text input rendering
// =============================================================================

func TestView_TextInputActive_ShowsPromptAndBuffer(t *testing.T) {
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputPrompt = "> "
	m.textInputBuffer = "hello world"

	view := m.View()
	assert.Equal(t, "> hello world", view)
}

func TestView_TextInputActive_EmptyBuffer(t *testing.T) {
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputPrompt = "> "

	view := m.View()
	assert.Equal(t, "> ", view)
}

func TestView_TextInput_TakesPrecedenceOverFollowUp(t *testing.T) {
	m := newInlineBubbleModel()
	m.textInputActive = true
	m.textInputPrompt = "> "
	m.followUpActive = true
	m.followUpContent = "old follow-up"

	view := m.View()
	assert.Equal(t, "> ", view)
	assert.NotContains(t, view, "old follow-up")
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
