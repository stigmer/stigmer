package root

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
)

// =============================================================================
// inlineBubbleModel Unit Tests
// =============================================================================

func TestInlineBubbleModel_Init_ReturnsNil(t *testing.T) {
	m := newInlineBubbleModel()
	if cmd := m.Init(); cmd != nil {
		t.Error("Init() should return nil")
	}
}

func TestInlineBubbleModel_View_ReturnsEmpty(t *testing.T) {
	m := newInlineBubbleModel()
	if v := m.View(); v.Content != "" {
		t.Errorf("View() should return empty content, got %q", v.Content)
	}
}

func TestInlineBubbleModel_Update_PassThrough(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(tea.KeyPressMsg{})
	if cmd != nil {
		t.Error("Update() should return nil cmd")
	}
	if _, ok := updated.(inlineBubbleModel); !ok {
		t.Error("Update() should return the same model type")
	}
}

// =============================================================================
// Spinner Model Tests
// =============================================================================

func TestInlineBubbleModel_SpinnerStart_ActivatesAndReturnsTick(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(spinnerStartMsg{label: "Thinking..."})

	model := updated.(inlineBubbleModel)
	if !model.spinnerActive {
		t.Error("spinnerStartMsg should set spinnerActive=true")
	}
	if model.spinnerLabel != "Thinking..." {
		t.Errorf("expected label 'Thinking...', got %q", model.spinnerLabel)
	}
	if model.spinnerFrame != 0 {
		t.Errorf("expected frame 0 on start, got %d", model.spinnerFrame)
	}
	if cmd == nil {
		t.Error("spinnerStartMsg should return a tick Cmd")
	}
}

func TestInlineBubbleModel_SpinnerStop_Deactivates(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	stopped, cmd := started.Update(spinnerStopMsg{})

	model := stopped.(inlineBubbleModel)
	if model.spinnerActive {
		t.Error("spinnerStopMsg should set spinnerActive=false")
	}
	if cmd != nil {
		t.Error("spinnerStopMsg should return nil Cmd (no more ticks)")
	}
}

func TestInlineBubbleModel_SpinnerTick_AdvancesFrame(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})

	ticked, cmd := started.Update(spinnerTickMsg{})
	model := ticked.(inlineBubbleModel)
	if model.spinnerFrame != 1 {
		t.Errorf("expected frame 1 after one tick, got %d", model.spinnerFrame)
	}
	if cmd == nil {
		t.Error("active tick should return next tick Cmd")
	}

	ticked2, _ := ticked.Update(spinnerTickMsg{})
	model2 := ticked2.(inlineBubbleModel)
	if model2.spinnerFrame != 2 {
		t.Errorf("expected frame 2 after two ticks, got %d", model2.spinnerFrame)
	}
}

func TestInlineBubbleModel_SpinnerTick_StopsWhenInactive(t *testing.T) {
	m := newInlineBubbleModel()

	ticked, cmd := m.Update(spinnerTickMsg{})
	model := ticked.(inlineBubbleModel)
	if model.spinnerFrame != 0 {
		t.Errorf("tick on inactive spinner should not advance frame, got %d", model.spinnerFrame)
	}
	if cmd != nil {
		t.Error("tick on inactive spinner should return nil Cmd (terminate chain)")
	}
}

func TestInlineBubbleModel_View_SpinnerActive(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	model := started.(inlineBubbleModel)

	v := model.View().Content
	if v == "" {
		t.Fatal("View() should return non-empty string when spinner is active")
	}
	if !strings.Contains(v, "Thinking...") {
		t.Errorf("View() should contain the label, got %q", v)
	}
	if !strings.Contains(v, "⠋") {
		t.Errorf("View() should contain the first spinner frame, got %q", v)
	}
}

func TestInlineBubbleModel_View_SpinnerInactive(t *testing.T) {
	m := newInlineBubbleModel()
	if v := m.View().Content; v != "" {
		t.Errorf("View() should return empty string when spinner is inactive, got %q", v)
	}
}

