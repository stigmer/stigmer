package executiontui

import (
	"time"

	"github.com/charmbracelet/bubbles/spinner"
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

	// CancelFn is called to cancel the execution on the backend.
	// It is invoked asynchronously from a tea.Cmd when the user confirms
	// cancellation. The result arrives via the stream as a phase change
	// to "cancelled". May be nil if cancel is not supported.
	CancelFn func() error
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

	// focusedBlockIndex is the index into blocks of the currently focused
	// expandable block. -1 means no block is focused (the default state).
	// Activated by Tab; moved with Tab/Shift+Tab; used by Enter to toggle.
	focusedBlockIndex int

	// autoScroll follows new content at the bottom of the viewport.
	autoScroll bool

	// phase is the current execution phase as a human-readable string.
	phase string

	// streaming holds state for an in-progress AI streaming message.
	// nil when no message is actively streaming.
	streaming *streamingState

	// runningTools maps tool call IDs to their block index in the blocks slice.
	// When a ToolRunningEvent arrives, the block is created and tracked here.
	// When a ToolCompletedEvent arrives, the block is replaced in-place with
	// the final expandable result and removed from this map.
	runningTools map[string]int

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

	// cancelConfirm is true when the TUI is showing the "Cancel execution?
	// [y] yes [n] no" confirmation in the footer. Set by pressing 'c',
	// cleared by 'y' (confirm), 'n', or 'esc' (dismiss).
	cancelConfirm bool

	// cancelling is true after the user confirms cancellation and the cancel
	// request has been sent to the backend. Cleared when the execution
	// transitions to a terminal phase (delivered via the stream).
	cancelling bool

	// showHelp toggles the help overlay. When true, View() renders the
	// help panel in place of the viewport content. Toggled by ? key.
	showHelp bool

	// lastEventAt tracks when the last meaningful execution event was received.
	// Used by the activity tick to detect idle periods and show the thinking
	// indicator in the header. Initialized to the model creation time so the
	// first 2 seconds of execution don't trigger a false thinking state.
	lastEventAt time.Time

	// thinkingVisible is true when the thinking indicator (animated spinner)
	// should be shown in the header. Set by the activity tick after 2 seconds
	// of no events during the in_progress phase; cleared when the next event
	// arrives.
	thinkingVisible bool

	// spinner is the animated spinner displayed in the header. During the
	// "pending" phase it signals that the TUI is alive while waiting for
	// the agent to start. During "in_progress" it reactivates as a thinking
	// indicator when no events arrive for longer than the idle threshold.
	spinner spinner.Model
}

// New creates a new execution TUI model with the given configuration.
// The model is not usable until Init() is called by the Bubbletea runtime,
// which starts the event listener.
func New(cfg Config) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	return Model{
		cfg:               cfg,
		autoScroll:        true,
		phase:             "pending",
		focusedBlockIndex: -1,
		runningTools:      make(map[string]int),
		spinner:           s,
		lastEventAt:       time.Now(),
	}
}

// Init implements tea.Model. It returns the initial commands that start
// listening for execution events, animating the pending-phase spinner,
// and the periodic activity tick for idle detection.
func (m Model) Init() tea.Cmd {
	return tea.Batch(listenForEvents(m.cfg.Events), m.spinner.Tick, scheduleActivityTick())
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
