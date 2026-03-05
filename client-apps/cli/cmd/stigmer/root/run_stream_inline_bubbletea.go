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
// Rendering priority in View(): approval > streaming > textInput > followUp > spinner > empty.
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

	streamingActive      bool
	streamingHeader      string
	streamingContent     string
	streamingSubAgent    string
	streamingProgressive bool // pre-approval: commit lines to scrollback progressively
	streamingCommittedLen int // bytes of content already committed to scrollback

	// AI streaming state — when active, View() renders the partial
	// (incomplete) line being typed by the model. Complete lines are
	// committed to scrollback via program.Println before the partial is
	// updated, so View() only ever shows the current in-progress line.
	aiStreamActive  bool
	aiStreamPartial string

	followUpActive  bool
	followUpContent string // pre-rendered prompt (separator + hint + marker)

	// Text input state for follow-up prompts when Bubbletea owns stdin.
	// The textinput.Model handles cursor movement, word navigation, and
	// paste; View() composes it into the separator/hint layout and
	// positions the real terminal cursor via tea.View.Cursor.
	textInputActive bool
	textInput       textinput.Model
	textInputCh     chan<- string // delivers final input on Enter

	// termWidth holds the terminal width in columns, updated via
	// tea.WindowSizeMsg. Used to render the full-width separator in
	// the follow-up prompt.
	termWidth int

	// Channels for communicating with the event loop goroutine. Set during
	// model initialization when Bubbletea owns stdin. nil otherwise.
	toggleExpandCh chan<- struct{}
	cancelCh       chan<- struct{}
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
		textInput: newFollowUpTextInput(),
	}
}

// newInlineBubbleModelWithChannels creates a model wired to the event loop
// via channels. Used when Bubbletea owns stdin and processes keystrokes.
func newInlineBubbleModelWithChannels(toggleCh chan<- struct{}, cancelCh chan<- struct{}) inlineBubbleModel {
	return inlineBubbleModel{
		textInput:      newFollowUpTextInput(),
		toggleExpandCh: toggleCh,
		cancelCh:       cancelCh,
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
		if m.textInputActive {
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
	}
	return m, nil
}

func (m inlineBubbleModel) View() tea.View {
	if m.textInputActive {
		return m.renderTextInputView()
	}

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
	case !m.spinnerActive:
		content = ""
	default:
		frame := spinner.Frames[m.spinnerFrame%len(spinner.Frames)]
		elapsed := spinner.FormatElapsed(time.Since(m.spinnerStart))
		if elapsed != "" {
			content = fmt.Sprintf("%s %s %s", frame, m.spinnerLabel, elapsed)
		} else {
			content = fmt.Sprintf("%s %s", frame, m.spinnerLabel)
		}
	}
	return tea.NewView(content)
}

// renderTextInputView builds the follow-up prompt View with cursor
// positioning. Layout (top to bottom):
//
//	[blank line]                            Y=0
//	───────────────────────── (full width)  Y=1
//	> user input here         (cursor)      Y=2
//	  enter send · ctrl+c exit (hint)       Y=3
//
// The real terminal cursor (blinking bar) is provided by
// textinput.Cursor() and offset to the input line (Y+2).
func (m inlineBubbleModel) renderTextInputView() tea.View {
	sepWidth := m.termWidth
	if sepWidth <= 0 {
		sepWidth = followUpSepWidth
	}
	sep := systemMsgStyle.Render(strings.Repeat("─", sepWidth))
	inputLine := m.textInput.View()
	hint := followUpHintStyle.Render("  enter send · ctrl+c exit")
	content := fmt.Sprintf("\n%s\n%s\n%s", sep, inputLine, hint)

	v := tea.NewView(content)
	if cursor := m.textInput.Cursor(); cursor != nil {
		cursor.Position.Y += 2 // blank line (Y=0) + separator (Y=1)
		v.Cursor = cursor
	}
	return v
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
		header := strings.TrimRight(msg.header, "\n")
		if msg.subAgentID != "" {
			header = toolrender.GutterWrap(header)
		}
		return m, tea.Println(header)
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
	var partial string
	if lastNewline >= 0 {
		completeLen = lastNewline + 1
		partial = content[completeLen:]
	} else {
		partial = content
	}

	m.streamingContent = partial

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
// Text input update handlers
// ---------------------------------------------------------------------------

// handleTextInputStart activates the text input mode for follow-up prompts.
// Resets and focuses the embedded textinput so it accepts keystrokes.
// View() renders the composed layout (separator + textinput + hint) with
// the real cursor positioned on the input line.
func (m inlineBubbleModel) handleTextInputStart(msg textInputStartMsg) (tea.Model, tea.Cmd) {
	m.textInputActive = true
	m.textInput.Reset()
	cmd := m.textInput.Focus()
	m.textInputCh = msg.inputCh
	return m, cmd
}

func (m inlineBubbleModel) handleTextInputHide(msg textInputHideMsg) (tea.Model, tea.Cmd) {
	m.textInputActive = false
	m.textInput.Blur()
	m.textInput.Reset()
	m.textInputCh = nil
	if msg.styledMessage != "" {
		return m, tea.Println(strings.TrimRight(msg.styledMessage, "\n"))
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// Re-commit handler
// ---------------------------------------------------------------------------

// handleReCommit clears all active visual states so View() returns ""
// during the renderer flush that follows the Raw write. Without this,
// stale streaming/approval/spinner content would be rendered on top of
// the freshly-written history.
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
	return m, buildReCommitCmd(msg.rendered)
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
