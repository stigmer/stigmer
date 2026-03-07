package root

import (
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/spinner"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// inlineBubbleModel is the Bubbletea model for the inline renderer. The
// tea.Program running this model owns the stderr writer via tea.WithOutput,
// giving Bubbletea accurate row tracking for all content committed through
// Program.Println.
//
// The View() renders a composed layout: transient content (spinner, streaming,
// approval, AI stream) above a persistent input bar. The input bar is always
// visible in interactive mode, showing "esc to interrupt" during processing
// and an active text input during follow-up.
type inlineBubbleModel struct {
	spinnerActive bool
	spinnerFrame  int
	spinnerLabel  string
	spinnerStart  time.Time

	approvalActive   bool
	approvalContent  string // question line only — expanded content is in scrollback
	approvalSelected int

	// approvalDecisionCh delivers the user's approval choice back to the
	// event loop. Set by approvalStartMsg; nil when using the legacy
	// approvalShowMsg path (program==nil fallback).
	approvalDecisionCh chan<- approvalDecision

	streamingActive       bool
	streamingHeader       string
	streamingContent      string
	streamingSubAgent     string
	streamingProgressive  bool // pre-approval: commit lines to scrollback progressively
	streamingCommittedLen int  // bytes of content already committed to scrollback

	// AI streaming state — when active, View() renders the partial
	// (incomplete) line being typed by the model. Complete lines are
	// committed to scrollback via program.Println before the partial is
	// updated, so View() only ever shows the current in-progress line.
	aiStreamActive  bool
	aiStreamPartial string

	// inputBarMode controls the persistent input bar at the bottom of the
	// View. Set to inputBarDisabled on init when Bubbletea owns stdin,
	// inputBarActive when follow-up text input is engaged, and
	// inputBarHidden for non-interactive environments.
	inputBarMode inputBarMode

	// currentTask holds the content of the first in_progress todo item.
	currentTask string

	// planDisplay holds the full formatted plan (all items with status
	// markers) rendered in the composed View() so the plan is always
	// visible above the input bar. Empty when no plan exists.
	planDisplay string

	// subAgentActive is true when a sub-agent is running and its live
	// summary should be shown in View(). Cleared on subAgentHideMsg.
	subAgentActive    bool
	subAgentID        string
	subAgentSubject   string
	subAgentToolCount int

	// Legacy follow-up state for the promptFollowUpViaKeyReader path
	// (when Bubbletea does not own stdin). Not used when inputBarMode
	// is inputBarDisabled or inputBarActive.
	followUpActive  bool
	followUpContent string

	// Text input state for follow-up prompts when Bubbletea owns stdin.
	// The textinput.Model handles cursor movement, word navigation, and
	// paste; View() composes it into the input bar layout and positions
	// the real terminal cursor via tea.View.Cursor.
	textInput   textinput.Model
	textInputCh chan<- string // delivers final input on Enter

	// termWidth holds the terminal width in columns, updated via
	// tea.WindowSizeMsg. Used to render the full-width separator in
	// the input bar.
	termWidth int

	// reCommitPending suppresses View() output during the first phase of a
	// re-commit. While true, View() returns an empty tea.View so the
	// renderer's internal cursor tracking is not disturbed by the concurrent
	// tea.Raw write that clears and rewrites the terminal. The flag is set
	// by handleReCommit and cleared by handleReCommitDone (phase 2).
	reCommitPending bool

	// Channels for communicating with the event loop goroutine. Set during
	// model initialization when Bubbletea owns stdin. nil otherwise.
	toggleExpandCh chan<- struct{}
	cancelCh       chan<- struct{}
	interruptCh    chan<- struct{}
}

// newFollowUpTextInput configures a textinput.Model for the follow-up
// prompt. Uses real cursor mode (SetVirtualCursor(false)) so that
// Cursor() returns a *tea.Cursor for the parent to position in the
// composed layout.
func newFollowUpTextInput() textinput.Model {
	ti := textinput.New()
	ti.Prompt = "> "
	ti.SetVirtualCursor(false)

	styles := textinput.DefaultDarkStyles()
	styles.Focused.Prompt = promptStyle
	styles.Cursor = textinput.CursorStyle{
		Shape: tea.CursorBar,
		Blink: true,
	}
	ti.SetStyles(styles)

	return ti
}

func newInlineBubbleModel() inlineBubbleModel {
	return inlineBubbleModel{
		textInput:    newFollowUpTextInput(),
		inputBarMode: inputBarHidden,
	}
}

// newInlineBubbleModelWithChannels creates a model wired to the event loop
// via channels. Used when Bubbletea owns stdin and processes keystrokes.
// The input bar starts in disabled mode (visible, showing "esc to interrupt").
func newInlineBubbleModelWithChannels(toggleCh, cancelCh, interruptCh chan<- struct{}) inlineBubbleModel {
	return inlineBubbleModel{
		textInput:      newFollowUpTextInput(),
		inputBarMode:   inputBarDisabled,
		toggleExpandCh: toggleCh,
		cancelCh:       cancelCh,
		interruptCh:    interruptCh,
	}
}

func (m inlineBubbleModel) Init() tea.Cmd {
	return nil
}

func (m inlineBubbleModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.termWidth = msg.Width
		return m, nil
	case tea.KeyPressMsg:
		return m.handleKeyPress(msg)
	case tea.PasteMsg:
		if m.inputBarMode == inputBarActive {
			var cmd tea.Cmd
			m.textInput, cmd = m.textInput.Update(msg)
			return m, cmd
		}
		return m, nil
	case spinnerStartMsg:
		return m.handleSpinnerStart(msg)
	case spinnerStopMsg:
		return m.handleSpinnerStop()
	case spinnerTickMsg:
		return m.handleSpinnerTick()
	case approvalStartMsg:
		return m.handleApprovalStart(msg)
	case approvalShowMsg:
		return m.handleApprovalShow(msg)
	case approvalSelectMsg:
		return m.handleApprovalSelect(msg)
	case approvalHideMsg:
		return m.handleApprovalHide(msg)
	case textInputStartMsg:
		return m.handleTextInputStart(msg)
	case textInputHideMsg:
		return m.handleTextInputHide(msg)
	case streamingShowMsg:
		return m.handleStreamingShow(msg)
	case streamingHeaderUpdateMsg:
		return m.handleStreamingHeaderUpdate(msg)
	case streamingUpdateMsg:
		return m.handleStreamingUpdate(msg)
	case streamingHideMsg:
		return m.handleStreamingHide(msg)
	case aiStreamPartialMsg:
		return m.handleAIStreamPartial(msg)
	case aiStreamHideMsg:
		return m.handleAIStreamHide()
	case followUpShowMsg:
		return m.handleFollowUpShow(msg)
	case followUpHideMsg:
		return m.handleFollowUpHide(msg)
	case reCommitMsg:
		return m.handleReCommit(msg)
	case reCommitDoneMsg:
		return m.handleReCommitDone(msg)
	case approvalReRenderMsg:
		return m.handleApprovalReRender(msg)
	case inputBarModeMsg:
		return m.handleInputBarMode(msg)
	case currentTaskMsg:
		m.currentTask = msg.task
		m.planDisplay = msg.planDisplay
		return m, nil
	case subAgentShowMsg:
		return m.handleSubAgentShow(msg)
	case subAgentUpdateMsg:
		return m.handleSubAgentUpdate(msg)
	case subAgentHideMsg:
		return m.handleSubAgentHide(msg)
	}
	return m, nil
}

