package executiontui

// FollowUpFn creates a new execution within the current session and returns
// the channels needed to stream its events. Called when the user submits a
// follow-up message after an execution completes.
//
// The callback is responsible for:
//   - Creating a new execution via the backend (using the session ID)
//   - Subscribing to the new execution's gRPC stream
//   - Launching a goroutine that converts stream updates to events
//   - Returning the new channels and cancel function
//
// When nil, conversational follow-ups are disabled and the renderer exits
// on execution completion.
type FollowUpFn func(message string) (*FollowUpResult, error)

// FollowUpResult contains the channels and callbacks for a newly created
// follow-up execution.
type FollowUpResult struct {
	// ExecutionID is the backend identifier for the new execution.
	ExecutionID string

	// Events is the channel from which the renderer receives events for
	// the new execution. Owned by the streamToEvents goroutine.
	Events <-chan Event

	// ApprovalResponses is the channel where the renderer sends approval
	// decisions for the new execution.
	ApprovalResponses chan<- ApprovalResponse

	// CancelFn cancels the new execution on the backend.
	CancelFn func() error
}
