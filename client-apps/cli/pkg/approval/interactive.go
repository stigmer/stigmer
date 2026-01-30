package approval

import (
	"context"

	"github.com/AlecAivazis/survey/v2"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// InteractivePrompter implements Prompter using the Survey library for TTY sessions.
type InteractivePrompter struct {
	// askCommentOnReject controls whether to ask for rejection reason.
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

// showInteractivePrompt displays the Survey prompt and collects user input.
func (p *InteractivePrompter) showInteractivePrompt(_ context.Context, _ Options) (*Decision, error) {
	actionOptions := []string{
		"Approve - Execute the tool",
		"Skip - Continue without executing",
		"Reject - Fail the execution",
	}

	prompt := &survey.Select{
		Message: "What would you like to do?",
		Options: actionOptions,
	}

	var selectedIndex int
	if err := survey.AskOne(prompt, &selectedIndex); err != nil {
		return nil, ErrPromptCancelled
	}

	action := indexToAction(selectedIndex)
	decision := &Decision{Action: action}

	// Ask for comment on reject (optional)
	if action == ActionReject && p.askCommentOnReject {
		decision.Comment = p.askComment()
	}

	return decision, nil
}

// askComment prompts for an optional rejection reason.
func (p *InteractivePrompter) askComment() string {
	var comment string
	prompt := &survey.Input{
		Message: "Rejection reason (optional):",
	}
	// Ignore error - comment is optional, empty string is fine
	_ = survey.AskOne(prompt, &comment)
	return comment
}

// indexToAction converts the selection index to an Action.
func indexToAction(index int) Action {
	switch index {
	case 0:
		return ActionApprove
	case 1:
		return ActionSkip
	case 2:
		return ActionReject
	default:
		return ActionUnspecified
	}
}