func TestInlineBubbleModel_SpinnerStart_ResetsFrame(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Working..."})
	ticked, _ := started.Update(spinnerTickMsg{})
	ticked2, _ := ticked.Update(spinnerTickMsg{})

	model := ticked2.(inlineBubbleModel)
	if model.spinnerFrame != 2 {
		t.Fatalf("expected frame 2 before restart, got %d", model.spinnerFrame)
	}

	restarted, _ := ticked2.Update(spinnerStartMsg{label: "Thinking..."})
	restartedModel := restarted.(inlineBubbleModel)
	if restartedModel.spinnerFrame != 0 {
		t.Errorf("spinnerStartMsg should reset frame to 0, got %d", restartedModel.spinnerFrame)
	}
	if restartedModel.spinnerLabel != "Thinking..." {
		t.Errorf("expected label 'Thinking...' after restart, got %q", restartedModel.spinnerLabel)
	}
}

// =============================================================================
// Approval Model Tests
// =============================================================================

func TestInlineBubbleModel_ApprovalShow_ActivatesPanel(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(approvalShowMsg{
		expandedContent: "expanded view\n",
		question:        "question",
	})

	model := updated.(inlineBubbleModel)
	if !model.approvalActive {
		t.Error("approvalShowMsg should set approvalActive=true")
	}
	if model.approvalContent != "question\n" {
		t.Errorf("expected question stored in approvalContent, got %q", model.approvalContent)
	}
	if model.approvalSelected != 0 {
		t.Errorf("expected selected=0 on show, got %d", model.approvalSelected)
	}
	if cmd == nil {
		t.Fatal("approvalShowMsg with expandedContent should return a Println Cmd")
	}
}

func TestInlineBubbleModel_ApprovalShow_NoCmdWhenNoExpandedContent(t *testing.T) {
	m := newInlineBubbleModel()
	_, cmd := m.Update(approvalShowMsg{question: "question"})

	if cmd != nil {
		t.Error("approvalShowMsg without expandedContent should return nil Cmd")
	}
}

func TestInlineBubbleModel_ApprovalSelect_UpdatesIndex(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{question: "content"})
	updated, cmd := shown.Update(approvalSelectMsg{selected: 2})

	model := updated.(inlineBubbleModel)
	if model.approvalSelected != 2 {
		t.Errorf("expected selected=2, got %d", model.approvalSelected)
	}
	if cmd != nil {
		t.Error("approvalSelectMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_ApprovalHide_ClearsPanelWithPrintln(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{question: "content"})
	updated, cmd := shown.Update(approvalHideMsg{collapsedResult: "✓ Write(config.go)"})

	model := updated.(inlineBubbleModel)
	if model.approvalActive {
		t.Error("approvalHideMsg should set approvalActive=false")
	}
	if model.approvalContent != "" {
		t.Errorf("approvalHideMsg should clear content, got %q", model.approvalContent)
	}
	if model.approvalSelected != 0 {
		t.Errorf("approvalHideMsg should reset selected, got %d", model.approvalSelected)
	}
	if cmd == nil {
		t.Fatal("approvalHideMsg with non-empty result should return a Println Cmd")
	}
}

func TestInlineBubbleModel_ApprovalHide_NoCmdWhenEmpty(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{question: "content"})
	_, cmd := shown.Update(approvalHideMsg{})

	if cmd != nil {
		t.Error("approvalHideMsg with empty collapsedResult should return nil Cmd")
	}
}

func TestInlineBubbleModel_View_ApprovalActive_ShowsQuestionAndMenu(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{question: "Do you want to create config.go?"})
	model := shown.(inlineBubbleModel)

	v := model.View().Content
	if !strings.Contains(v, "Do you want to create config.go?") {
		t.Errorf("View() with approval active should contain question, got %q", v)
	}
	if !strings.Contains(v, "Approve") || !strings.Contains(v, "Skip") || !strings.Contains(v, "Reject") {
		t.Errorf("View() with approval active should contain menu choices, got %q", v)
	}
}

func TestInlineBubbleModel_View_ApprovalPriorityOverSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	shown, _ := started.Update(approvalShowMsg{question: "approval question"})
	model := shown.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "Thinking...") {
		t.Error("approval panel should take priority over spinner in View()")
	}
	if !strings.Contains(v, "approval question") {
		t.Errorf("View() should show approval question, got %q", v)
	}
}

