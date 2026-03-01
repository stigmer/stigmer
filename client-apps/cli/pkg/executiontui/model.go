package executiontui

import (
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
)

// Config holds the parameters needed to create an execution TUI model.
// All fields are required unless noted otherwise.
type Config struct {
	// SessionID is the session identifier displayed in the header.
	// When non-empty, the header shows "Session: <subject>" instead of
	// "Execution: exec-xxx". Falls back to displaying the raw ID when
	// SessionSubject is empty.
	SessionID string

	// SessionSubject is the human-readable subject line for the session.
	// When non-empty, the header displays this instead of the raw
	// SessionID for a friendlier experience.
	SessionSubject string

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

	// FollowUpFn creates a follow-up execution within the same session.
	// When set, the TUI enters conversational mode: after an execution
	// completes, the input composer activates and the user can send
	// follow-up messages. When nil, the TUI exits on completion
	// (pre-Phase 2 behavior).
	FollowUpFn FollowUpFn

	// SubjectFetchFn, when set, is called on a bounded backoff schedule to
	// retrieve the current session subject from the backend. It returns an
	// empty string while the subject has not yet been generated, and the
	// resolved subject once available. The TUI updates the header in-place
	// on the first non-empty result. Errors should be swallowed by the
	// caller — return "" to trigger the next retry attempt.
	//
	// Only scheduled when the TUI starts without a known subject (i.e.,
	// SessionSubject == ""). No-op for sessions that already have a title.
	SubjectFetchFn func() string

	// Verbose enables execution-level details in the TUI transcript.
	// When true, phase transitions and execution IDs appear as system
	// blocks in the viewport — useful for debugging multi-execution
	// sessions where execution boundaries are normally hidden.
	Verbose bool
}

// streamingState tracks an in-progress streaming AI message.
// When non-nil on the model, the block at blockIdx is being streamed.
// This is shared between top-level and sub-agent streaming — they never
// overlap because the top-level agent is blocked on the "task" tool while
// the sub-agent generates.
type streamingState struct {
	// content holds the full accumulated text so far.
	content string

	// blockIdx is the index into m.blocks of the streaming AI block.
	// This is set when AIStreamStartEvent creates the block and used by
	// AIStreamDeltaEvent / AIStreamEndEvent to update the correct block.
	// Without explicit tracking, tool call state events (processed before
	// message events) can append blocks between start and delta/end,
	// causing the naive len(m.blocks)-1 approach to target the wrong block.
	blockIdx int

	// subAgentID is the sub-agent scope for this streaming message. Empty
	// for top-level agent streaming. Propagated to the block so the
	// renderer applies the correct visual nesting.
	subAgentID string
}

// subAgentInfo holds metadata about a sub-agent execution. Stored in the
// model's subAgentMeta map, keyed by sub-agent ID.
type subAgentInfo struct {
	// Name is the sub-agent type (e.g., "generalPurpose", "explore").
	Name string
	// Input is the full task prompt given to the sub-agent.
	Input string
	// Description is a concise (3-5 word) summary of the delegated task.
	Description string
	// ToolCount tracks the number of tool calls made by this sub-agent.
	// Incremented when a new tool block is created (not on updates).
	// Displayed in the sub-agent header summary.
	ToolCount int
	// Status is the sub-agent lifecycle state: "running", "completed",
	// or "failed". Updated by SubAgentCompletedEvent. Displayed as a
	// badge in the sub-agent header.
	Status string
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

	// subAgentMeta maps sub-agent execution IDs to their metadata (name,
	// input prompt, short description, tool count, status). Populated by
	// SubAgentStartedEvent and updated as tool events and completion events
	// arrive. Used to render the sub-agent header block summary.
	subAgentMeta map[string]subAgentInfo

	// subAgentBlockIdx maps sub-agent execution IDs to their header block
	// index in the blocks slice. Used to update the header block in-place
	// when the sub-agent's tool count or status changes, and to check
	// the header's expanded state when deciding whether new child blocks
	// should be hidden.
	subAgentBlockIdx map[string]int

	// todoBlockIdx is the index into blocks of the current execution's todo
	// block. -1 means no todo block exists yet. Set on the first
	// TodoUpdateEvent; updated in-place on subsequent events. Reset to -1
	// when a follow-up execution starts.
	todoBlockIdx int

	// approval holds state for an active approval prompt.
	// nil when no approval is pending.
	approval *approvalState

	// approvalBlockIdx is the index into blocks of the current approval
	// context block. -1 means no approval block exists. Set when an
	// ApprovalNeededEvent creates the block; cleared when the user responds
	// (the block is replaced with a compact confirmation line).
	approvalBlockIdx int

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

	// textarea is the input composer shown at the bottom of the TUI.
	// Active when inputActive is true; otherwise rendered as a dimmed
	// placeholder. Only used when Config.FollowUpFn is set.
	textarea textarea.Model

	// inputActive is true when the input composer is focused and the user
	// can type a follow-up message. Set when an execution reaches a
	// terminal phase and FollowUpFn is configured. Cleared when the user
	// submits a follow-up (new execution starts) or presses Esc (exit).
	inputActive bool

	// activeEvents is the events channel for the current execution.
	// Initialized from cfg.Events and swapped when a follow-up starts.
	activeEvents <-chan Event

	// activeApprovals is the approval response channel for the current
	// execution. Initialized from cfg.ApprovalResponses and swapped
	// when a follow-up starts.
	activeApprovals chan<- ApprovalResponse

	// activeCancelFn is the cancel function for the current execution.
	// Initialized from cfg.CancelFn and swapped when a follow-up starts.
	activeCancelFn func() error

	// latestExecutionID tracks the most recent execution ID. Updated when
	// a follow-up execution starts. The caller uses this after the TUI
	// exits to fetch the final execution state from the correct execution.
	latestExecutionID string

	// subjectFetchAttempt counts completed background polls for the session
	// subject. Used to advance through subjectFetchBackoff and cap retries.
	subjectFetchAttempt int
}

