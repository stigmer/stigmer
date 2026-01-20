package cliprint

import (
	"fmt"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/lipgloss"
)

// ProgressPhase represents a stage in a multi-step operation
type ProgressPhase string

const (
	PhaseDiscovering  ProgressPhase = "discovering"
	PhaseValidating   ProgressPhase = "validating"
	PhaseConnecting   ProgressPhase = "connecting"
	PhaseDeploying    ProgressPhase = "deploying"
	PhaseExecuting    ProgressPhase = "executing"
	PhaseInitializing ProgressPhase = "initializing"
	PhaseInstalling   ProgressPhase = "installing"
	PhaseDeleting     ProgressPhase = "deleting"
	PhaseCompleted    ProgressPhase = "completed"
	PhaseStarting     ProgressPhase = "starting"
)

// PhaseStatus represents the completion status of a phase
type PhaseStatus int

const (
	StatusPending PhaseStatus = iota
	StatusActive
	StatusComplete
)

// ProgressState holds the current state of all phases
type ProgressState struct {
	mu     sync.RWMutex
	phases map[ProgressPhase]PhaseStatus
	active ProgressPhase
	detail string // Additional detail for active phase
}

// NewProgressState creates a new progress state
func NewProgressState() *ProgressState {
	return &ProgressState{
		phases: make(map[ProgressPhase]PhaseStatus),
	}
}

// SetPhase updates the current phase
func (p *ProgressState) SetPhase(phase ProgressPhase, detail string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	
	// Mark previous phase as complete
	if p.active != "" && p.active != phase {
		p.phases[p.active] = StatusComplete
	}
	
	p.active = phase
	p.phases[phase] = StatusActive
	p.detail = detail
}

// CompletePhase marks a phase as complete
func (p *ProgressState) CompletePhase(phase ProgressPhase) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.phases[phase] = StatusComplete
}

// GetSnapshot returns a read-only snapshot of current state
func (p *ProgressState) GetSnapshot() (ProgressPhase, string, map[ProgressPhase]PhaseStatus) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	
	// Copy the phases map
	phasesCopy := make(map[ProgressPhase]PhaseStatus)
	for k, v := range p.phases {
		phasesCopy[k] = v
	}
	
	return p.active, p.detail, phasesCopy
}

// ProgressModel is the bubbletea model for rendering progress
type ProgressModel struct {
	state   *ProgressState
	spinner spinner.Model
	done    bool
}

// NewProgressModel creates a new progress model
func NewProgressModel(state *ProgressState) ProgressModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("12")) // Blue
	
	return ProgressModel{
		state:   state,
		spinner: s,
		done:    false,
	}
}

// Init initializes the model
func (m ProgressModel) Init() tea.Cmd {
	return m.spinner.Tick
}

// Update handles messages
func (m ProgressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.done = true
			return m, tea.Quit
		}
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case string:
		if msg == "done" {
			m.done = true
			return m, tea.Quit
		}
	}
	return m, nil
}

// View renders the current state
func (m ProgressModel) View() string {
	if m.done {
		return ""
	}
	
	_, detail, phases := m.state.GetSnapshot()
	
	var lines []string
	
	// Define phase display order and labels
	phaseOrder := []struct {
		phase ProgressPhase
		label string
	}{
		{PhaseDiscovering, "Discovering resources"},
		{PhaseValidating, "Validating configuration"},
		{PhaseConnecting, "Connecting to backend"},
		{PhaseDeploying, "Deploying"},
		{PhaseExecuting, "Starting execution"},
		{PhaseInitializing, "Initializing"},
		{PhaseInstalling, "Installing dependencies"},
		{PhaseDeleting, "Deleting resources"},
		{PhaseStarting, "Starting services"},
	}
	
	for _, p := range phaseOrder {
		status, exists := phases[p.phase]
		if !exists {
			continue // Skip phases that haven't started
		}
		
		var line string
		switch status {
		case StatusComplete:
			line = fmt.Sprintf("   %s %s: done",
				lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render("✓"),
				lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(p.label))
		case StatusActive:
			detailStr := ""
			if detail != "" {
				detailStr = fmt.Sprintf(": %s", detail)
			}
			line = fmt.Sprintf("   %s %s%s",
				m.spinner.View(),
				lipgloss.NewStyle().Foreground(lipgloss.Color("12")).Render(p.label),
				lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(detailStr))
		}
		
		if line != "" {
			lines = append(lines, line)
		}
	}
	
	if len(lines) == 0 {
		return ""
	}
	
	return "\n" + strings.Join(lines, "\n") + "\n"
}

// ProgressDisplay manages the progress UI lifecycle
type ProgressDisplay struct {
	state   *ProgressState
	program *tea.Program
	done    chan struct{}
}

// NewProgressDisplay creates a new progress display
func NewProgressDisplay() *ProgressDisplay {
	state := NewProgressState()
	model := NewProgressModel(state)
	
	program := tea.NewProgram(model)
	
	return &ProgressDisplay{
		state:   state,
		program: program,
		done:    make(chan struct{}),
	}
}

// Start begins the progress display
func (d *ProgressDisplay) Start() {
	go func() {
		if _, err := d.program.Run(); err != nil {
			// Silently ignore errors - progress is optional
		}
		close(d.done)
	}()
	
	// Give it a moment to render
	time.Sleep(50 * time.Millisecond)
}

// SetPhase updates the current phase
func (d *ProgressDisplay) SetPhase(phase ProgressPhase, detail string) {
	d.state.SetPhase(phase, detail)
}

// CompletePhase marks a phase as complete
func (d *ProgressDisplay) CompletePhase(phase ProgressPhase) {
	d.state.CompletePhase(phase)
}

// Stop stops the progress display
func (d *ProgressDisplay) Stop() {
	d.program.Send("done")
	<-d.done
}

// RunWithProgress executes a function with progress tracking
func RunWithProgress(phases []struct {
	Phase  ProgressPhase
	Label  string
	Action func() error
}) error {
	display := NewProgressDisplay()
	display.Start()
	defer display.Stop()
	
	for _, p := range phases {
		display.SetPhase(p.Phase, "")
		if err := p.Action(); err != nil {
			return err
		}
		display.CompletePhase(p.Phase)
	}
	
	return nil
}