func (m inlineBubbleModel) View() tea.View {
	// During a re-commit, tea.Raw is writing directly to the terminal.
	// Return empty so the renderer's cursor tracking is not disturbed.
	// Phase 2 (reCommitDoneMsg) clears this flag and the renderer
	// writes the composed view fresh at the current cursor position.
	if m.reCommitPending {
		return tea.NewView("")
	}

	// New path: composed layout with persistent input bar.
	if m.inputBarMode != inputBarHidden {
		return m.renderComposedView()
	}

	// Legacy path: flat priority switch (no persistent input bar).
	var content string
	switch {
	case m.approvalActive:
		content = m.approvalContent + approval.RenderMenu(m.approvalSelected, true)
	case m.streamingActive:
		if m.streamingProgressive {
			partial := m.streamingContent
			if m.streamingSubAgent != "" && partial != "" {
				partial = toolrender.GutterWrap(partial)
			}
			content = partial
		} else {
			content = formatStreamingView(
				m.streamingHeader, m.streamingContent, m.streamingSubAgent,
			)
		}
	case m.followUpActive:
		content = m.followUpContent
	case m.aiStreamActive:
		content = m.aiStreamPartial
	case m.subAgentActive:
		content = m.renderSubAgentLine()
	case !m.spinnerActive:
		content = ""
	default:
		content = m.renderSpinnerLine()
	}
	return tea.NewView(content)
}

