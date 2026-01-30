package approval

import (
	"context"
	"errors"
)

// Prompter abstracts the approval prompt mechanism.
// Implementations may be interactive (TTY), non-interactive (CI), or mocks (tests).
type Prompter interface {
	// Prompt displays approval options and returns the user's decision.
	//
	// Behavior:
	//   - Interactive mode: Shows selection UI, waits for user input
	//   - Non-interactive mode: Returns DefaultAction immediately
	//   - No TTY available: Falls back to non-interactive behavior
	//
	// Returns error if:
	//   - User cancels the prompt (Ctrl+C) - returns ErrPromptCancelled
	//   - Non-interactive mode without DefaultAction - returns ErrNonInteractiveNoDefault
	//   - Context is cancelled
	Prompt(ctx context.Context, opts Options) (*Decision, error)
}

// ErrPromptCancelled indicates the user cancelled the prompt (e.g., Ctrl+C).
var ErrPromptCancelled = errors.New("prompt cancelled by user")

// ErrNonInteractiveNoDefault indicates non-interactive mode was requested
// but no DefaultAction was specified in Options.
var ErrNonInteractiveNoDefault = errors.New("non-interactive mode requires default action")
