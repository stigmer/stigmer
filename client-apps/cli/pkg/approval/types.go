package approval

// Action represents the user's approval decision.
// Maps directly to proto ApprovalAction enum for submission.
type Action int

const (
	// ActionUnspecified indicates no action was selected (invalid state).
	ActionUnspecified Action = iota

	// ActionApprove executes the tool normally and continues execution.
	ActionApprove

	// ActionSkip returns "skipped by user" message to LLM and continues execution.
	ActionSkip

	// ActionReject fails the execution immediately with rejection error.
	ActionReject
)

// String returns the human-readable action name.
func (a Action) String() string {
	switch a {
	case ActionApprove:
		return "Approve"
	case ActionSkip:
		return "Skip"
	case ActionReject:
		return "Reject"
	default:
		return "Unspecified"
	}
}

// Decision represents the complete user approval decision.
type Decision struct {
	// Action is the approval action selected by the user.
	Action Action

	// Comment is an optional reason/comment for the decision.
	// Typically provided when rejecting to explain why.
	Comment string
}

// Options configures the approval prompt behavior.
type Options struct {
	// ToolName is the name of the tool requiring approval.
	ToolName string

	// Message is the approval message/reason displayed to the user.
	Message string

	// ArgsPreview is a JSON preview of the tool arguments.
	ArgsPreview string

	// NonInteractive skips the prompt and uses DefaultAction immediately.
	// Useful for CI/CD pipelines and scripted environments.
	NonInteractive bool

	// DefaultAction is the action to use when NonInteractive is true
	// or when no TTY is available. Must be set for non-interactive mode.
	DefaultAction Action
}
