package root

import (
	"bytes"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

// trivialModel is a minimal Bubbletea model for testing. It exits
// immediately on any message and renders nothing.
type trivialModel struct{}

func (trivialModel) Init() tea.Cmd                       { return tea.Quit }
func (trivialModel) Update(tea.Msg) (tea.Model, tea.Cmd) { return trivialModel{}, tea.Quit }
func (trivialModel) View() tea.View                      { return tea.NewView("") }

func TestManagedProgram_AliveAfterStart(t *testing.T) {
	var buf bytes.Buffer
	p := tea.NewProgram(trivialModel{}, tea.WithOutput(&buf), tea.WithInput(nil))
	mp := newManagedProgram(p, &buf)
	mp.runAndMonitor()

	// Give the program time to start and exit (trivialModel quits immediately).
	time.Sleep(100 * time.Millisecond)

	// After the trivial model exits, the program should be marked dead.
	if mp.IsAlive() {
		t.Error("expected managed program to be dead after trivial model exits")
	}
}

func TestManagedProgram_PrintlnFallback(t *testing.T) {
	var fallback bytes.Buffer
	p := tea.NewProgram(trivialModel{}, tea.WithOutput(&bytes.Buffer{}), tea.WithInput(nil))
	mp := newManagedProgram(p, &fallback)
	mp.runAndMonitor()

	// Wait for the program to exit.
	time.Sleep(100 * time.Millisecond)

	mp.Println("hello from fallback")

	got := fallback.String()
	if !strings.Contains(got, "hello from fallback") {
		t.Errorf("expected fallback output to contain 'hello from fallback', got: %q", got)
	}
}

func TestManagedProgram_SendNoOpWhenDead(t *testing.T) {
	var buf bytes.Buffer
	p := tea.NewProgram(trivialModel{}, tea.WithOutput(&buf), tea.WithInput(nil))
	mp := newManagedProgram(p, &buf)
	mp.runAndMonitor()

	time.Sleep(100 * time.Millisecond)

	// Should not panic when sending to a dead program.
	mp.Send(tea.QuitMsg{})
}

func TestManagedProgram_QuitNoOpWhenDead(t *testing.T) {
	var buf bytes.Buffer
	p := tea.NewProgram(trivialModel{}, tea.WithOutput(&buf), tea.WithInput(nil))
	mp := newManagedProgram(p, &buf)
	mp.runAndMonitor()

	time.Sleep(100 * time.Millisecond)

	// Should not panic when quitting a dead program.
	mp.Quit()
}

func TestManagedProgram_WaitReturnsImmediatelyWhenDead(t *testing.T) {
	var buf bytes.Buffer
	p := tea.NewProgram(trivialModel{}, tea.WithOutput(&buf), tea.WithInput(nil))
	mp := newManagedProgram(p, &buf)
	mp.runAndMonitor()

	time.Sleep(100 * time.Millisecond)

	start := time.Now()
	mp.Wait(5 * time.Second)
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Errorf("Wait should return immediately when dead, took %v", elapsed)
	}
}

func TestManagedProgram_WaitWithTimeout(t *testing.T) {
	var buf bytes.Buffer
	p := tea.NewProgram(trivialModel{}, tea.WithOutput(&buf), tea.WithInput(nil))
	mp := newManagedProgram(p, &buf)
	mp.runAndMonitor()

	// Quit and wait — should complete quickly since trivialModel exits fast.
	mp.Quit()
	start := time.Now()
	mp.Wait(2 * time.Second)
	elapsed := time.Since(start)

	if elapsed > 1*time.Second {
		t.Errorf("Wait took too long: %v (expected fast completion)", elapsed)
	}
}
