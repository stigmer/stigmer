package executiontui

import (
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
)

// Config holds the parameters needed to create an execution TUI model.
// All fields are required unless noted otherwise.
type Config struct {
	// ExecutionID is the agent execution identifier displayed in the header.
	ExecutionID string

	// Events is the channel from which the TUI receives execution events.
	// The gRPC stream goroutine sends events here; the TUI listens via tea.Cmd.
	Events <-chan Event

	// ApprovalResponses is the channel where the TUI sends the user's
	// approval decisions. The gRPC goroutine reads from this channel when
	// blocked on an approval request.
	ApprovalResponses chan<- ApprovalResponse
}

// streamingState tracks an in-progress streaming AI message.
// When non-nil on the model, the current last block is being streamed.
type streamingState struct {
	// content holds the full accumulated text so far.
	content string
}

// approvalState tracks an active approval prompt.
// When non-nil on the model, the TUI routes keyboard input to approval handling.
type approvalState struct {
	toolCallID  string
	toolName    string
	argsPreview string
	message     string
}

// Model is the top-level Bubbletea model for the execution TUI.
// It manages content blocks, viewport rendering, and interaction state.
type Model struct {
	cfg Config

	// viewport is the scrollable content area managed by bubbles/viewport.
	viewport viewport.Model

	// blocks is the ordered list of rendered content blocks.
	blocks []contentBlock

	// autoScroll follows new content at the bottom of the viewport.
	autoScroll bool

	// phase is the current execution phase as a human-readable string.
	phase string

	// streaming holds state for an in-progress AI streaming message.
	// nil when no message is actively streaming.
	streaming *streamingState

	// approval holds state for an active approval prompt.
	// nil when no approval is pending.
	approval *approvalState

	// width and height are the terminal dimensions from the last WindowSizeMsg.
	width  int
	height int

	// ready becomes true after the first WindowSizeMsg, which provides
	// the terminal dimensions needed to initialize the viewport.
	ready bool

	// done becomes true when the execution reaches a terminal phase.
	// The TUI displays a final message and prepares to exit.
	done bool

	// exitError holds the error message when the stream fails.
	exitError string
}

// New creates a new execution TUI model with the given configuration.
// The model is not usable until Init() is called by the Bubbletea runtime,
// which starts the event listener.
func New(cfg Config) Model {
	return Model{
		cfg:        cfg,
		autoScroll: true,
		phase:      "pending",
	}
}

// Init implements tea.Model. It returns the initial command that starts
// listening for execution events on the configured channel.
func (m Model) Init() tea.Cmd {
	return listenForEvents(m.cfg.Events)
}

// FinalError returns the error message if the execution stream failed.
// Empty string if the execution completed normally.
func (m Model) FinalError() string {
	return m.exitError
}

// Done returns true if the execution reached a terminal phase.
func (m Model) Done() bool {
	return m.done
}
