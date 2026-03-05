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

	streamingActive   bool
	streamingHeader   string
	streamingContent  string
	streamingMaxLines int
	streamingSubAgent string
	streamingWidth    int

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
		content = m.approvalContent + approval.RenderMenuForView(m.approvalSelected)
	case m.streamingActive:
		content = formatStreamingView(
			m.streamingHeader, m.streamingContent, m.streamingSubAgent,
			m.streamingMaxLines, m.streamingWidth,
		)
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
	m.streamingHeader = msg.header
	m.streamingContent = ""
	m.streamingMaxLines = msg.maxLines
	m.streamingSubAgent = msg.subAgentID
	m.streamingWidth = msg.width
	return m, nil
}

// handleStreamingHeaderUpdate replaces the header portion of the streaming
// view without resetting the accumulated content. Called when the tool's
// primary arg becomes available after the initial (empty-path) header.
func (m inlineBubbleModel) handleStreamingHeaderUpdate(msg streamingHeaderUpdateMsg) (tea.Model, tea.Cmd) {
	m.streamingHeader = msg.header
	return m, nil
}

func (m inlineBubbleModel) handleStreamingUpdate(msg streamingUpdateMsg) (tea.Model, tea.Cmd) {
	m.streamingContent = msg.content
	return m, nil
}

func (m inlineBubbleModel) handleStreamingHide(msg streamingHideMsg) (tea.Model, tea.Cmd) {
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	m.streamingMaxLines = 0
	m.streamingSubAgent = ""
	m.streamingWidth = 0
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

func (m inlineBubbleModel) handleReCommit(msg reCommitMsg) (tea.Model, tea.Cmd) {
	return m, buildReCommitCmd(msg.rendered)
}

// ---------------------------------------------------------------------------
// Streaming view formatter
// ---------------------------------------------------------------------------

// formatStreamingView builds the streaming display string for View().
// Assembles the pre-rendered header with formatted content. When maxLines
// is positive (pre-approval streaming), each line is width-clamped and the
// total is capped with a truncation indicator. When maxLines is zero
// (post-approval streaming), content flows unmodified. Sub-agent content
// is gutter-wrapped.
func formatStreamingView(header, content, subAgentID string, maxLines, width int) string {
	var b strings.Builder
	b.WriteString(header)

	if content == "" {
		result := b.String()
		if subAgentID != "" {
			return toolrender.GutterWrap(result)
		}
		return result
	}

	if maxLines > 0 && width > 0 {
		maxVisibleWidth := width - 1
		if subAgentID != "" {
			maxVisibleWidth = width - 1 - toolrender.GutterWidth()
		}

		totalNewlines := strings.Count(content, "\n")
		lines := strings.Split(content, "\n")
		displayed := 0
		for i, line := range lines {
			if i > 0 {
				b.WriteByte('\n')
				displayed++
				if displayed >= maxLines {
					overflow := totalNewlines - maxLines
					if overflow < 0 {
						overflow = 0
					}
					b.WriteString(toolrender.StreamTruncationIndicator(overflow))
					break
				}
			}
			b.WriteString(truncateLineWidth(line, maxVisibleWidth))
		}
	} else {
		b.WriteString(content)
	}

	result := b.String()
	if subAgentID != "" {
		return toolrender.GutterWrap(result)
	}
	return result
}
