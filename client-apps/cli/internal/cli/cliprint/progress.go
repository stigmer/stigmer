package cliprint

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ProgressPhase represents a stage in a multi-step operation
type ProgressPhase string

const (
	phaseDiscovering  ProgressPhase = "discovering"
	phaseValidating   ProgressPhase = "validating"
	phaseConnecting   ProgressPhase = "connecting"
	PhaseDeploying    ProgressPhase = "deploying"
	phaseExecuting    ProgressPhase = "executing"
	PhaseInitializing ProgressPhase = "initializing"
	PhaseInstalling   ProgressPhase = "installing"
	phaseDeleting     ProgressPhase = "deleting"
	phaseCompleted    ProgressPhase = "completed"
	PhaseStarting     ProgressPhase = "starting"
)

type phaseStatus int

const (
	statusPending phaseStatus = iota
	statusActive
	statusComplete
)

// ProgressState holds the current state of all phases
type ProgressState struct {
	mu     sync.RWMutex
	phases map[ProgressPhase]phaseStatus
	active ProgressPhase
	detail string
}

// NewProgressState creates a new progress state
func NewProgressState() *ProgressState {
	return &ProgressState{
		phases: make(map[ProgressPhase]phaseStatus),
	}
}

// SetPhase updates the current phase
func (p *ProgressState) SetPhase(phase ProgressPhase, detail string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.active != "" && p.active != phase {
		p.phases[p.active] = statusComplete
	}

	p.active = phase
	p.phases[phase] = statusActive
	p.detail = detail
}

// CompletePhase marks a phase as complete
func (p *ProgressState) CompletePhase(phase ProgressPhase) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.phases[phase] = statusComplete
}

func (p *ProgressState) getSnapshot() (ProgressPhase, string, map[ProgressPhase]phaseStatus) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	phasesCopy := make(map[ProgressPhase]phaseStatus)
	for k, v := range p.phases {
		phasesCopy[k] = v
	}

	return p.active, p.detail, phasesCopy
}

type progressModel struct {
	state   *ProgressState
	spinner spinner.Model
	done    bool
}

func newProgressModel(state *ProgressState) progressModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("12"))

	return progressModel{
		state:   state,
		spinner: s,
		done:    false,
	}
}

func (m progressModel) Init() tea.Cmd {
	return m.spinner.Tick
}

func (m progressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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

func (m progressModel) View() string {
	_, detail, phases := m.state.getSnapshot()

	if m.done {
		return m.renderFinalState(phases)
	}

	var lines []string

	phaseOrder := []struct {
		phase ProgressPhase
		label string
	}{
		{phaseDiscovering, "Discovering resources"},
		{phaseValidating, "Validating configuration"},
		{phaseConnecting, "Connecting to backend"},
		{PhaseDeploying, "Deploying"},
		{phaseExecuting, "Starting execution"},
		{PhaseInitializing, "Initializing"},
		{PhaseInstalling, "Installing dependencies"},
		{phaseDeleting, "Deleting resources"},
		{PhaseStarting, "Starting services"},
	}

	for _, p := range phaseOrder {
		status, exists := phases[p.phase]
		if !exists {
			continue
		}

		var line string
		switch status {
		case statusComplete:
			line = fmt.Sprintf("   %s %s: done",
				lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render("✓"),
				lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(p.label))
		case statusActive:
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

func (m progressModel) renderFinalState(phases map[ProgressPhase]phaseStatus) string {
	var lines []string

	phaseOrder := []struct {
		phase ProgressPhase
		label string
	}{
		{phaseDiscovering, "Discovering resources"},
		{phaseValidating, "Validating configuration"},
		{phaseConnecting, "Connecting to backend"},
		{PhaseDeploying, "Deploying"},
		{phaseExecuting, "Starting execution"},
		{PhaseInitializing, "Initializing"},
		{PhaseInstalling, "Installing dependencies"},
		{phaseDeleting, "Deleting resources"},
		{PhaseStarting, "Starting services"},
	}

	for _, p := range phaseOrder {
		status, exists := phases[p.phase]
		if !exists {
			continue
		}

		var line string
		if status == statusComplete || status == statusActive {
			line = fmt.Sprintf("   %s %s: done",
				lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Render("✓"),
				lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(p.label))
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
	model := newProgressModel(state)

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