func TestInlineBubbleModel_ApprovalHide_ResumesSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	shown, _ := started.Update(approvalShowMsg{question: "content"})
	hidden, _ := shown.Update(approvalHideMsg{})
	model := hidden.(inlineBubbleModel)

	if model.approvalActive {
		t.Error("approval should be inactive after hide")
	}
	if !model.spinnerActive {
		t.Error("spinner should still be active after approval hide")
	}
}

func TestInlineBubbleModel_ApprovalShow_ResetsSelectedToZero(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(approvalShowMsg{question: "first"})
	selected, _ := shown.Update(approvalSelectMsg{selected: 2})
	reshown, _ := selected.Update(approvalShowMsg{question: "second"})

	model := reshown.(inlineBubbleModel)
	if model.approvalSelected != 0 {
		t.Errorf("approvalShowMsg should reset selected to 0, got %d", model.approvalSelected)
	}
}

func TestInlineBubbleModel_ApprovalStart_CommitsExpandedContent(t *testing.T) {
	m := newInlineBubbleModel()
	decisionCh := make(chan approvalDecision, 1)
	updated, cmd := m.Update(approvalStartMsg{
		expandedContent: "─── sep ───\n● Write(config.go)\npackage config\n─── sep ───\n",
		question:        "Do you want to create config.go?",
		decisionCh:      decisionCh,
	})

	model := updated.(inlineBubbleModel)
	if !model.approvalActive {
		t.Error("approvalStartMsg should set approvalActive=true")
	}
	if model.approvalContent != "Do you want to create config.go?\n" {
		t.Errorf("expected question in approvalContent, got %q", model.approvalContent)
	}
	if model.approvalDecisionCh == nil {
		t.Error("approvalStartMsg should set decisionCh")
	}
	if model.streamingActive {
		t.Error("approvalStartMsg should clear streamingActive")
	}
	if model.aiStreamActive {
		t.Error("approvalStartMsg should clear aiStreamActive")
	}
	if cmd == nil {
		t.Fatal("approvalStartMsg with expandedContent should return a Println Cmd")
	}
}

func TestInlineBubbleModel_ApprovalStart_NoCmdWhenNoExpandedContent(t *testing.T) {
	m := newInlineBubbleModel()
	decisionCh := make(chan approvalDecision, 1)
	_, cmd := m.Update(approvalStartMsg{
		question:   "Do you want to run custom_tool?",
		decisionCh: decisionCh,
	})

	if cmd != nil {
		t.Error("approvalStartMsg without expandedContent should return nil Cmd")
	}
}

func TestInlineBubbleModel_ApprovalShow_ClearsAIStreamState(t *testing.T) {
	m := newInlineBubbleModel()
	aiStreaming, _ := m.Update(aiStreamPartialMsg{partial: "typing..."})
	shown, _ := aiStreaming.Update(approvalShowMsg{question: "question"})
	model := shown.(inlineBubbleModel)

	if model.aiStreamActive {
		t.Error("approvalShowMsg should clear aiStreamActive")
	}
	if model.aiStreamPartial != "" {
		t.Errorf("approvalShowMsg should clear aiStreamPartial, got %q", model.aiStreamPartial)
	}
}

// =============================================================================
// Streaming Model Tests
// =============================================================================

