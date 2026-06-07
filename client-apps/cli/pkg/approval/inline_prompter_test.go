package approval

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

// =============================================================================
// Compile-time interface compliance
// =============================================================================

var _ Prompter = (*InlinePrompter)(nil)

// =============================================================================
// renderMenu — visual output
// =============================================================================

func TestRenderMenu_DefaultSelection(t *testing.T) {
	menu := RenderMenu(0, false)
	if !strings.Contains(menu, "▸ Approve") {
		t.Error("expected '▸ Approve' indicator for first selection")
	}
	if strings.Contains(menu, "▸ Skip") || strings.Contains(menu, "▸ Reject") {
		t.Error("only first item should have selection indicator")
	}
}

func TestRenderMenu_SecondSelection(t *testing.T) {
	menu := RenderMenu(1, false)
	if !strings.Contains(menu, "▸ Approve & don't ask again") {
		t.Error("expected '▸ Approve & don't ask again' indicator for second selection")
	}
	if strings.Contains(menu, "▸ Skip") {
		t.Error("only second item should have selection indicator")
	}
}

func TestRenderMenu_ThirdSelection(t *testing.T) {
	menu := RenderMenu(2, false)
	if !strings.Contains(menu, "▸ Skip") {
		t.Error("expected '▸ Skip' indicator for third selection")
	}
}

func TestRenderMenu_FourthSelection(t *testing.T) {
	menu := RenderMenu(3, false)
	if !strings.Contains(menu, "▸ Reject") {
		t.Error("expected '▸ Reject' indicator for fourth selection")
	}
}

func TestRenderMenu_ContainsHint(t *testing.T) {
	menu := RenderMenu(0, false)
	for _, fragment := range []string{"select", "esc/ctrl+c exit"} {
		if !strings.Contains(menu, fragment) {
			t.Errorf("expected hint to contain %q", fragment)
		}
	}
}

func TestRenderMenu_ContainsAllLabels(t *testing.T) {
	menu := RenderMenu(0, false)
	for _, label := range []string{"Approve", "Approve & don't ask again", "Skip", "Reject"} {
		if !strings.Contains(menu, label) {
			t.Errorf("menu missing label %q", label)
		}
	}
}

func TestRenderMenu_LineCount(t *testing.T) {
	menu := RenderMenu(0, false)
	lines := strings.Split(menu, "\r\n")
	// 4 choice lines end with \r\n; the hint line has no trailing \r\n,
	// so Split produces 5 segments (4 choices + remainder with hint).
	if len(lines) != menuLines {
		t.Errorf("renderMenu produced %d segments, want %d", len(lines), menuLines)
	}
}

// =============================================================================
// keyReader — single byte decoding
// =============================================================================

func TestDecodeSingleByte(t *testing.T) {
	tests := []struct {
		b    byte
		want keyCode
	}{
		{'\r', keyEnter},
		{'\n', keyEnter},
		{3, keyCtrlC},
		{'1', keyOne},
		{'2', keyTwo},
		{'3', keyThree},
		{'4', keyFour},
		{'a', keyUnknown},
		{'q', keyUnknown},
		{0, keyUnknown},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("byte_%d", tt.b), func(t *testing.T) {
			got := decodeSingleByte(tt.b)
			if got != tt.want {
				t.Errorf("decodeSingleByte(%d) = %d, want %d", tt.b, got, tt.want)
			}
		})
	}
}

// =============================================================================
// keyReader — readKey with escape sequences
// =============================================================================

func newTestKeyReader(data []byte) *keyReader {
	return newKeyReader(bytes.NewReader(data))
}

func TestReadKey_ArrowUp(t *testing.T) {
	kr := newTestKeyReader([]byte("\033[A"))
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyUp {
		t.Errorf("got %d, want keyUp", key)
	}
}

func TestReadKey_ArrowDown(t *testing.T) {
	kr := newTestKeyReader([]byte("\033[B"))
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyDown {
		t.Errorf("got %d, want keyDown", key)
	}
}

func TestReadKey_Enter(t *testing.T) {
	kr := newTestKeyReader([]byte{'\r'})
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyEnter {
		t.Errorf("got %d, want keyEnter", key)
	}
}

func TestReadKey_CtrlC(t *testing.T) {
	kr := newTestKeyReader([]byte{3})
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyCtrlC {
		t.Errorf("got %d, want keyCtrlC", key)
	}
}

func TestReadKey_NumberKeys(t *testing.T) {
	for _, tt := range []struct {
		b    byte
		want keyCode
	}{
		{'1', keyOne},
		{'2', keyTwo},
		{'3', keyThree},
		{'4', keyFour},
	} {
		t.Run(fmt.Sprintf("key_%c", tt.b), func(t *testing.T) {
			kr := newTestKeyReader([]byte{tt.b})
			key, err := kr.readKey(context.Background())
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if key != tt.want {
				t.Errorf("got %d, want %d", key, tt.want)
			}
		})
	}
}

