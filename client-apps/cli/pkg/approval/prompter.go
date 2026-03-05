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
	//   - User exits the session (Esc/Ctrl+C) - returns ErrSessionExit
	//   - Non-interactive mode without DefaultAction - returns ErrNonInteractiveNoDefault
	//   - Context is cancelled
	Prompt(ctx context.Context, opts Options) (*Decision, error)
}

// ErrPromptCancelled is retained for backward compatibility. The built-in
// prompters no longer produce this error from user key presses (both Esc
// and Ctrl+C now return ErrSessionExit), but external Prompter
// implementations or tests may still use it.
var ErrPromptCancelled = errors.New("prompt cancelled by user")

// ErrSessionExit indicates the user requested a full session exit
// (Esc or Ctrl+C at an approval prompt). The current execution should
// be cancelled and the CLI should exit cleanly.
var ErrSessionExit = errors.New("session exit requested by user")

// ErrNonInteractiveNoDefault indicates non-interactive mode was requested
// but no DefaultAction was specified in Options.
var ErrNonInteractiveNoDefault = errors.New("non-interactive mode requires default action")

// resolveNonInteractive returns the default decision when interactive
// prompting is skipped (non-interactive flag, no TTY, non-terminal fd).
// Shared by InteractivePrompter and InlinePrompter.
func resolveNonInteractive(opts Options) (*Decision, error) {
	if opts.DefaultAction == ActionUnspecified {
		return nil, ErrNonInteractiveNoDefault
	}
	return &Decision{Action: opts.DefaultAction}, nil
}