func TestInlineBubbleModel_StreamingHeaderUpdate_NonProgressive(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "─── sep ───\nWrite()\n"})
	updated, cmd := shown.Update(streamingHeaderUpdateMsg{header: "─── sep ───\nWrite(config.go)\n"})

	model := updated.(inlineBubbleModel)
	if model.streamingHeader != "─── sep ───\nWrite(config.go)\n" {
		t.Errorf("expected updated header, got %q", model.streamingHeader)
	}
	if !model.streamingActive {
		t.Error("streamingHeaderUpdateMsg should not deactivate streaming")
	}
	if cmd != nil {
		t.Error("streamingHeaderUpdateMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_StreamingHeaderUpdate_ProgressiveIgnored(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "─── sep ───\nWrite()\n", progressive: true})
	updated, cmd := shown.Update(streamingHeaderUpdateMsg{header: "─── sep ───\nWrite(config.go)\n"})

	model := updated.(inlineBubbleModel)
	if model.streamingHeader != "" {
		t.Errorf("progressive mode should not store header in model, got %q", model.streamingHeader)
	}
	if cmd != nil {
		t.Error("progressive header update should return nil Cmd")
	}
}

// =============================================================================
// Streaming Model Tests (continued)
// =============================================================================

func TestInlineBubbleModel_StreamingShow_NonProgressive(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(streamingShowMsg{
		header:     "─── separator ───\nWrite(main.go)\n",
		subAgentID: "",
	})

	model := updated.(inlineBubbleModel)
	if !model.streamingActive {
		t.Error("streamingShowMsg should set streamingActive=true")
	}
	if model.streamingHeader != "─── separator ───\nWrite(main.go)\n" {
		t.Errorf("expected header stored, got %q", model.streamingHeader)
	}
	if model.streamingContent != "" {
		t.Errorf("expected empty content on show, got %q", model.streamingContent)
	}
	if model.streamingProgressive {
		t.Error("expected progressive=false")
	}
	if cmd != nil {
		t.Error("non-progressive streamingShowMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_StreamingShow_Progressive(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(streamingShowMsg{
		progressive: true,
	})

	model := updated.(inlineBubbleModel)
	if !model.streamingActive {
		t.Error("streamingShowMsg should set streamingActive=true")
	}
	if model.streamingHeader != "" {
		t.Errorf("progressive mode should not store header in model, got %q", model.streamingHeader)
	}
	if !model.streamingProgressive {
		t.Error("expected progressive=true")
	}
	if model.streamingCommittedLen != 0 {
		t.Errorf("expected streamingCommittedLen=0, got %d", model.streamingCommittedLen)
	}
	if cmd != nil {
		t.Error("progressive streamingShowMsg should return nil Cmd (header committed renderer-side)")
	}
}

func TestInlineBubbleModel_StreamingUpdate_NonProgressiveStoresContent(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n"})
	updated, cmd := shown.Update(streamingUpdateMsg{content: "line 1\nline 2\n"})

	model := updated.(inlineBubbleModel)
	if model.streamingContent != "line 1\nline 2\n" {
		t.Errorf("expected full content stored, got %q", model.streamingContent)
	}
	if cmd != nil {
		t.Error("non-progressive streamingUpdateMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_StreamingUpdate_ProgressiveCommitsLines(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", progressive: true})
	updated, cmd := shown.Update(streamingUpdateMsg{content: "line 1\nline 2\npartial"})

	model := updated.(inlineBubbleModel)
	if model.streamingContent != "partial" {
		t.Errorf("expected only partial line stored, got %q", model.streamingContent)
	}
	if model.streamingCommittedLen != len("line 1\nline 2\n") {
		t.Errorf("expected committedLen=%d, got %d", len("line 1\nline 2\n"), model.streamingCommittedLen)
	}
	if cmd == nil {
		t.Fatal("progressive update with complete lines should return a Println Cmd")
	}
}

func TestInlineBubbleModel_StreamingUpdate_ProgressiveNoNewLines(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", progressive: true})
	updated, cmd := shown.Update(streamingUpdateMsg{content: "partial"})

	model := updated.(inlineBubbleModel)
	if model.streamingContent != "partial" {
		t.Errorf("expected partial line stored, got %q", model.streamingContent)
	}
	if model.streamingCommittedLen != 0 {
		t.Errorf("expected committedLen=0 with no complete lines, got %d", model.streamingCommittedLen)
	}
	if cmd != nil {
		t.Error("progressive update with no complete lines should return nil Cmd")
	}
}

func TestInlineBubbleModel_StreamingHide_WithCollapsedResult(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n"})
	shown.Update(streamingUpdateMsg{content: "output\n"})
	updated, cmd := shown.Update(streamingHideMsg{collapsedResult: "⊡ Shell command=echo hi"})

	model := updated.(inlineBubbleModel)
	if model.streamingActive {
		t.Error("streamingHideMsg should set streamingActive=false")
	}
	if model.streamingHeader != "" {
		t.Errorf("streamingHideMsg should clear header, got %q", model.streamingHeader)
	}
	if model.streamingContent != "" {
		t.Errorf("streamingHideMsg should clear content, got %q", model.streamingContent)
	}
	if model.streamingProgressive {
		t.Error("streamingHideMsg should clear progressive flag")
	}
	if model.streamingCommittedLen != 0 {
		t.Errorf("streamingHideMsg should clear committedLen, got %d", model.streamingCommittedLen)
	}
	if cmd == nil {
		t.Fatal("streamingHideMsg with non-empty result should return a Println Cmd")
	}
}

func TestInlineBubbleModel_StreamingHide_NoCmdWhenEmpty(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n"})
	_, cmd := shown.Update(streamingHideMsg{})

	if cmd != nil {
		t.Error("streamingHideMsg with empty collapsedResult should return nil Cmd")
	}
}

func TestInlineBubbleModel_View_StreamingActive_ShowsHeader(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "─── Write(main.go) ───\n"})
	model := shown.(inlineBubbleModel)

	v := model.View().Content
	if !strings.Contains(v, "Write(main.go)") {
		t.Errorf("View() with non-progressive streaming should contain header, got %q", v)
	}
}

