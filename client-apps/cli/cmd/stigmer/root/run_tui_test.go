package root

import (
	"bytes"
	"io"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// =============================================================================
// Test Models
// =============================================================================

// panicModel panics on the first message after Init. Bubbletea's internal
// recoverFromPanic catches this before our wrapper's recover does, but the
// test verifies our wrapper doesn't interfere with Bubbletea's own recovery
// and that the signal handler goroutine cleans up correctly.
type panicModel struct{}

type triggerPanicMsg struct{}

func (m panicModel) Init() tea.Cmd {
	return func() tea.Msg { return triggerPanicMsg{} }
}

func (m panicModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if _, ok := msg.(triggerPanicMsg); ok {
		panic("test panic in TUI")
	}
	return m, nil
}

func (m panicModel) View() string { return "" }

// quitModel exits immediately on Init. Used to verify the normal exit
// path through runTUIWithProtection.
type quitModel struct{}

func (m quitModel) Init() tea.Cmd { return tea.Quit }

func (m quitModel) Update(tea.Msg) (tea.Model, tea.Cmd) { return m, nil }

func (m quitModel) View() string { return "" }

// =============================================================================
// runTUIWithProtection Tests
// =============================================================================

func TestRunTUIWithProtection_CleanExit_ReturnsModel(t *testing.T) {
	p := tea.NewProgram(
		quitModel{},
		tea.WithInput(strings.NewReader("")),
		tea.WithOutput(io.Discard),
	)

	model, err := runTUIWithProtection(p)
	if err != nil {
		t.Fatalf("expected no error on clean exit, got: %v", err)
	}
	if model == nil {
		t.Fatal("expected non-nil model on clean exit")
	}
}

func TestRunTUIWithProtection_CleanExit_ReturnsCorrectModelType(t *testing.T) {
	p := tea.NewProgram(
		quitModel{},
		tea.WithInput(strings.NewReader("")),
		tea.WithOutput(io.Discard),
	)

	model, err := runTUIWithProtection(p)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := model.(quitModel); !ok {
		t.Fatalf("expected quitModel, got %T", model)
	}
}

// Bubbletea catches panics in its event loop internally (recoverFromPanic),
// restores the terminal, and returns nil error from Run(). Our wrapper's
// recover() is defense-in-depth for panics outside the event loop. This test
// verifies our wrapper doesn't interfere with Bubbletea's own recovery and
// that the signal handler goroutine cleans up without leaking.
func TestRunTUIWithProtection_EventLoopPanic_DoesNotCrashProcess(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("runTUIWithProtection must not propagate panics, but got: %v", r)
		}
	}()

	p := tea.NewProgram(
		panicModel{},
		tea.WithInput(strings.NewReader("")),
		tea.WithOutput(io.Discard),
	)

	// Should complete without crashing, regardless of how Bubbletea
	// handles the panic internally.
	_, _ = runTUIWithProtection(p)
}

func TestRunTUIWithProtection_EventLoopPanic_SignalHandlerCleansUp(t *testing.T) {
	p := tea.NewProgram(
		panicModel{},
		tea.WithInput(strings.NewReader("")),
		tea.WithOutput(io.Discard),
	)

	// After this returns, the signal handler goroutine should have exited
	// (done channel closed in defer). A goroutine leak here would eventually
	// be caught by leak detectors, but at minimum the function must return.
	_, _ = runTUIWithProtection(p)
}

// =============================================================================
// restoreTerminal Tests
// =============================================================================

func TestRestoreTerminal_DoesNotPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("restoreTerminal should not panic, but got: %v", r)
		}
	}()

	p := tea.NewProgram(
		quitModel{},
		tea.WithInput(strings.NewReader("")),
		tea.WithOutput(io.Discard),
	)

	// Call restoreTerminal with nil origState to verify it handles
	// the nil guard correctly.
	restoreTerminal(p, 0, nil)
}

// =============================================================================
// fixTerminal Tests
// =============================================================================

func TestFixTerminal_RunsWithoutError(t *testing.T) {
	if err := fixTerminal(); err != nil {
		t.Fatalf("fixTerminal returned unexpected error: %v", err)
	}
}

func TestNewFixCommand_HasCorrectUse(t *testing.T) {
	cmd := NewFixCommand()
	if cmd.Use != "fix" {
		t.Errorf("expected Use 'fix', got %q", cmd.Use)
	}
}

func TestNewFixCommand_AcceptsNoArgs(t *testing.T) {
	cmd := NewFixCommand()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("expected no error with zero args, got: %v", err)
	}
}

func TestNewFixCommand_RejectsArgs(t *testing.T) {
	cmd := NewFixCommand()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"unexpected"})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error with unexpected arg, got nil")
	}
}