// renderComposedView builds the composed View() layout for interactive mode.
// Transient content (spinner, streaming, approval, AI stream) is rendered
// above the persistent input bar. The input bar shows "esc to interrupt"
// when disabled or an active text input when the follow-up prompt is engaged.
//
// Layout (top to bottom):
//
//	[transient content]                      (optional: spinner/streaming/approval/AI)
//	  [-] Current task description           (optional: in_progress todo)
//	──────────────────────────── (full width)
//	> user input / esc to interrupt          (input area)
//	  enter send · ctrl+c exit               (hint, active mode only)
func (m inlineBubbleModel) renderComposedView() tea.View {
	var parts []string

	hasTransient := false
	if transient := m.renderTransientContent(); transient != "" {
		parts = append(parts, transient)
		hasTransient = true
	}

	if m.planDisplay != "" && !m.approvalActive {
		if hasTransient {
			parts = append(parts, "")
		}
		parts = append(parts, systemMsgStyle.Render(m.planDisplay))
	}

	parts = append(parts, m.renderSeparatorLine())

	// Count lines above the text input for cursor positioning.
	preInputLineCount := 0
	for _, p := range parts {
		preInputLineCount += strings.Count(p, "\n") + 1
	}

	switch {
	case m.inputBarMode == inputBarActive:
		parts = append(parts, m.textInput.View())
		parts = append(parts, followUpHintStyle.Render("  enter send · ctrl+c exit"))
	case m.approvalActive:
		// Separator only during approval; approval menu provides its own keys.
	default:
		parts = append(parts, followUpHintStyle.Render("  esc to interrupt"))
	}

	content := strings.Join(parts, "\n")
	v := tea.NewView(content)

	if m.inputBarMode == inputBarActive {
		if cursor := m.textInput.Cursor(); cursor != nil {
			cursor.Position.Y += preInputLineCount
			v.Cursor = cursor
		}
	}

	return v
}

// renderTransientContent returns the current transient content string for
// the top section of the composed View(). Returns "" when no transient
// content is active.
func (m inlineBubbleModel) renderTransientContent() string {
	switch {
	case m.approvalActive:
		return m.approvalContent + approval.RenderMenu(m.approvalSelected, true)
	case m.streamingActive:
		if m.streamingProgressive {
			partial := m.streamingContent
			if m.streamingSubAgent != "" && partial != "" {
				partial = toolrender.GutterWrap(partial)
			}
			return partial
		}
		return formatStreamingView(m.streamingHeader, m.streamingContent, m.streamingSubAgent)
	case m.aiStreamActive:
		return m.aiStreamPartial
	case m.subAgentActive:
		return m.renderSubAgentLine()
	case m.spinnerActive:
		return m.renderSpinnerLine()
	default:
		return ""
	}
}

// renderSeparatorLine returns a full-width separator line using the current
// terminal width.
func (m inlineBubbleModel) renderSeparatorLine() string {
	w := m.termWidth
	if w <= 0 {
		w = followUpSepWidth
	}
	return systemMsgStyle.Render(strings.Repeat("─", w))
}

// renderSpinnerLine returns the spinner display string with frame and elapsed
// time.
func (m inlineBubbleModel) renderSpinnerLine() string {
	frame := spinner.Frames[m.spinnerFrame%len(spinner.Frames)]
	elapsed := spinner.FormatElapsed(time.Since(m.spinnerStart))
	if elapsed != "" {
		return fmt.Sprintf("%s %s %s", frame, m.spinnerLabel, elapsed)
	}
	return fmt.Sprintf("%s %s", frame, m.spinnerLabel)
}

// ---------------------------------------------------------------------------
// Spinner update handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleSpinnerStart(msg spinnerStartMsg) (tea.Model, tea.Cmd) {
	m.spinnerActive = true
	m.spinnerFrame = 0
	m.spinnerLabel = msg.label
	m.spinnerStart = time.Now()
	return m, nextSpinnerTick()
}

func (m inlineBubbleModel) handleSpinnerStop() (tea.Model, tea.Cmd) {
	m.spinnerActive = false
	m.spinnerFrame = 0
	return m, nil
}