func TestInlineBubbleModel_View_StreamingWithContent(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n"})
	updated, _ := shown.Update(streamingUpdateMsg{content: "package main\n"})
	model := updated.(inlineBubbleModel)

	v := model.View().Content
	if !strings.Contains(v, "header") {
		t.Errorf("View() should contain header, got %q", v)
	}
	if !strings.Contains(v, "package main") {
		t.Errorf("View() should contain content, got %q", v)
	}
}

func TestInlineBubbleModel_View_ProgressiveShowsOnlyPartialLine(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", progressive: true})
	updated, _ := shown.Update(streamingUpdateMsg{content: "line 1\nline 2\npartial"})
	model := updated.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "header") {
		t.Error("progressive View() should not contain header (committed to scrollback)")
	}
	if strings.Contains(v, "line 1") || strings.Contains(v, "line 2") {
		t.Error("progressive View() should not contain committed lines")
	}
	if !strings.Contains(v, "partial") {
		t.Errorf("progressive View() should contain partial line, got %q", v)
	}
}

func TestInlineBubbleModel_View_ApprovalPriorityOverStreaming(t *testing.T) {
	m := newInlineBubbleModel()
	streamed, _ := m.Update(streamingShowMsg{header: "streaming header\n"})
	updated, _ := streamed.Update(streamingUpdateMsg{content: "streaming content\n"})
	approved, _ := updated.Update(approvalShowMsg{question: "approval question"})
	model := approved.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "streaming") {
		t.Error("approval panel should take priority over streaming in View()")
	}
	if !strings.Contains(v, "approval question") {
		t.Errorf("View() should show approval question, got %q", v)
	}
}

func TestInlineBubbleModel_ApprovalShow_ClearsStreamingState(t *testing.T) {
	m := newInlineBubbleModel()
	streamed, _ := m.Update(streamingShowMsg{header: "header\n"})
	updated, _ := streamed.Update(streamingUpdateMsg{content: "content\n"})
	approved, _ := updated.Update(approvalShowMsg{question: "panel"})
	model := approved.(inlineBubbleModel)

	if model.streamingActive {
		t.Error("approvalShowMsg should clear streamingActive")
	}
	if model.streamingHeader != "" {
		t.Errorf("approvalShowMsg should clear streamingHeader, got %q", model.streamingHeader)
	}
	if model.streamingContent != "" {
		t.Errorf("approvalShowMsg should clear streamingContent, got %q", model.streamingContent)
	}
	if model.streamingProgressive {
		t.Error("approvalShowMsg should clear streamingProgressive")
	}
}