func TestReadKey_StandaloneEsc(t *testing.T) {
	// \033 followed by EOF — the escape sequence timeout fires and
	// returns keyEsc because no '[' follows within 50ms.
	kr := newTestKeyReader([]byte{'\033'})
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyEsc {
		t.Errorf("got %d, want keyEsc", key)
	}
}

func TestReadKey_EscFollowedByNonBracket(t *testing.T) {
	kr := newTestKeyReader([]byte{'\033', 'x'})
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyEsc {
		t.Errorf("got %d, want keyEsc (non-CSI escape)", key)
	}
}

func TestReadKey_UnknownCSISequence(t *testing.T) {
	// \033[C is Right arrow — not handled, should return keyUnknown
	kr := newTestKeyReader([]byte("\033[C"))
	key, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != keyUnknown {
		t.Errorf("got %d, want keyUnknown for right arrow", key)
	}
}

func TestReadKey_MultipleKeys(t *testing.T) {
	// Read two sequential keys from the same reader.
	kr := newTestKeyReader([]byte{'1', '2'})
	k1, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("first readKey: %v", err)
	}
	if k1 != keyOne {
		t.Errorf("first key = %d, want keyOne", k1)
	}
	k2, err := kr.readKey(context.Background())
	if err != nil {
		t.Fatalf("second readKey: %v", err)
	}
	if k2 != keyTwo {
		t.Errorf("second key = %d, want keyTwo", k2)
	}
}

