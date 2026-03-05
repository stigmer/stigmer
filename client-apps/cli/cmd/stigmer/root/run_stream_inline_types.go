package root

import (
	"io"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// readGroupThreshold is the minimum number of consecutive read tool completions
// that triggers grouped rendering via RenderReadGroup. Below this threshold,
// reads are rendered individually via RenderCompact.
const readGroupThreshold = 3

// inlineRenderConfig configures the inline (non-TUI) event renderer.
type inlineRenderConfig struct {
	events            <-chan executiontui.Event
	approvalResponses chan<- executiontui.ApprovalResponse
	prompter          approval.Prompter
	defaultAction     approval.Action
	data              io.Writer // AI content (stdout)
	status            io.Writer // status/progress (stderr)
	sessionID         string
	workspaceRoots    []string // local workspace root paths for file hyperlinks
	cancelExecFn      func()   // cancels the current backend execution; nil-safe

	// program is the Bubbletea Program running alongside the event loop. When
	// non-nil, status output is routed through program.Println so Bubbletea
	// tracks stderr row positions accurately. When nil (unit tests, non-TTY),
	// output falls back to direct writes on the status writer.
	program *tea.Program

	// suppressHumanEcho skips the next HumanMessageEvent rendering. Set by
	// the follow-up loop after local echo to prevent duplicate display when
	// the backend echoes the same message.
	suppressHumanEcho bool

	// headerInfo carries session metadata for the session header panel.
	// Stored as history[0] (kindHeader) so the header can be re-rendered
	// during clear+re-commit (e.g., subject update).
	headerInfo sessionHeaderInfo

	// subjectUpdate receives the resolved session subject from the
	// pollSessionSubject goroutine. nil when no subject polling is needed
	// (resumed sessions, detached mode, no session).
	subjectUpdate <-chan string

	// toggleExpandCh receives a signal when the user presses Ctrl+O to
	// toggle between compact and expanded display modes. The event loop
	// flips expandMode and triggers a full re-commit. nil when Bubbletea
	// does not own stdin (non-TTY, tests, resumed sessions).
	toggleExpandCh <-chan struct{}

	// cancelCh receives a signal when the user presses Ctrl+C during
	// idle state (agent executing, no interactive prompt). Triggers the
	// same cancellation logic as context.Done(). nil when Bubbletea does
	// not own stdin.
	cancelCh <-chan struct{}
}

// pendingRead wraps a read tool completion with the sub-agent context it
// originated from. This allows flushPendingReads to apply gutter-wrapping
// when reads belong to a sub-agent.
type pendingRead struct {
	tc         toolrender.ToolCallInfo
	subAgentID string
}

// waitingApprovalState holds context saved from ToolWaitingApprovalEvent
// for use by handleApproval when the subsequent ApprovalNeededEvent arrives.
type waitingApprovalState struct {
	tc              toolrender.ToolCallInfo
	subAgentID      string
	contentStreamed bool // content was shown via ToolStreamDeltaEvent
	streamedRows    int  // total display rows of streamed content
}

// inlineRenderer consumes execution events and renders them to the terminal
// without the Bubbletea alt-screen TUI. AI content flows to the data writer
// (stdout) while all status/progress goes to the status writer (stderr).
//
// This enables piping: `stigmer run agent x | process_output` captures only
// the agent's response, while progress and tool activity remain visible on
// the terminal via stderr.
type inlineRenderer struct {
	cfg         inlineRenderConfig
	compactOpts toolrender.CompactOptions

	// thinkTimer fires after thinkingIdleDelay of inactivity, triggering
	// the thinking spinner. The spinner itself is rendered by Bubbletea's
	// View() via spinnerStartMsg / spinnerStopMsg sent from the event loop.
	thinkTimer *time.Timer
	phase      string

	// AI streaming state — tracks incremental delta output so each render
	// only prints the bytes appended since the last delta event.
	inAIStream    bool
	streamedBytes int

	// pendingReads buffers consecutive read tool completions for grouped
	// rendering. Flushed when a non-read event arrives that produces visible
	// output, or when the stream terminates. Each entry is tagged with its
	// sub-agent context so gutter-wrapping is applied correctly on flush.
	pendingReads []pendingRead

	// waitingApproval holds the ToolCallInfo saved from the most recent
	// ToolWaitingApprovalEvent. handleApproval uses this to render the
	// expanded view and the collapsed result with full tool metadata.
	waitingApproval *waitingApprovalState

	// suppressedToolIDs tracks tool call IDs whose ToolCompletedEvent
	// should be suppressed because the approval result already rendered
	// the outcome. Write/edit/delete completions are suppressed; shell
	// completions are handled by the streaming interception instead.
	suppressedToolIDs map[string]bool

	// Tool content streaming state — tracks a tool call that is actively
	// streaming content via ToolStreamDeltaEvent. Used for both pre-approval
	// streaming (write/edit typewriter effect) and post-approval streaming
	// (shell output after user approves).
	activeStreamToolID string // tool call ID currently streaming
	toolStreamedBytes  int    // tool content bytes already printed (delta rendering)
	streamHeaderRows   int    // display rows for header portion (set at init)
	streamLineCount    int    // total display rows including content (for erase)
	streamSubAgentID   string // sub-agent context for gutter wrapping

	// streamHeaderDeferred is true when the pre-approval streaming header
	// could not be rendered because the tool call's primary arg (e.g. path)
	// was not yet available. The header is rendered on the first
	// ToolStreamDeltaEvent, which carries an updated ToolCall with
	// populated Args.
	streamHeaderDeferred bool

	// maxStreamContentLines caps the number of content lines displayed
	// during pre-approval streaming. Computed from the terminal height
	// in initPreApprovalStreaming. When the cap is reached, a truncation
	// indicator replaces further content, keeping the display within
	// the visible terminal and making the row count deterministic.
	maxStreamContentLines int

	// streamContentLines tracks content lines actually displayed during
	// pre-approval streaming (excluding the header). Used to enforce the
	// maxStreamContentLines cap.
	streamContentLines int

	// streamTruncationShown is true when the streaming content hit the
	// cap and a truncation indicator was printed. The indicator is updated
	// in-place as more content arrives (incrementing the overflow count).
	streamTruncationShown bool

	// exitRequested is set by handleSessionExit when the user presses
	// Ctrl+C at an approval prompt. Checked after handleApproval returns
	// to terminate the render loop with a "cancelled" phase.
	exitRequested bool

	// expandMode controls whether tool completions and read groups render
	// in expanded form (full output, no truncation). Toggled by Ctrl+O.
	// Affects both new items committed via statusf and re-committed items
	// during clear+re-commit.
	expandMode bool

	// history records every item committed to terminal scrollback via
	// statusf/Println (or direct stderr write for the session header).
	// Used by the clear+re-commit mechanism to reconstruct the full
	// session display when the subject resolves or the user toggles
	// expand/collapse mode via Ctrl+O.
	history []committedItem
}