// TestInlineBubbleModel_ApprovalStart_ClearsStreamingState verifies that
// approvalStartMsg clears all streaming state when activating approval.
// The re-commit for streaming→approval transitions is now handled by
// performReCommitWithApproval in the renderer, not by the model.
func TestInlineBubbleModel_ApprovalStart_ClearsStreamingState(t *testing.T) {
	m := newInlineBubbleModel()

	shown, _ := m.Update(streamingShowMsg{
		header:      "─── sep ───\n● Write()\n",
		progressive: true,
	})
	updated, _ := shown.Update(streamingUpdateMsg{content: "apiVersion: v1\nkind: McpServer\n"})

	model := updated.(inlineBubbleModel)
	if !model.streamingActive {
		t.Fatal("precondition: streaming should be active")
	}

	decisionCh := make(chan approvalDecision, 1)
	approved, cmd := updated.Update(approvalStartMsg{
		expandedContent: "─── sep ───\n● Write(config.go)\ncontent\n─── sep ───",
		question:        "Do you want to create config.go?",
		decisionCh:      decisionCh,
	})
	model = approved.(inlineBubbleModel)
	if !model.approvalActive {
		t.Error("approvalStartMsg should set approvalActive=true")
	}
	if model.streamingActive {
		t.Error("approvalStartMsg should clear streamingActive")
	}
	if model.aiStreamActive {
		t.Error("approvalStartMsg should clear aiStreamActive")
	}
	if cmd == nil {
		t.Fatal("approvalStartMsg with expandedContent should return a Println Cmd")
	}

	approvalView := model.View().Content
	if !strings.Contains(approvalView, "Do you want to create config.go?") {
		t.Errorf("View() should show approval question, got %q", approvalView)
	}
}

// TestInlineBubbleModel_ApprovalStart_PrintlnForExpandedContent verifies
// that approvalStartMsg uses tea.Println for expandedContent.
func TestInlineBubbleModel_ApprovalStart_PrintlnForExpandedContent(t *testing.T) {
	m := newInlineBubbleModel()
	decisionCh := make(chan approvalDecision, 1)
	_, cmd := m.Update(approvalStartMsg{
		expandedContent: "─── sep ───\n● Write(config.go)\ncontent\n─── sep ───\n",
		question:        "Do you want to create config.go?",
		decisionCh:      decisionCh,
	})
	if cmd == nil {
		t.Fatal("approvalStartMsg with expandedContent should return a Println Cmd")
	}
}

// TestInlineBubbleModel_ApprovalShow_PrintlnForExpandedContent verifies
// that the legacy approvalShowMsg uses tea.Println for expandedContent.
func TestInlineBubbleModel_ApprovalShow_PrintlnForExpandedContent(t *testing.T) {
	m := newInlineBubbleModel()

	shown, _ := m.Update(streamingShowMsg{
		header:      "─── sep ───\n● Write()\n",
		progressive: true,
	})
	updated, _ := shown.Update(streamingUpdateMsg{content: "apiVersion: v1\n"})

	approved, cmd := updated.Update(approvalShowMsg{
		expandedContent: "─── sep ───\n● Write(config.go)\napiVersion: v1\n─── sep ───",
		question:        "Do you want to create config.go?",
	})
	model := approved.(inlineBubbleModel)
	if !model.approvalActive {
		t.Error("approvalShowMsg should set approvalActive=true")
	}
	if model.streamingActive {
		t.Error("approvalShowMsg should clear streamingActive")
	}
	if cmd == nil {
		t.Fatal("approvalShowMsg with expandedContent should return a Println Cmd")
	}
}

func TestInlineBubbleModel_View_StreamingPriorityOverSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	streamed, _ := started.Update(streamingShowMsg{header: "streaming\n"})
	model := streamed.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "Thinking...") {
		t.Error("streaming should take priority over spinner in View()")
	}
	if !strings.Contains(v, "streaming") {
		t.Errorf("View() should show streaming content, got %q", v)
	}
}

// =============================================================================
// Follow-up Prompt Model Tests
// =============================================================================

func TestInlineBubbleModel_FollowUpShow_ActivatesPrompt(t *testing.T) {
	m := newInlineBubbleModel()
	updated, cmd := m.Update(followUpShowMsg{content: "\n───\n  hint\n> "})

	model := updated.(inlineBubbleModel)
	if !model.followUpActive {
		t.Error("followUpShowMsg should set followUpActive=true")
	}
	if model.followUpContent != "\n───\n  hint\n> " {
		t.Errorf("expected content to be stored, got %q", model.followUpContent)
	}
	if cmd != nil {
		t.Error("followUpShowMsg should return nil Cmd")
	}
}

func TestInlineBubbleModel_FollowUpHide_ClearsState(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(followUpShowMsg{content: "\n───\n  hint\n> "})
	updated, cmd := shown.Update(followUpHideMsg{})

	model := updated.(inlineBubbleModel)
	if model.followUpActive {
		t.Error("followUpHideMsg should set followUpActive=false")
	}
	if model.followUpContent != "" {
		t.Errorf("followUpHideMsg should clear content, got %q", model.followUpContent)
	}
	if cmd != nil {
		t.Error("followUpHideMsg with empty styledMessage should return nil Cmd")
	}
}