// New creates a new execution TUI model with the given configuration.
// The model is not usable until Init() is called by the Bubbletea runtime,
// which starts the event listener.
func New(cfg Config) Model {
	s := spinner.New()
	s.Spinner = spinner.Dot

	ta := textarea.New()
	ta.Placeholder = "Type a message, or press Esc to exit"
	ta.ShowLineNumbers = false
	ta.SetHeight(1)
	ta.CharLimit = 4096
	ta.Blur()

	var blocks []contentBlock
	if cfg.Verbose {
		blocks = append(blocks, newSystemBlock(
			renderSystemContent("Execution: "+cfg.ExecutionID),
		))
	}

	return Model{
		cfg:               cfg,
		blocks:            blocks,
		autoScroll:        true,
		phase:             "pending",
		focusedBlockIndex: -1,
		runningTools:      make(map[string]int),
		subAgentMeta:      make(map[string]subAgentInfo),
		subAgentBlockIdx:  make(map[string]int),
		todoBlockIdx:      -1,
		approvalBlockIdx:  -1,
		spinner:           s,
		lastEventAt:       time.Now(),
		textarea:          ta,
		activeEvents:      cfg.Events,
		activeApprovals:   cfg.ApprovalResponses,
		activeCancelFn:    cfg.CancelFn,
		latestExecutionID: cfg.ExecutionID,
	}
}

// Init implements tea.Model. It returns the initial commands that start
// listening for execution events, animating the pending-phase spinner,
// and the periodic activity tick for idle detection.
//
// When there is no events channel (replay or resumable mode), no event
// listener or activity tick is started. Resumable models start with input
// active; replay models are fully read-only. In both cases, the model
// waits for window size and then renders pre-populated blocks.
//
// When SubjectFetchFn is set and no subject is known yet, a background poll
// is also scheduled. It fires after 3 s and retries with backoff up to three
// times total, updating the header in-place on the first successful result.
func (m Model) Init() tea.Cmd {
	if m.activeEvents == nil {
		return nil
	}
	cmds := []tea.Cmd{listenForEvents(m.activeEvents), m.spinner.Tick, scheduleActivityTick()}
	if m.cfg.SubjectFetchFn != nil && m.cfg.SessionSubject == "" {
		cmds = append(cmds, scheduleSubjectFetch(3*time.Second, m.cfg.SubjectFetchFn))
	}
	return tea.Batch(cmds...)
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

// LatestExecutionID returns the ID of the most recent execution. When
// follow-ups have been sent, this is the last follow-up execution's ID
// rather than the original. The caller uses this to fetch the correct
// execution state after the TUI exits.
func (m Model) LatestExecutionID() string {
	return m.latestExecutionID
}
