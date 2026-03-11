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
	// todoTotal and todoCompleted provide summary counts for the plan
	// progress indicator shown above the separator in the composed View().
	// expandMode suppresses the plan section in View() when the full plan
	// is already visible in scrollback.
	currentTask   string
	todoTotal     int
	todoCompleted int
	expandMode    bool

	// activeSubAgentEntries holds the display state for all currently
	// running sub-agents. The live View() renders a stacked list (one
	// entry per sub-agent) so all parallel sub-agents are visible
	// simultaneously. Empty slice means no sub-agent is active.
	activeSubAgentEntries []subAgentDisplayEntry

	// subAgentSpinnerFrame drives the shared spinner animation across
	// all active sub-agent lines. The tick chain is started by the first
	// handleSubAgentShow and terminates when the slice becomes empty.
	subAgentSpinnerFrame int

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
	case inputBarModeMsg:
		return m.handleInputBarMode(msg)
	case currentTaskMsg:
		m.currentTask = msg.task
		m.todoTotal = msg.todoTotal
		m.todoCompleted = msg.todoCompleted
		return m, nil
	case subAgentShowMsg:
		return m.handleSubAgentShow(msg)
	case subAgentUpdateMsg:
		return m.handleSubAgentUpdate(msg)
	case subAgentHideMsg:
		return m.handleSubAgentHide(msg)
	case subAgentActivityMsg:
		return m.handleSubAgentActivity(msg)
	case subAgentTickMsg:
		return m.handleSubAgentTick()
	}
	return m, nil
}

func (m inlineBubbleModel) View() tea.View {
	// Composed layout with persistent input bar.
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
	case len(m.activeSubAgentEntries) > 0:
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
//	  Plan: 2/5 todos completed (ctrl+o …)  (optional: plan summary)
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

	if m.todoTotal > 0 && !m.approvalActive && !m.expandMode {
		if hasTransient {
			parts = append(parts, "")
		}
		if m.currentTask != "" {
			parts = append(parts, systemMsgStyle.Render("  [-] "+m.currentTask))
		}
		summary := fmt.Sprintf("  Plan: %d/%d todos completed", m.todoCompleted, m.todoTotal)
		summary += " " + expandHintStyle.Render("(ctrl+o to expand)")
		parts = append(parts, systemMsgStyle.Render(summary))
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
	case len(m.activeSubAgentEntries) > 0:
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
	wasEmpty := len(m.activeSubAgentEntries) == 0
	m.activeSubAgentEntries = append(m.activeSubAgentEntries, subAgentDisplayEntry{
		id:           msg.id,
		subject:      msg.subject,
		spinnerStart: time.Now(),
	})
	if wasEmpty {
		m.subAgentSpinnerFrame = 0
		return m, nextSubAgentTick()
	}
	return m, nil
}

func (m inlineBubbleModel) handleSubAgentUpdate(msg subAgentUpdateMsg) (tea.Model, tea.Cmd) {
	for i := range m.activeSubAgentEntries {
		if m.activeSubAgentEntries[i].id == msg.id {
			m.activeSubAgentEntries[i].toolCount = msg.toolCount
			break
		}
	}
	return m, nil
}

func (m inlineBubbleModel) handleSubAgentHide(msg subAgentHideMsg) (tea.Model, tea.Cmd) {
	for i, e := range m.activeSubAgentEntries {
		if e.id == msg.id {
			m.activeSubAgentEntries = append(m.activeSubAgentEntries[:i], m.activeSubAgentEntries[i+1:]...)
			break
		}
	}
	if len(m.activeSubAgentEntries) == 0 {
		m.subAgentSpinnerFrame = 0
	}
	return m, nil
}

func (m inlineBubbleModel) handleSubAgentActivity(msg subAgentActivityMsg) (tea.Model, tea.Cmd) {
	for i := range m.activeSubAgentEntries {
		if m.activeSubAgentEntries[i].id == msg.id {
			m.activeSubAgentEntries[i].activity = msg.activity
			break
		}
	}
	return m, nil
}

func (m inlineBubbleModel) handleSubAgentTick() (tea.Model, tea.Cmd) {
	if len(m.activeSubAgentEntries) == 0 {
		return m, nil
	}
	m.subAgentSpinnerFrame++
	now := time.Now()
	for i := range m.activeSubAgentEntries {
		m.activeSubAgentEntries[i].elapsedStr = spinner.FormatElapsed(now.Sub(m.activeSubAgentEntries[i].spinnerStart))
	}
	return m, nextSubAgentTick()
}

// subAgentTickInterval controls the refresh rate of the stacked sub-agent
// display. Slower than the main thinking spinner (80ms) because the
// sub-agent view spans many more terminal lines (~2 per active agent plus
// plan/separator/input bar). Reducing the redraw frequency from ~12.5/s to
// ~6.7/s significantly cuts terminal write volume and visible flicker.
const subAgentTickInterval = 150 * time.Millisecond

// nextSubAgentTick returns a Cmd that produces a subAgentTickMsg after one
// sub-agent tick interval, continuing the tick chain independently of the
// main thinking spinner.
func nextSubAgentTick() tea.Cmd {
	return tea.Tick(subAgentTickInterval, func(time.Time) tea.Msg {
		return subAgentTickMsg{}
	})
}

// renderSubAgentLine returns the live sub-agent running summary with an
// animated spinner and activity label. When multiple sub-agents are active,
// each gets its own two-line block, producing a stacked view:
//
//	"● Sub-agent: Scan auth0-webhooks dependencies (12 tools)"
//	"  ⠋ Grep… (3s)"
//	"● Sub-agent: Scan agent-runner dependencies (8 tools)"
//	"  ⠋ Thinking… (5s)"
func (m inlineBubbleModel) renderSubAgentLine() string {
	frame := spinner.Frames[m.subAgentSpinnerFrame%len(spinner.Frames)]
	lines := make([]string, 0, len(m.activeSubAgentEntries))
	for _, e := range m.activeSubAgentEntries {
		label := toolrender.Truncate(toolrender.FirstLine(e.subject), 80)
		if label == "" {
			label = "running"
		}
		header := fmt.Sprintf("%s %s: %s",
			toolrender.BulletGreen("●"), toolrender.LabelBold("Sub-agent"), label)
		if e.toolCount > 0 {
			header += fmt.Sprintf(" (%d tools)", e.toolCount)
		}

		activityLabel := "Working"
		if e.activity != "" {
			activityLabel = e.activity
		}
		activity := fmt.Sprintf("  %s %s", frame, systemMsgStyle.Render(activityLabel+"…"))
		if e.elapsedStr != "" {
			activity += " " + e.elapsedStr
		}
		lines = append(lines, header+"\n"+activity)
	}
	return strings.Join(lines, "\n")
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
// the user submits or cancels follow-up input. Clears the current task
// since a new execution is about to start.
func (m inlineBubbleModel) handleTextInputHide(msg textInputHideMsg) (tea.Model, tea.Cmd) {
	m.inputBarMode = inputBarDisabled
	m.textInput.Blur()
	m.textInput.Reset()
	m.textInputCh = nil
	m.currentTask = ""
	m.todoTotal = 0
	m.todoCompleted = 0
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
