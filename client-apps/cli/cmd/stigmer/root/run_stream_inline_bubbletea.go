package root

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
)

// ---------------------------------------------------------------------------
// Messages — sent from the event loop to the Bubbletea program via Send()
// ---------------------------------------------------------------------------

// spinnerStartMsg tells the model to activate the spinner with the given label.
// The event loop sends this when the 2-second idle timer fires.
type spinnerStartMsg struct{ label string }

// spinnerStopMsg tells the model to deactivate the spinner. The event loop
// sends this before processing any incoming event.
type spinnerStopMsg struct{}

// spinnerTickMsg is the self-propagating tick that advances the spinner frame.
// Each tick returns the next tick as a Cmd, forming a chain that runs until
// the spinner is stopped.
type spinnerTickMsg struct{}

// approvalShowMsg tells the model to render the approval panel in View().
// The event loop sends this after erasing any pre-approval streaming content
// (which restores cursor sync with Bubbletea). The content field contains the
// pre-rendered expanded view + question; the menu is rendered by View() using
// the selected index.
type approvalShowMsg struct {
	content string
}

// approvalSelectMsg updates the menu selection index. The event loop sends
// this from the key reading loop when the user presses an arrow key.
type approvalSelectMsg struct {
	selected int
}

// approvalHideMsg tells the model to deactivate the approval panel. View()
// returns "" on the next render, causing Bubbletea to erase the panel.
// When collapsedResult is non-empty, Update returns a tea.Println Cmd to
// commit the collapsed one-liner above the (now empty) View region.
type approvalHideMsg struct {
	collapsedResult string
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// inlineBubbleModel is the Bubbletea model for the inline renderer. The
// tea.Program running this model owns the stderr writer via tea.WithOutput,
// giving Bubbletea accurate row tracking for all content committed through
// Program.Println.
//
// Rendering priority in View(): approval > spinner > empty.
// When the approval panel is active, the spinner is implicitly hidden
// (the event loop stops the spinner before entering the approval flow).
type inlineBubbleModel struct {
	spinnerActive bool
	spinnerFrame  int
	spinnerLabel  string
	spinnerStart  time.Time

	approvalActive   bool
	approvalContent  string // pre-rendered expanded view + question
	approvalSelected int
}

func newInlineBubbleModel() inlineBubbleModel {
	return inlineBubbleModel{}
}

func (m inlineBubbleModel) Init() tea.Cmd {
	return nil
}

func (m inlineBubbleModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case spinnerStartMsg:
		return m.handleSpinnerStart(msg)
	case spinnerStopMsg:
		return m.handleSpinnerStop()
	case spinnerTickMsg:
		return m.handleSpinnerTick()
	case approvalShowMsg:
		return m.handleApprovalShow(msg)
	case approvalSelectMsg:
		return m.handleApprovalSelect(msg)
	case approvalHideMsg:
		return m.handleApprovalHide(msg)
	}
	return m, nil
}

func (m inlineBubbleModel) View() string {
	if m.approvalActive {
		return m.approvalContent + approval.RenderMenu(m.approvalSelected)
	}
	if !m.spinnerActive {
		return ""
	}
	frame := spinner.Frames[m.spinnerFrame%len(spinner.Frames)]
	elapsed := spinner.FormatElapsed(time.Since(m.spinnerStart))
	if elapsed != "" {
		return fmt.Sprintf("%s %s %s", frame, m.spinnerLabel, elapsed)
	}
	return fmt.Sprintf("%s %s", frame, m.spinnerLabel)
}

// ---------------------------------------------------------------------------
// Spinner update handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleSpinnerStart(msg spinnerStartMsg) (tea.Model, tea.Cmd) {
	m.spinnerActive = true
	m.spinnerFrame = 0
	m.spinnerLabel = msg.label
	m.spinnerStart = time.Now()
	return m, nextSpinnerTick()
}

func (m inlineBubbleModel) handleSpinnerStop() (tea.Model, tea.Cmd) {
	m.spinnerActive = false
	m.spinnerFrame = 0
	return m, nil
}

func (m inlineBubbleModel) handleSpinnerTick() (tea.Model, tea.Cmd) {
	if !m.spinnerActive {
		return m, nil
	}
	m.spinnerFrame++
	return m, nextSpinnerTick()
}

// nextSpinnerTick returns a Cmd that produces a spinnerTickMsg after one
// frame interval, continuing the tick chain.
func nextSpinnerTick() tea.Cmd {
	return tea.Tick(spinner.FrameInterval, func(time.Time) tea.Msg {
		return spinnerTickMsg{}
	})
}

// ---------------------------------------------------------------------------
// Approval update handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleApprovalShow(msg approvalShowMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = true
	m.approvalContent = msg.content
	m.approvalSelected = 0
	return m, nil
}

func (m inlineBubbleModel) handleApprovalSelect(msg approvalSelectMsg) (tea.Model, tea.Cmd) {
	m.approvalSelected = msg.selected
	return m, nil
}

func (m inlineBubbleModel) handleApprovalHide(msg approvalHideMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = false
	m.approvalContent = ""
	m.approvalSelected = 0
	if msg.collapsedResult != "" {
		return m, tea.Println(strings.TrimRight(msg.collapsedResult, "\n"))
	}
	return m, nil
}
