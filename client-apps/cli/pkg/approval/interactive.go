package approval

import (
	"context"
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// InteractivePrompter implements Prompter using Bubbletea for TTY sessions.
type InteractivePrompter struct {
	// askCommentOnReject controls whether to prompt for a rejection reason.
	askCommentOnReject bool
}

// NewInteractivePrompter creates a prompter for interactive TTY sessions.
// By default, it asks for a rejection reason when the user selects Reject.
func NewInteractivePrompter() *InteractivePrompter {
	return &InteractivePrompter{askCommentOnReject: true}
}

// Prompt implements the Prompter interface.
// It shows an interactive selection prompt if a TTY is available,
// otherwise falls back to non-interactive behavior.
func (p *InteractivePrompter) Prompt(ctx context.Context, opts Options) (*Decision, error) {
	// Handle explicit non-interactive mode
	if opts.NonInteractive {
		return p.handleNonInteractive(opts)
	}

	// Check for TTY - fallback to non-interactive if no TTY available
	if !display.IsTerminal() {
		return p.handleNonInteractive(opts)
	}

	return p.showInteractivePrompt(ctx, opts)
}

// handleNonInteractive returns the default action without prompting.
func (p *InteractivePrompter) handleNonInteractive(opts Options) (*Decision, error) {
	if opts.DefaultAction == ActionUnspecified {
		return nil, ErrNonInteractiveNoDefault
	}
	return &Decision{Action: opts.DefaultAction}, nil
}

// showInteractivePrompt runs a Bubbletea program to collect the user's
// approval decision. The program runs inline (no alternate screen) so
// it integrates naturally with the streaming output above it.
func (p *InteractivePrompter) showInteractivePrompt(_ context.Context, _ Options) (*Decision, error) {
	model := newPromptModel(p.askCommentOnReject)

	program := tea.NewProgram(model)
	finalModel, err := program.Run()
	if err != nil {
		return nil, fmt.Errorf("approval prompt failed: %w", err)
	}

	result, ok := finalModel.(promptModel)
	if !ok {
		return nil, fmt.Errorf("unexpected model type from approval prompt")
	}

	if result.sessionExit {
		return nil, ErrSessionExit
	}

	return result.decision, nil
}
