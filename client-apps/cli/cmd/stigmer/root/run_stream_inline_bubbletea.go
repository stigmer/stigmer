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
// Messages — sent from the event loop to the Bubbletea program via Send()
// ---------------------------------------------------------------------------

// spinnerStartMsg tells the model to activate the spinner with the given label.
// The event loop sends this when the 2-second idle timer fires.
type spinnerStartMsg struct{ label string }

// spinnerStopMsg tells the model to deactivate the spinner. The event loop
// sends this before processing any incoming event.
type spinnerStopMsg struct{}

// spinnerTickMsg is the self-propagating tick that advances the spinner frame.
// Each tick returns the next tick as a Cmd, forming a chain that runs until
// the spinner is stopped.
type spinnerTickMsg struct{}

// approvalShowMsg tells the model to render the approval panel in View().
// When streaming was active, handleApprovalShow atomically clears the
// streaming state so the panel replaces it without an intermediate empty
// frame. The content field contains the pre-rendered expanded view +
// question; the menu is rendered by View() using the selected index.
type approvalShowMsg struct {
	content string
}

// approvalSelectMsg updates the menu selection index. The event loop sends
// this from the key reading loop when the user presses an arrow key.
type approvalSelectMsg struct {
	selected int
}

// approvalHideMsg tells the model to deactivate the approval panel. View()
// returns "" on the next render, causing Bubbletea to erase the panel.
// When collapsedResult is non-empty, Update returns a tea.Println Cmd to
// commit the collapsed one-liner above the (now empty) View region.
type approvalHideMsg struct {
	collapsedResult string
}

// streamingShowMsg tells the model to render streaming content in View().
// The event loop sends this when pre-approval or post-approval streaming
// begins. The header is pre-rendered (separator + tool header); content
// arrives via subsequent streamingUpdateMsg messages.
type streamingShowMsg struct {
	header     string
	subAgentID string
	maxLines   int // 0 = uncapped (post-approval), >0 = capped (pre-approval)
	width      int // terminal width for line-clamping in View()
}

// streamingUpdateMsg delivers the full accumulated content for the active
// streaming tool. The model stores the raw content; View() handles
// formatting (width-clamping, line-capping, truncation indicator).
type streamingUpdateMsg struct {
	content string
}

// streamingHideMsg tells the model to deactivate streaming. View() returns
// "" on the next render, causing Bubbletea to erase the streaming content.
// When collapsedResult is non-empty, Update returns a tea.Println Cmd to
// commit the compact result above the (now empty) View region.
type streamingHideMsg struct {
	collapsedResult string
}

// followUpShowMsg tells the model to render the follow-up prompt in View().
// The follow-up loop sends this after an execution completes and the user is
// eligible to continue the conversation. The content field is the pre-rendered
// prompt string (separator + hint + marker).
type followUpShowMsg struct {
	content string
}

// followUpHideMsg tells the model to deactivate the follow-up prompt. View()
// returns "" on the next render, causing Bubbletea to erase the prompt area.
// When styledMessage is non-empty, Update returns a tea.Println Cmd to commit
// the formatted user message above the (now empty) View region.
type followUpHideMsg struct {
	styledMessage string
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// inlineBubbleModel is the Bubbletea model for the inline renderer. The
// tea.Program running this model owns the stderr writer via tea.WithOutput,
// giving Bubbletea accurate row tracking for all content committed through
// Program.Println.
//
// Rendering priority in View(): approval > streaming > followUp > spinner > empty.
type inlineBubbleModel struct {
	spinnerActive bool
	spinnerFrame  int
	spinnerLabel  string
	spinnerStart  time.Time

	approvalActive   bool
	approvalContent  string // pre-rendered expanded view + question
	approvalSelected int

	streamingActive   bool
	streamingHeader   string
	streamingContent  string
	streamingMaxLines int
	streamingSubAgent string
	streamingWidth    int

	followUpActive  bool
	followUpContent string // pre-rendered prompt (separator + hint + marker)
}

func newInlineBubbleModel() inlineBubbleModel {
	return inlineBubbleModel{}
}

func (m inlineBubbleModel) Init() tea.Cmd {
	return nil
}

func (m inlineBubbleModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case spinnerStartMsg:
		return m.handleSpinnerStart(msg)
	case spinnerStopMsg:
		return m.handleSpinnerStop()
	case spinnerTickMsg:
		return m.handleSpinnerTick()
	case approvalShowMsg:
		return m.handleApprovalShow(msg)
	case approvalSelectMsg:
		return m.handleApprovalSelect(msg)
	case approvalHideMsg:
		return m.handleApprovalHide(msg)
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
