package root

import (
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
)

// Messages sent from the event loop to the Bubbletea program via Send().
// Each message type maps to a handler in inlineBubbleModel.Update.

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
// frame.
//
// expandedContent (separator + header + full file content + separator) is
// committed to scrollback via tea.Println so it is always visible and not
// constrained by terminal height. Only the question line lives in View(),
// keeping the interactive region small (question + menu ≈ 6 rows).
//
// Used by the legacy PromptKeyOnly path when Bubbletea does not own stdin.
// The channel-based stdin path uses approvalStartMsg.
type approvalShowMsg struct {
	expandedContent string // full content for tea.Println (scrollback)
	question        string // question line for View()
}

// approvalSelectMsg updates the menu selection index. The event loop sends
// this from the key reading loop when the user presses an arrow key.
//
// Used by the program==nil fallback path (direct-write) and retained for
// backward compatibility. The Bubbletea stdin path routes arrow keys
// through handleKeyPress.
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

// approvalStartMsg activates the approval panel and establishes a channel
// for the model to deliver the user's decision back to the event loop.
//
// expandedContent is committed to scrollback via tea.Println so the full
// file content is always visible regardless of terminal height. Only the
// question line lives in View(), keeping the interactive region small.
//
// The event loop creates the channel, sends this message, then blocks on
// the channel. handleKeyPress routes arrow/enter/esc keys to the channel
// when approvalActive is true.
type approvalStartMsg struct {
	expandedContent string                 // full content for tea.Println (scrollback)
	question        string                 // question line for View()
	decisionCh      chan<- approvalDecision
}

// approvalDecision carries the user's approval choice from the model back
// to the event loop goroutine via the channel in approvalStartMsg.
type approvalDecision struct {
	action approval.Action
	err    error
}

// textInputStartMsg activates the text input mode for follow-up prompts.
// The follow-up loop creates the channel, sends this message, then blocks
// on the channel. handleKeyPress accumulates runes in textInputBuffer and
// delivers the final string on Enter.
type textInputStartMsg struct {
	prompt  string
	inputCh chan<- string
}

// textInputHideMsg deactivates text input mode. View() returns "" on the
// next render, causing Bubbletea to erase the prompt area. When
// styledMessage is non-empty, Update returns a tea.Println Cmd to commit
// the formatted user message.
type textInputHideMsg struct {
	styledMessage string
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

// streamingHeaderUpdateMsg updates the header portion of the streaming view
// without resetting the accumulated content. Sent when the tool's primary
// arg (e.g. file path) becomes available in a later ToolStreamDeltaEvent
// after the initial header was rendered with an empty primary arg.
type streamingHeaderUpdateMsg struct {
	header string
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
//
// Used by the legacy promptFollowUpViaKeyReader path when Bubbletea does not
// own stdin. The channel-based path uses textInputStartMsg instead.
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

// reCommitMsg carries a pre-rendered string of the full session history.
// The renderer owns rendering (via renderHistoryBatch); the model just
// issues ClearScreen + Println(rendered). This reduces N+1 event-loop
// round-trips to 2 and eliminates visible flicker on toggle.
type reCommitMsg struct {
	rendered string
}

// aiStreamPartialMsg updates the partial (incomplete) line shown in View()
// during AI text streaming. Sent on every delta so the user sees
// character-level feedback. View() renders this as the live typing line
// at the terminal bottom. Complete lines are committed separately via
// program.Println before this message is sent.
type aiStreamPartialMsg struct {
	partial string
}

// aiStreamHideMsg clears the AI streaming state from the model. Sent when
// the stream ends normally or is interrupted by a non-AI event. View()
// returns "" on the next render, allowing the spinner or other content to
// take the View() slot.
type aiStreamHideMsg struct{}
