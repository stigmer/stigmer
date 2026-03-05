package root

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

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
	approvalContent  string // pre-rendered expanded view + question
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

	followUpActive  bool
	followUpContent string // pre-rendered prompt (separator + hint + marker)

	// Text input state for follow-up prompts when Bubbletea owns stdin.
	textInputActive bool
	textInputBuffer string
	textInputPrompt string       // pre-rendered prompt portion
	textInputCh     chan<- string // delivers final input on Enter

	// Channels for communicating with the event loop goroutine. Set during
	// model initialization when Bubbletea owns stdin. nil otherwise.
	toggleExpandCh chan<- struct{}
	cancelCh       chan<- struct{}
}

func newInlineBubbleModel() inlineBubbleModel {
	return inlineBubbleModel{}
}

// newInlineBubbleModelWithChannels creates a model wired to the event loop
// via channels. Used when Bubbletea owns stdin and processes keystrokes.
func newInlineBubbleModelWithChannels(toggleCh chan<- struct{}, cancelCh chan<- struct{}) inlineBubbleModel {
	return inlineBubbleModel{
		toggleExpandCh: toggleCh,
		cancelCh:       cancelCh,
	}
}

func (m inlineBubbleModel) Init() tea.Cmd {
	return nil
}

func (m inlineBubbleModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.handleKeyPress(msg)
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
	case streamingUpdateMsg:
		return m.handleStreamingUpdate(msg)
	case streamingHideMsg:
		return m.handleStreamingHide(msg)
	case followUpShowMsg:
		return m.handleFollowUpShow(msg)
	case followUpHideMsg:
		return m.handleFollowUpHide(msg)
	case reCommitMsg:
		return m.handleReCommit(msg)
	}
	return m, nil
}

func (m inlineBubbleModel) View() string {
	if m.approvalActive {
		return m.approvalContent + approval.RenderMenu(m.approvalSelected)
	}
	if m.streamingActive {
		return formatStreamingView(
			m.streamingHeader, m.streamingContent, m.streamingSubAgent,
			m.streamingMaxLines, m.streamingWidth,
		)
	}
	if m.textInputActive {
		return m.textInputPrompt + m.textInputBuffer
	}
	if m.followUpActive {
		return m.followUpContent
	}
	if !m.spinnerActive {
		return ""
	}
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
// Used when Bubbletea owns stdin — keystrokes are routed through
// handleKeyPress instead of the external PromptKeyOnly reader.
func (m inlineBubbleModel) handleApprovalStart(msg approvalStartMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = true
	m.approvalContent = msg.content
	m.approvalSelected = 0
	m.approvalDecisionCh = msg.decisionCh
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	return m, nil
}

func (m inlineBubbleModel) handleApprovalShow(msg approvalShowMsg) (tea.Model, tea.Cmd) {
	m.approvalActive = true
	m.approvalContent = msg.content
	m.approvalSelected = 0
	m.streamingActive = false
	m.streamingHeader = ""
	m.streamingContent = ""
	return m, nil
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
// Text input update handlers
// ---------------------------------------------------------------------------

// handleTextInputStart activates the text input mode for follow-up prompts.
// View() renders the prompt + accumulated buffer. Keystrokes are routed
// through handleTextInputKey until Enter or Ctrl+C/D delivers the result.
func (m inlineBubbleModel) handleTextInputStart(msg textInputStartMsg) (tea.Model, tea.Cmd) {
	m.textInputActive = true
	m.textInputBuffer = ""
	m.textInputPrompt = msg.prompt
	m.textInputCh = msg.inputCh
	return m, nil
}

func (m inlineBubbleModel) handleTextInputHide(msg textInputHideMsg) (tea.Model, tea.Cmd) {
	m.textInputActive = false
	m.textInputBuffer = ""
	m.textInputPrompt = ""
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
	return m, reCommitHistory(msg.items, msg.compactOpts, msg.expanded)
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