func TestInlineBubbleModel_FollowUpHide_WithStyledMessage(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(followUpShowMsg{content: "\n───\n  hint\n> "})
	updated, cmd := shown.Update(followUpHideMsg{styledMessage: " fix the bug \n\n"})

	model := updated.(inlineBubbleModel)
	if model.followUpActive {
		t.Error("followUpHideMsg should set followUpActive=false")
	}
	if cmd == nil {
		t.Fatal("followUpHideMsg with non-empty styledMessage should return a Println Cmd")
	}
}

func TestInlineBubbleModel_View_FollowUpActive_ShowsPrompt(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(followUpShowMsg{content: "\n───\n  enter send\n> "})
	model := shown.(inlineBubbleModel)

	v := model.View().Content
	if !strings.Contains(v, "───") {
		t.Errorf("View() with followUp active should contain separator, got %q", v)
	}
	if !strings.Contains(v, "enter send") {
		t.Errorf("View() with followUp active should contain hint, got %q", v)
	}
	if !strings.Contains(v, ">") {
		t.Errorf("View() with followUp active should contain prompt marker, got %q", v)
	}
}

func TestInlineBubbleModel_View_FollowUpPriorityOverSpinner(t *testing.T) {
	m := newInlineBubbleModel()
	started, _ := m.Update(spinnerStartMsg{label: "Thinking..."})
	shown, _ := started.Update(followUpShowMsg{content: "follow-up prompt"})
	model := shown.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "Thinking...") {
		t.Error("follow-up prompt should take priority over spinner in View()")
	}
	if !strings.Contains(v, "follow-up prompt") {
		t.Errorf("View() should show follow-up prompt, got %q", v)
	}
}

func TestInlineBubbleModel_View_ApprovalPriorityOverFollowUp(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(followUpShowMsg{content: "follow-up prompt"})
	approved, _ := shown.Update(approvalShowMsg{question: "approval question"})
	model := approved.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "follow-up prompt") {
		t.Error("approval panel should take priority over follow-up prompt in View()")
	}
	if !strings.Contains(v, "approval question") {
		t.Errorf("View() should show approval question, got %q", v)
	}
}

// =============================================================================
// Progressive Streaming — Large Content Tests
// =============================================================================

func TestInlineBubbleModel_StreamingUpdate_ProgressiveLargeContent(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(streamingShowMsg{header: "header\n", progressive: true})

	var b strings.Builder
	for i := 1; i <= 50; i++ {
		fmt.Fprintf(&b, "line %d\n", i)
	}
	content := b.String() + "partial"
	updated, cmd := shown.Update(streamingUpdateMsg{content: content})

	model := updated.(inlineBubbleModel)
	if model.streamingContent != "partial" {
		t.Errorf("expected partial line in View content, got %q", model.streamingContent)
	}
	if model.streamingCommittedLen != len(b.String()) {
		t.Errorf("expected committedLen=%d, got %d", len(b.String()), model.streamingCommittedLen)
	}
	if cmd == nil {
		t.Fatal("should return Println Cmd for committed lines")
	}
}

func TestInlineBubbleModel_View_StreamingPriorityOverFollowUp(t *testing.T) {
	m := newInlineBubbleModel()
	shown, _ := m.Update(followUpShowMsg{content: "follow-up prompt"})
	streamed, _ := shown.Update(streamingShowMsg{header: "streaming\n"})
	model := streamed.(inlineBubbleModel)

	v := model.View().Content
	if strings.Contains(v, "follow-up prompt") {
		t.Error("streaming should take priority over follow-up prompt in View()")
	}
	if !strings.Contains(v, "streaming") {
		t.Errorf("View() should show streaming content, got %q", v)
	}
}

// =============================================================================
// formatFollowUpPrompt Tests
// =============================================================================