func TestReadKey_ContextCancelled(t *testing.T) {
	// Use a pipe so the reader blocks (no data available).
	r, w := io.Pipe()
	defer w.Close()

	kr := newKeyReader(r)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := kr.readKey(ctx)
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

// =============================================================================
// keyReader — drain
// =============================================================================

func TestDrain_ClearsBufferedBytes(t *testing.T) {
	kr := newTestKeyReader([]byte("abc123"))
	// Allow the reader goroutine to buffer all bytes.
	time.Sleep(20 * time.Millisecond)

	kr.drain()

	// After drain, the channel should be empty. The reader goroutine has
	// already hit EOF, so readByte should return an error (io.EOF) rather
	// than a byte.
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := kr.readByte(ctx)
	if err == nil {
		t.Error("expected error after drain (EOF or timeout), got nil")
	}
}

func TestDrain_EmptyChannel(t *testing.T) {
	// Drain on a fresh reader with no data should not block.
	r, w := io.Pipe()
	defer w.Close()

	kr := newKeyReader(r)
	// Should return immediately without hanging.
	done := make(chan struct{})
	go func() {
		kr.drain()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("drain blocked on empty channel")
	}
}

// =============================================================================
// InlinePrompter — non-interactive paths
// =============================================================================

func TestPromptWithLineCount_NonInteractive_Approve(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	decision, lines, err := p.PromptWithLineCount(context.Background(), Options{
		NonInteractive: true,
		DefaultAction:  ActionApprove,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionApprove {
		t.Errorf("action = %v, want ActionApprove", decision.Action)
	}
	if lines != 0 {
		t.Errorf("lineCount = %d, want 0 for non-interactive", lines)
	}
}

func TestPromptWithLineCount_NonInteractive_NoDefault(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	_, _, err := p.PromptWithLineCount(context.Background(), Options{
		NonInteractive: true,
	})
	if err != ErrNonInteractiveNoDefault {
		t.Errorf("expected ErrNonInteractiveNoDefault, got %v", err)
	}
}

func TestPromptWithLineCount_NonTTY_WithDefault(t *testing.T) {
	// bytes.Buffer is not a terminal — falls back to non-interactive.
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	decision, lines, err := p.PromptWithLineCount(context.Background(), Options{
		DefaultAction: ActionSkip,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionSkip {
		t.Errorf("action = %v, want ActionSkip", decision.Action)
	}
	if lines != 0 {
		t.Errorf("lineCount = %d, want 0 for non-TTY", lines)
	}
}

func TestPromptWithLineCount_NonTTY_NoDefault(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	_, _, err := p.PromptWithLineCount(context.Background(), Options{})
	if err != ErrNonInteractiveNoDefault {
		t.Errorf("expected ErrNonInteractiveNoDefault, got %v", err)
	}
}

// =============================================================================
// InlinePrompter — Prompt interface delegation
// =============================================================================

func TestPrompt_DelegatesToPromptWithLineCount(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	decision, err := p.Prompt(context.Background(), Options{
		NonInteractive: true,
		DefaultAction:  ActionReject,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionReject {
		t.Errorf("action = %v, want ActionReject", decision.Action)
	}
}

// =============================================================================
// InlinePrompter — constructor
// =============================================================================

func TestNewInlinePrompter_BufferInput(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	if p.fd != -1 {
		t.Errorf("fd = %d, want -1 for non-terminal input", p.fd)
	}
}

func TestNewInlinePrompter_NilKeyReader(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	if p.kr != nil {
		t.Error("keyReader should be nil before first prompt")
	}
}

// =============================================================================
// PromptKeyOnly — non-interactive / non-TTY paths
// =============================================================================

func TestPromptKeyOnly_NonInteractive_Approve(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	called := false
	decision, err := p.PromptKeyOnly(context.Background(), Options{
		NonInteractive: true,
		DefaultAction:  ActionApprove,
	}, func(int) { called = true })
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionApprove {
		t.Errorf("action = %v, want ActionApprove", decision.Action)
	}
	if called {
		t.Error("onSelect should not be called for non-interactive")
	}
}

func TestPromptKeyOnly_NonInteractive_NoDefault(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	_, err := p.PromptKeyOnly(context.Background(), Options{
		NonInteractive: true,
	}, func(int) {})
	if err != ErrNonInteractiveNoDefault {
		t.Errorf("expected ErrNonInteractiveNoDefault, got %v", err)
	}
}

func TestPromptKeyOnly_NonTTY_WithDefault(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	decision, err := p.PromptKeyOnly(context.Background(), Options{
		DefaultAction: ActionSkip,
	}, func(int) {})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision.Action != ActionSkip {
		t.Errorf("action = %v, want ActionSkip", decision.Action)
	}
}

func TestPromptKeyOnly_NonTTY_NoDefault(t *testing.T) {
	p := NewInlinePrompter(&bytes.Buffer{}, &bytes.Buffer{})
	_, err := p.PromptKeyOnly(context.Background(), Options{}, func(int) {})
	if err != ErrNonInteractiveNoDefault {
		t.Errorf("expected ErrNonInteractiveNoDefault, got %v", err)
	}
}

// =============================================================================
// RenderMenu (exported)
// =============================================================================

func TestRenderMenu_Exported_MatchesMenuLines(t *testing.T) {
	menu := RenderMenu(0, false)
	lines := strings.Split(menu, "\r\n")
	if len(lines) != menuLines {
		t.Errorf("RenderMenu produced %d segments, want %d", len(lines), menuLines)
	}
}

// =============================================================================
// RenderMenu forView=true (Bubbletea View() path)
// =============================================================================

func TestRenderMenuForView_UsesNewlineNotCRLF(t *testing.T) {
	menu := RenderMenu(0, true)
	if strings.Contains(menu, "\r\n") {
		t.Error("RenderMenu(forView=true) should use \\n, not \\r\\n")
	}
	if !strings.Contains(menu, "\n") {
		t.Error("RenderMenu(forView=true) should contain newlines")
	}
}

func TestRenderMenuForView_ContainsAllChoices(t *testing.T) {
	menu := RenderMenu(0, true)
	if !strings.Contains(menu, "Approve") {
		t.Error("expected Approve choice")
	}
	if !strings.Contains(menu, "Skip") {
		t.Error("expected Skip choice")
	}
	if !strings.Contains(menu, "Reject") {
		t.Error("expected Reject choice")
	}
}

func TestRenderMenuForView_ContainsHint(t *testing.T) {
	menu := RenderMenu(0, true)
	if !strings.Contains(menu, "select") {
		t.Errorf("expected hint text, got %q", menu)
	}
}

func TestRenderMenuForView_SelectedMarker(t *testing.T) {
	menu := RenderMenu(1, true)
	if !strings.Contains(menu, "▸ Approve & don't ask again") {
		t.Errorf("expected selection marker on Approve & don't ask again, got %q", menu)
	}
}

func TestRenderMenuForView_LineCount(t *testing.T) {
	menu := RenderMenu(0, true)
	lines := strings.Split(menu, "\n")
	if len(lines) != menuLines {
		t.Errorf("RenderMenu(forView=true) produced %d segments on \\n split, want %d", len(lines), menuLines)
	}
}

// =============================================================================
// menuLines constant
// =============================================================================

func TestMenuLinesConstant(t *testing.T) {
	if menuLines != 5 {
		t.Errorf("menuLines = %d, want 5", menuLines)
	}
}

// =============================================================================
// inlineChoices
// =============================================================================

func TestInlineChoices_Order(t *testing.T) {
	if len(inlineChoices) != 4 {
		t.Fatalf("expected 4 choices, got %d", len(inlineChoices))
	}
	expected := []struct {
		action Action
		label  string
	}{
		{ActionApprove, "Approve"},
		{ActionApproveAll, "Approve & don't ask again"},
		{ActionSkip, "Skip"},
		{ActionReject, "Reject"},
	}
	for i, want := range expected {
		got := inlineChoices[i]
		if got.action != want.action || got.label != want.label {
			t.Errorf("choice[%d] = {%v, %q}, want {%v, %q}",
				i, got.action, got.label, want.action, want.label)
		}
	}
}
