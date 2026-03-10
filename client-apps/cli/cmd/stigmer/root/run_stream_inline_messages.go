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

// approvalSelectMsg updates the menu selection index. Sent by the legacy
// promptApprovalViaKeyReader path (PromptKeyOnly) when the user presses
// an arrow key. The channel-based stdin path (promptApprovalViaChannel)
// routes arrow keys through handleApprovalKey instead.
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
	expandedContent string // full content for tea.Println (scrollback)
	question        string // question line for View()
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
// on the channel. View() renders the prompt dynamically using model state
// (termWidth for separator, cursor positioning on input line).
// handleTextInputKey delegates to the embedded textinput.Model for cursor
// movement, word navigation, and character input, delivering the final
// string via the channel on Enter.
type textInputStartMsg struct {
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
//
// When progressive is true (pre-approval), the header and subsequent
// complete lines are committed to scrollback via tea.Println as they
// arrive. View() shows only the current partial (incomplete) line. This
// avoids the Bubbletea inline-mode overflow problem where a View() taller
// than the terminal causes scrollback artifacts.
//
// When progressive is false (post-approval shell streaming), the header
// and content remain in View() for live replacement on each delta.
type streamingShowMsg struct {
	header      string
	subAgentID  string
	progressive bool // true = commit lines to scrollback progressively
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

// inputBarModeMsg transitions the persistent input bar between states.
// Sent by the event loop to control whether the input bar is hidden,
// disabled (showing "esc to interrupt"), or active (text input with cursor).
type inputBarModeMsg struct{ mode inputBarMode }

// currentTaskMsg updates the plan progress indicator shown above the
// input bar separator. task is the content of the first in_progress todo
// item (empty when all are done). todoTotal and todoCompleted provide
// the summary counts. The full plan is stored in history and rendered
// in scrollback when expanded mode is active (Ctrl+O).
type currentTaskMsg struct {
	task          string
	todoTotal     int
	todoCompleted int
}

// subAgentShowMsg activates the live sub-agent running summary in View().
// Sent when a SubAgentStartedEvent is processed. The subject is the short
// display label; View() renders "● Task: subject … (N tools)".
type subAgentShowMsg struct {
	id      string
	subject string
}

// subAgentUpdateMsg updates the running tool count for the live sub-agent
// summary in View(). Sent each time a tool completion is routed to the
// active sub-agent block's children.
type subAgentUpdateMsg struct {
	id        string
	toolCount int
}

// subAgentHideMsg clears the live sub-agent summary from View(). Sent
// when a SubAgentCompletedEvent is processed and the finalized block
// is committed to scrollback.
type subAgentHideMsg struct {
	id string
}

// subAgentActivityMsg updates the activity label on the running sub-agent
// line in View(). Sent by the event loop when a sub-agent's AI begins
// streaming (activity="Thinking"), a tool starts running (activity=tool
// name), or the current phase ends (activity="" reverts to "Working").
// The model resets the elapsed timer on each activity change so the user
// sees per-phase durations.
type subAgentActivityMsg struct {
	id       string
	activity string
}

// subAgentTickMsg is the self-propagating tick that advances the sub-agent
// spinner frame. Analogous to spinnerTickMsg but fully independent — it
// uses its own model fields and terminates when activeSubAgentEntries is empty.
type subAgentTickMsg struct{}