func (m inlineBubbleModel) handleSpinnerTick() (tea.Model, tea.Cmd) {
	if !m.spinnerActive {
		return m, nil
	}
	m.spinnerFrame++
	return m, nextSpinnerTick()
}

// nextSpinnerTick returns a Cmd that produces a spinnerTickMsg after one
// frame interval, continuing the tick chain.
func nextSpinnerTick() tea.Cmd {
	return tea.Tick(spinner.FrameInterval, func(time.Time) tea.Msg {
		return spinnerTickMsg{}
	})
}

// ---------------------------------------------------------------------------
// Approval update handlers
// ---------------------------------------------------------------------------

// handleApprovalStart activates the approval panel with a decision channel.
// The expanded content (separator + header + full file body + separator) is
// committed to scrollback via tea.Println so it is always visible regardless
// of terminal height. Only the question line remains in View(), keeping the
// interactive region to ≈6 rows (question + menu).
//
// Used when Bubbletea owns stdin — keystrokes are routed through
// handleKeyPress instead of the external PromptKeyOnly reader.
func (m inlineBubbleModel) handleApprovalStart(msg approvalStartMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = true
	m.approvalContent = msg.question + "\n"
	m.approvalSelected = 0
	m.approvalDecisionCh = msg.decisionCh
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	m.streamingProgressive = false
	m.streamingCommittedLen = 0
	m.aiStreamActive = false
	m.aiStreamPartial = ""

	if msg.reCommitPayload != "" {
		m.reCommitPending = true
		return m, buildReCommitCmd(msg.reCommitPayload)
	}
	var cmds []tea.Cmd
	if msg.expandedContent != "" {
		cmds = append(cmds, tea.Println(strings.TrimRight(msg.expandedContent, "\n")))
	}
	return m, tea.Batch(cmds...)
}

// handleApprovalShow activates the approval panel via the legacy path.
// Same split-commit approach as handleApprovalStart: expanded content goes
// to scrollback, question stays in View().
func (m inlineBubbleModel) handleApprovalShow(msg approvalShowMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = true
	m.approvalContent = msg.question + "\n"
	m.approvalSelected = 0
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	m.streamingProgressive = false
	m.streamingCommittedLen = 0
	m.aiStreamActive = false
	m.aiStreamPartial = ""

	if msg.reCommitPayload != "" {
		m.reCommitPending = true
		return m, buildReCommitCmd(msg.reCommitPayload)
	}
	var cmds []tea.Cmd
	if msg.expandedContent != "" {
		cmds = append(cmds, tea.Println(strings.TrimRight(msg.expandedContent, "\n")))
	}
	return m, tea.Batch(cmds...)
}

func (m inlineBubbleModel) handleApprovalSelect(msg approvalSelectMsg) (tea.Model, tea.Cmd) {
	m.approvalSelected = msg.selected
	return m, nil
}

