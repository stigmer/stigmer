package picker

import (
	"errors"
	"fmt"
	"os"

	tea "charm.land/bubbletea/v2"
	"golang.org/x/term"
)

// ErrNonInteractive is returned when Pick is called in a non-TTY environment.
var ErrNonInteractive = errors.New("interactive picker requires a terminal (TTY)")

// ErrCancelled is returned when the user presses Esc or Ctrl+C.
var ErrCancelled = errors.New("selection cancelled")

// Config controls the picker behavior. Callers must provide Prompt and
// SearchFn; InitQuery is optional.
type Config struct {
	// Prompt is the question shown to the user (e.g. "Select an agent").
	Prompt string

	// SearchFn is called with the current query text and must return matching
	// items. It is called asynchronously from a background goroutine.
	// An empty query should return a default/full list.
	SearchFn func(query string) ([]Item, error)

	// InitQuery pre-fills the search input. Leave empty for browse mode.
	InitQuery string
}

// Pick runs the interactive picker and returns the user's selection.
// It returns ErrNonInteractive if stderr is not a TTY, and ErrCancelled
// if the user aborts with Esc or Ctrl+C.
func Pick(cfg Config) (*Item, error) {
	if !term.IsTerminal(int(os.Stderr.Fd())) {
		return nil, ErrNonInteractive
	}

	m := newModel(cfg)
	p := tea.NewProgram(m, tea.WithOutput(os.Stderr))

	finalModel, err := p.Run()
	if err != nil {
		return nil, fmt.Errorf("picker failed: %w", err)
	}

	result, ok := finalModel.(model)
	if !ok {
		return nil, fmt.Errorf("unexpected model type from picker")
	}

	if result.quit {
		return nil, ErrCancelled
	}

	if result.selected == nil {
		return nil, ErrCancelled
	}

	return result.selected, nil
}
