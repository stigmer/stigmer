package root

import (
	"io"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// readGroupThreshold is the minimum number of consecutive read tool completions
// that triggers grouped rendering via RenderReadGroup. Below this threshold,
// reads are rendered individually via RenderCompact.
const readGroupThreshold = 3

// inputBarMode controls the persistent input bar at the bottom of the View.
// The input bar provides a consistent interaction surface: disabled during
// agent processing ("esc to interrupt"), active during follow-up (text input
// with cursor). Hidden in non-interactive environments (CI, piped output).
type inputBarMode int

const (
	inputBarHidden   inputBarMode = iota // no input bar (CI, non-interactive, legacy)
	inputBarDisabled                     // visible but inactive ("esc to interrupt")
	inputBarActive                       // text input active (follow-up mode)
)

// followUpSepWidth is the fallback separator width used by legacy follow-up
// paths (direct-write and key-reader) and as a default when terminal width
// is unknown. The Bubbletea text-input path uses the live terminal width
// from tea.WindowSizeMsg instead.
const followUpSepWidth = 40

// followUpPromptRows is the number of terminal rows the follow-up prompt
// occupies: separator + prompt + hint = 3 visible rows, plus the leading
// blank line = 4 rows total for erasure.
const followUpPromptRows = 4

// renderResult holds the outcome of a single renderInline invocation.
// When followUpInput is non-empty, the renderer collected follow-up text
// from the user before returning (channel path with Bubbletea owning stdin).
type renderResult struct {
	phase         string
	exitErr       string
	history       []committedItem
	followUpInput string

	// program is the managed Bubbletea Program that was active when
	// renderInline returned. May differ from the cfg.program that was
	// passed in when performReCommit created replacement programs during
	// the session. Callers must use this reference (not the original)
	// for cleanup.
	program *managedProgram
}

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
	sandboxRoot       string   // session sandbox dir for universal path fallback
	platformDir       string   // session platform dir for .stigmer/ virtual mount
	cancelExecFn      func()   // cancels the current backend execution; nil-safe

	// program is the managed Bubbletea Program running alongside the event
	// loop. When non-nil, status output is routed through program.Println
	// so Bubbletea tracks stderr row positions accurately. When nil (unit
	// tests, non-TTY), output falls back to direct writes on the status
	// writer.
	program *managedProgram

	// programFactory creates a fresh managed Bubbletea program with the
	// same channels and output writer. The initModel callback pre-loads
	// model state (plan, input bar, approval) before the program starts.
	// nil when program is nil (non-TTY).
	programFactory func(initModel func(*inlineBubbleModel)) *managedProgram

	// suppressHumanEcho skips the next HumanMessageEvent rendering. Set by
	// the follow-up loop after local echo to prevent duplicate display when
	// the backend echoes the same message.
	suppressHumanEcho bool

	// headerInfo carries session metadata for the session header panel.
	// Stored as history[0] (kindHeader) so the header can be re-rendered
	// during clear+re-commit (e.g., subject update).
	headerInfo sessionHeaderInfo

	// initialHistory seeds the renderer's history buffer when continuing
	// from a prior execution (follow-up loop). When non-nil, the renderer
	// uses this slice instead of creating a fresh [{kindHeader}]. This
	// allows Ctrl+O to toggle all items across the entire conversation,
	// not just the current execution.
	initialHistory []committedItem

	// subjectUpdate receives the resolved session subject from the
	// pollSessionSubject goroutine. nil when no subject polling is needed
	// (resumed sessions, detached mode, no session).
	subjectUpdate <-chan string

	// recentSessionsCh receives recently-created sessions fetched
	// asynchronously from the backend. One-shot: consumed once, then
	// nilled. nil for resumed sessions or non-TTY mode.
	recentSessionsCh <-chan []recentSession

	// toggleExpandCh receives a signal when the user presses Ctrl+O to
	// toggle between compact and expanded display modes. The event loop
	// flips expandMode and triggers a full re-commit. nil when Bubbletea
	// does not own stdin (non-TTY, tests, resumed sessions).
	toggleExpandCh <-chan struct{}

	// cancelCh receives a signal when the user presses Ctrl+C during
	// idle state (agent executing, no interactive prompt). Detaches from
	// the session without cancelling the backend execution, which
	// continues running and can be resumed later. nil when Bubbletea
	// does not own stdin.
	cancelCh <-chan struct{}

	// interruptCh receives a signal when the user presses Esc during
	// idle state (agent executing, no interactive prompt). Cancels the
	// current execution and transitions to follow-up mode so the user
	// can send a corrective message. nil when Bubbletea does not own
	// stdin.
	interruptCh <-chan struct{}

	// followUpEnabled indicates that renderInline should handle the
	// follow-up prompt internally after a terminal event, rather than
	// returning immediately. When true and the execution phase is
	// eligible, the renderer activates text input mode and continues
	// the event loop until the user submits or cancels. This keeps
	// toggleExpandCh active so Ctrl+O works during the follow-up prompt.
	followUpEnabled bool
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
	contentStreamed bool   // content was shown via ToolStreamDeltaEvent
	streamedRows    int    // total display rows of streamed content
	existingContent string // for write tools: content read from disk before overwrite
}