func TestFormatFollowUpPrompt_ContainsAllElements(t *testing.T) {
	prompt := formatFollowUpPrompt()
	if !strings.Contains(prompt, "─") {
		t.Errorf("prompt should contain separator, got %q", prompt)
	}
	if !strings.Contains(prompt, "enter send") {
		t.Errorf("prompt should contain hint text, got %q", prompt)
	}
	if !strings.Contains(prompt, ">") {
		t.Errorf("prompt should contain prompt marker, got %q", prompt)
	}
	if !strings.HasPrefix(prompt, "\n") {
		t.Errorf("prompt should start with leading newline, got %q", prompt)
	}
	if !strings.HasSuffix(prompt, " ") {
		t.Errorf("prompt should end with trailing space for cursor, got %q", prompt)
	}
}

// =============================================================================
// formatStreamingView Tests
// =============================================================================

func TestFormatStreamingView_HeaderOnly(t *testing.T) {
	v := formatStreamingView("─── header ───\n", "", "")
	if v != "─── header ───\n" {
		t.Errorf("expected header only, got %q", v)
	}
}

func TestFormatStreamingView_ContentFlowsUnmodified(t *testing.T) {
	v := formatStreamingView("header\n", "line 1\nline 2\nline 3\n", "")
	if !strings.Contains(v, "header") {
		t.Errorf("expected header in output, got %q", v)
	}
	if !strings.Contains(v, "line 1\nline 2\nline 3\n") {
		t.Errorf("expected all content lines in output, got %q", v)
	}
}

func TestFormatStreamingView_SubAgentGutterWrapped(t *testing.T) {
	v := formatStreamingView("header\n", "content\n", "sa-1")
	if !strings.Contains(v, "│") {
		t.Errorf("sub-agent content should be gutter-wrapped, got %q", v)
	}
}

// =============================================================================
// Program Lifecycle Tests
// =============================================================================

func TestStartInlineProgram_NilForNonTTY(t *testing.T) {
	var buf bytes.Buffer
	p := startInlineProgram(&buf, nil, nil, nil)
	if p != nil {
		stopInlineProgram(p)
		t.Error("startInlineProgram should return nil for non-TTY writer")
	}
}

func TestStopInlineProgram_SafeWithNil(t *testing.T) {
	stopInlineProgram(nil)
}

// =============================================================================
// statusf Routing Tests
// =============================================================================

func TestStatusf_DirectWrite_WhenNoProgram(t *testing.T) {
	var stdout, stderr bytes.Buffer
	events := make(chan executiontui.Event, 10)

	go feedEvents(events,
		executiontui.SystemMessageEvent{Content: "direct write test"},
		executiontui.DoneEvent{Phase: "completed"},
	)

	renderInline(context.Background(), inlineRenderConfig{
		events:            events,
		approvalResponses: make(chan executiontui.ApprovalResponse, 1),
		prompter:          approval.NewInteractivePrompter(),
		data:              &stdout,
		status:            &stderr,
	})

	if !strings.Contains(stderr.String(), "direct write test") {
		t.Errorf("statusf without program should write directly to status, got: %q", stderr.String())
	}
}

// =============================================================================
// Println Integration Test (with real Program)
// =============================================================================

func TestStatusf_ProgramPrintln_WhenProgramPresent(t *testing.T) {
	var output bytes.Buffer

	p := tea.NewProgram(
		newInlineBubbleModel(),
		tea.WithOutput(&output),
		tea.WithInput(nil),
	)

	go func() { _, _ = p.Run() }()
	time.Sleep(50 * time.Millisecond)

	r := &inlineRenderer{
		cfg: inlineRenderConfig{
			status:  &output,
			program: p,
		},
		suppressedToolIDs: make(map[string]bool),
	}

	r.statusf("hello from println\n")
	r.statusf("second line\n")

	time.Sleep(100 * time.Millisecond)

	p.Quit()
	p.Wait()

	got := output.String()
	if !strings.Contains(got, "hello from println") {
		t.Errorf("program.Println output should contain 'hello from println', got: %q", got)
	}
	if !strings.Contains(got, "second line") {
		t.Errorf("program.Println output should contain 'second line', got: %q", got)
	}

	helloIdx := strings.Index(got, "hello from println")
	secondIdx := strings.Index(got, "second line")
	if helloIdx > secondIdx {
		t.Errorf("'hello from println' should appear before 'second line' in output: %q", got)
	}
}