func (m inlineBubbleModel) handleApprovalHide(msg approvalHideMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = false
	m.approvalContent = ""
	m.approvalSelected = 0
	m.approvalDecisionCh = nil
	if msg.collapsedResult != "" {
		return m, tea.Println(strings.TrimRight(msg.collapsedResult, "\n"))
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Streaming update handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleStreamingShow(msg streamingShowMsg) (tea.Model, tea.Cmd) {
	m.streamingActive = true
	m.streamingContent = ""
	m.streamingSubAgent = msg.subAgentID
	m.streamingProgressive = msg.progressive
	m.streamingCommittedLen = 0

	if msg.progressive {
		m.streamingHeader = ""
		return m, nil
	}

	m.streamingHeader = msg.header
	return m, nil
}

// handleStreamingHeaderUpdate replaces the header portion of the streaming
// view without resetting the accumulated content. Called when the tool's
// primary arg becomes available after the initial (empty-path) header.
//
// In progressive mode the header is already committed to scrollback and
// cannot be updated in-place. The approval re-commit will show the
// correct header, so the late update is silently ignored.
func (m inlineBubbleModel) handleStreamingHeaderUpdate(msg streamingHeaderUpdateMsg) (tea.Model, tea.Cmd) {
	if m.streamingProgressive {
		return m, nil
	}
	m.streamingHeader = msg.header
	return m, nil
}

func (m inlineBubbleModel) handleStreamingUpdate(msg streamingUpdateMsg) (tea.Model, tea.Cmd) {
	if !m.streamingProgressive {
		m.streamingContent = msg.content
		return m, nil
	}

	content := msg.content

	lastNewline := strings.LastIndex(content, "\n")
	var completeLen int
	if lastNewline >= 0 {
		completeLen = lastNewline + 1
	}

	m.streamingContent = content[completeLen:]

	if completeLen > m.streamingCommittedLen {
		newLines := content[m.streamingCommittedLen:completeLen]
		m.streamingCommittedLen = completeLen

		commitText := strings.TrimRight(newLines, "\n")
		if m.streamingSubAgent != "" {
			commitText = toolrender.GutterWrap(commitText)
		}
		if commitText != "" {
			return m, tea.Println(commitText)
		}
	}
	return m, nil
}

func (m inlineBubbleModel) handleStreamingHide(msg streamingHideMsg) (tea.Model, tea.Cmd) {
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	m.streamingSubAgent = ""
	m.streamingProgressive = false
	m.streamingCommittedLen = 0
	if msg.collapsedResult != "" {
		return m, tea.Println(strings.TrimRight(msg.collapsedResult, "\n"))
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Follow-up prompt update handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleFollowUpShow(msg followUpShowMsg) (tea.Model, tea.Cmd) {
	m.followUpActive = true
	m.followUpContent = msg.content
	return m, nil
}

func (m inlineBubbleModel) handleFollowUpHide(msg followUpHideMsg) (tea.Model, tea.Cmd) {
	m.followUpActive = false
	m.followUpContent = ""
	if msg.styledMessage != "" {
		return m, tea.Println(strings.TrimRight(msg.styledMessage, "\n"))
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// AI stream update handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleAIStreamPartial(msg aiStreamPartialMsg) (tea.Model, tea.Cmd) {
	m.aiStreamActive = true
	m.aiStreamPartial = msg.partial
	return m, nil
}

func (m inlineBubbleModel) handleAIStreamHide() (tea.Model, tea.Cmd) {
	m.aiStreamActive = false
	m.aiStreamPartial = ""
	return m, nil
}

// ---------------------------------------------------------------------------
// Sub-agent live summary handlers
// ---------------------------------------------------------------------------

func (m inlineBubbleModel) handleSubAgentShow(msg subAgentShowMsg) (tea.Model, tea.Cmd) {
	m.subAgentActive = true
	m.subAgentID = msg.id
	m.subAgentSubject = msg.subject
	m.subAgentToolCount = 0
	return m, nil
}

func (m inlineBubbleModel) handleSubAgentUpdate(msg subAgentUpdateMsg) (tea.Model, tea.Cmd) {
	if msg.id == m.subAgentID {
		m.subAgentToolCount = msg.toolCount
	}
	return m, nil
}

func (m inlineBubbleModel) handleSubAgentHide(msg subAgentHideMsg) (tea.Model, tea.Cmd) {
	if msg.id == m.subAgentID {
		m.subAgentActive = false
		m.subAgentID = ""
		m.subAgentSubject = ""
		m.subAgentToolCount = 0
	}
	return m, nil
}

// renderSubAgentLine returns the live sub-agent running summary.
//
//	"● Task: Explore CLI rendering code … (3 tools)"
func (m inlineBubbleModel) renderSubAgentLine() string {
	label := m.subAgentSubject
	if label == "" {
		label = "running"
	}
	return fmt.Sprintf("%s %s: %s %s (%d tools)",
		toolrender.BulletGreen("●"), toolrender.LabelBold("Task"),
		label, systemMsgStyle.Render("…"), m.subAgentToolCount)
}

// ---------------------------------------------------------------------------
// Text input update handlers
// ---------------------------------------------------------------------------

// handleTextInputStart activates the text input mode for follow-up prompts.
// Transitions the input bar from disabled to active, resets and focuses the
// embedded textinput so it accepts keystrokes. View() renders the composed
// layout with the real cursor positioned on the input line.
func (m inlineBubbleModel) handleTextInputStart(msg textInputStartMsg) (tea.Model, tea.Cmd) {
	m.inputBarMode = inputBarActive
	m.textInput.Reset()
	cmd := m.textInput.Focus()
	m.textInputCh = msg.inputCh
	return m, cmd
}

// handleTextInputHide transitions the input bar back to disabled mode after
// the user submits or cancels follow-up input. Clears the plan display and
// current task since a new execution is about to start.
func (m inlineBubbleModel) handleTextInputHide(msg textInputHideMsg) (tea.Model, tea.Cmd) {
	m.inputBarMode = inputBarDisabled
	m.textInput.Blur()
	m.textInput.Reset()
	m.textInputCh = nil
	m.currentTask = ""
	m.planDisplay = ""
	if msg.styledMessage != "" {
		return m, tea.Println(strings.TrimRight(msg.styledMessage, "\n"))
	}
	return m, nil
}

// handleInputBarMode transitions the input bar to the requested mode. Used
// by the event loop to disable the bar after session exit.
func (m inlineBubbleModel) handleInputBarMode(msg inputBarModeMsg) (tea.Model, tea.Cmd) {
	m.inputBarMode = msg.mode
	if msg.mode != inputBarActive {
		m.textInput.Blur()
		m.textInputCh = nil
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Re-commit handler
// ---------------------------------------------------------------------------

// handleReCommit clears all active visual states and starts a re-commit.
//
// Two strategies depending on whether a follow-up text input is active:
//
// Execution mode (inputBarActive == false): uses the two-phase tea.Raw
// approach. Phase 1 sets reCommitPending so View() returns empty while
// tea.Raw rewrites the terminal. Phase 2 (reCommitDoneMsg) restores
// View(). The tea.Raw write desyncs the renderer's cursor tracking, but
// this is acceptable because the view is small ("esc to interrupt") and
// the desync is corrected on the next full re-commit or resize.
//
// Follow-up mode (inputBarActive == true): uses renderer-aware operations
// (ClearScreen + Println) instead of tea.Raw. The tea.Raw approach
// permanently desyncs the renderer's relative cursor tracking, which
// causes the composed view (separator + text input + hint) to be written
// at a stale terminal position — making the entire input bar invisible.
// The renderer-aware path keeps cursor tracking in sync: ClearScreen
// resets tracking to (0,0), reCommitDoneMsg lets View() render the input
// bar there, then Println/insertAbove pushes it to the bottom.
func (m inlineBubbleModel) handleReCommit(msg reCommitMsg) (tea.Model, tea.Cmd) {
	m.spinnerActive = false
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	m.streamingProgressive = false
	m.streamingCommittedLen = 0
	m.aiStreamActive = false
	m.aiStreamPartial = ""
	m.followUpActive = false
	m.followUpContent = ""
	m.reCommitPending = true
	// Sub-agent live summary is not cleared — if a sub-agent is still
	// running after re-commit, its summary reappears in View().

	if m.inputBarMode == inputBarActive {
		return m, buildFollowUpReCommitCmd(msg.rendered)
	}
	return m, buildReCommitCmd(msg.rendered)
}

// handleReCommitDone is phase 2 of the re-commit. The tea.Raw write has
// completed and the terminal shows the updated history with the cursor
// at the bottom. Clearing reCommitPending lets View() produce the
// composed view again; the renderer writes it fresh below the history.
func (m inlineBubbleModel) handleReCommitDone(_ reCommitDoneMsg) (tea.Model, tea.Cmd) {
	m.reCommitPending = false
	return m, nil
}

// handleApprovalReRender refreshes the scrollback after an expand toggle
// during an active approval prompt. Unlike handleReCommit, it does NOT
// clear any transient state — the approval question, menu selection, and
// decision channel all remain intact so the user can continue approving.
// It uses the same two-phase approach to preserve the approval panel.
func (m inlineBubbleModel) handleApprovalReRender(msg approvalReRenderMsg) (tea.Model, tea.Cmd) {
	m.reCommitPending = true
	return m, buildReCommitCmd(msg.reCommitPayload)
}

// ---------------------------------------------------------------------------
// Streaming view formatter
// ---------------------------------------------------------------------------

// formatStreamingView builds the streaming display string for View() in
// non-progressive mode (post-approval shell streaming). Assembles the
// pre-rendered header with the full content, applying gutter-wrapping for
// sub-agent content. Pre-approval streaming uses progressive commit
// instead, so this function is only called for post-approval flows.
func formatStreamingView(header, content, subAgentID string) string {
	var b strings.Builder
	b.WriteString(header)
	if content != "" {
		b.WriteString(content)
	}
	result := b.String()
	if subAgentID != "" {
		return toolrender.GutterWrap(result)
	}
	return result
}