// subAgentDisplayEntry holds per-sub-agent display state for the live
// stacked view in Bubbletea. Multiple entries are rendered simultaneously
// when parallel sub-agents are active.
//
// The live view shows "Working…" with an animated spinner, elapsed time,
// and a running tool count. spinnerStart and toolCount are preserved
// across re-commits via transferSubAgentEntries so the display stays
// consistent through screen redraws. Only the spinner frame, elapsed
// string, and tool count change — the first two via the tick handler,
// the last via subAgentToolCountMsg on each tool completion.
type subAgentDisplayEntry struct {
	id           string
	subject      string
	spinnerStart time.Time
	elapsedStr   string
	toolCount    int
}

// completedSubAgentEntry holds a recently-completed sub-agent that is
// briefly shown in the live View() before being dismissed to scrollback.
// Active entries are animated (spinner, elapsed time); completed entries
// are static (checkmark/status icon) and auto-dismiss after a short delay
// via subAgentDismissMsg.
type completedSubAgentEntry struct {
	id              string // matches the original subAgentDisplayEntry.id
	displayLine     string // pre-styled single-line summary for live View()
	scrollbackLines string // pre-rendered scrollback content committed on dismiss
}

// subAgentBlock is the aggregate for a single sub-agent execution. It buffers
// all internal events (tool completions, AI messages, read groups, approvals)
// while the sub-agent runs and is committed as a single kindSubAgentBlock
// history item on completion. This enables collapsed rendering (one summary
// line) by default and expanded rendering (gutter-wrapped children) via Ctrl+O.
type subAgentBlock struct {
	id        string
	name      string
	subject   string                          // short display label (from SubAgentStartedEvent.Description)
	input     string                          // full task prompt (shown in expanded view)
	startedAt time.Time                       // wall-clock time the sub-agent started; survives re-commits
	status    agentexecutionv1.SubAgentStatus // lifecycle state (IN_PROGRESS while running)
	children  []committedItem                 // internal tool calls, AI messages, read groups
	toolCount int                             // running count of tool completions inside this sub-agent
	output    string                          // final result (from SubAgentCompletedEvent.Output)
}

// inlineRenderer consumes execution events and renders them to the terminal
// without the Bubbletea alt-screen TUI. When a Bubbletea program is active,
// ALL visual output (including AI text) flows through Bubbletea on stderr,
// keeping cursor tracking in sync. AI text is also written to stdout when
// it is piped/redirected (not a TTY) so pipe consumers receive the data.
//
// When no program is running (non-TTY, tests, CI), AI content goes to the
// data writer (stdout) and status/progress goes to the status writer (stderr).
type inlineRenderer struct {
	cfg         inlineRenderConfig
	compactOpts toolrender.CompactOptions

	// dataIsTTY is true when the data writer (stdout) is a terminal.
	// When false (piped/redirected), AI text is also written to stdout
	// for pipe consumers. When true and a Bubbletea program is active,
	// AI text flows only through Bubbletea — no stdout writes.
	dataIsTTY bool

	// thinkTimer fires after thinkingIdleDelay of inactivity, triggering
	// the thinking spinner. The spinner itself is rendered by Bubbletea's
	// View() via spinnerStartMsg / spinnerStopMsg sent from the event loop.
	thinkTimer *time.Timer
	phase      string

	// AI streaming state — tracks incremental delta output so each render
	// only prints the bytes appended since the last delta event.
	inAIStream    bool
	streamedBytes int

	// aiStreamBuffer holds the partial (incomplete) line being accumulated
	// during AI streaming via Bubbletea. Complete lines are committed via
	// writeToScrollback as each newline arrives; the remaining bytes stay
	// here until the next newline or stream end.
	aiStreamBuffer string

	// aiStreamPrefix holds the "● " bullet prefix for the first line of
	// an AI message. Consumed after the first line is committed, so
	// subsequent lines have no prefix.
	aiStreamPrefix string

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
	// streaming (progressive commit to scrollback) and post-approval
	// streaming (shell output in View() after user approves).
	activeStreamToolID string // tool call ID currently streaming
	toolStreamedBytes  int    // tool content bytes already printed (delta rendering)
	streamHeaderRows   int    // display rows for header portion (direct-write path)
	streamLineCount    int    // total display rows including content (direct-write erase)
	streamSubAgentID   string // sub-agent context for gutter wrapping

	// streamHeaderDeferred is true when the pre-approval streaming header
	// could not be rendered because the tool call's primary arg (e.g. path)
	// was not yet available. The header is rendered on the first
	// ToolStreamDeltaEvent, which carries an updated ToolCall with
	// populated Args.
	streamHeaderDeferred bool

	// lastStreamHeader tracks the most recently sent streaming header so
	// dynamic updates can be sent only when the header actually changes
	// (e.g. when the tool's primary arg becomes available mid-stream).
	lastStreamHeader string

	// streamIsPreApproval is true when the current streaming session is
	// pre-approval (input streaming — content being generated by the AI).
	// false for post-approval output streaming (shell output). Derived
	// from the proto ToolCall.streaming_source field via isInputStreaming().
	streamIsPreApproval bool

	// activeSubAgents holds the in-progress sub-agent blocks, keyed by
	// sub-agent ID. Events with SubAgentID are routed to the matching
	// block's children list instead of scrollback. Finalized blocks are
	// committed as kindSubAgentBlock and removed from the map.
	activeSubAgents map[string]*subAgentBlock

	// completedSubAgentIDs tracks sub-agent IDs whose blocks have been
	// committed to scrollback. Late-arriving tool events from subsequent
	// stream updates are suppressed so they don't leak as standalone
	// gutter-wrapped items below the collapsed sub-agent line.
	completedSubAgentIDs map[string]bool

	// exitRequested is set by handleSessionExit when the user presses
	// Ctrl+C at an approval prompt. Checked after handleApproval returns
	// to terminate the render loop with a "cancelled" phase.
	exitRequested bool

	// expandMode controls whether tool completions and read groups render
	// in expanded form (full output, no truncation). Toggled by Ctrl+O.
	// Affects both new items committed via statusf and re-committed items
	// during clear+re-commit.
	expandMode bool

	// pendingReCommit is set when a re-commit trigger (Ctrl+O, subject
	// update, recent sessions) fires during an active AI stream. The
	// re-commit is deferred because AI stream lines are not stored in
	// history — a re-commit during streaming would lose them. The flag
	// is checked after each handleEvent call and inside renderAIStreamEnd;
	// when the AI stream ends and pendingReCommit is true, the deferred
	// re-commit fires with the full history (including the final AI message).
	pendingReCommit bool

	// history records every item committed to terminal scrollback via
	// writeToScrollback. Used by the clear+re-commit mechanism to
	// reconstruct the full session display when the subject resolves or
	// the user toggles expand/collapse mode via Ctrl+O.
	history []committedItem

	// lastScrollbackKind tracks the committedKind of the most recent
	// write to terminal scrollback. Used by writeToScrollback to decide
	// whether a leading gap is needed before the next item (e.g.,
	// transitioning from a dense tool block to an AI message).
	lastScrollbackKind committedKind

	// trackedCurrentTask mirrors the model's currentTask field so the
	// renderer can transfer it to a new program during re-commit.
	trackedCurrentTask string

	// trackedTodoTotal and trackedTodoCompleted mirror the model's plan
	// progress counts so the renderer can transfer them during re-commit.
	trackedTodoTotal     int
	trackedTodoCompleted int

	// trackedInputBarMode mirrors the model's inputBarMode so the
	// renderer can transfer it to a new program during re-commit.
	trackedInputBarMode inputBarMode

	// followUpSendCh is the send-only end of the follow-up input channel.
	// Stored so performReCommit can transfer it to the new program's model.
	// nil when not in follow-up mode.
	followUpSendCh chan<- string

	// followUpInputCh receives the user's follow-up input from the
	// Bubbletea model's text input handler. nil until the renderer
	// enters follow-up mode after an eligible terminal event.
	followUpInputCh <-chan string

	// donePhase and doneExitErr store the terminal event's phase and
	// error when the renderer enters follow-up mode. Returned in the
	// renderResult when the follow-up completes or is cancelled.
	donePhase   string
	doneExitErr string
}

// expandHintEnabled reports whether the "(ctrl+o to expand)" hint should
// be shown on compact tool lines. True only when Bubbletea owns stdin
// and the Ctrl+O toggle is available (TTY mode).
func (r *inlineRenderer) expandHintEnabled() bool {
	return r.cfg.toggleExpandCh != nil
}
