package root

import "github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"

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

// reCommitMsg carries a snapshot of the renderer's history for full terminal
// reconstruction. The model handles this by returning tea.Sequence(ClearScreen,
// Println, Println, ...) to atomically clear and replay all committed output.
// Sent by the renderer when the session header subject is resolved or (future)
// the user toggles compact/expanded mode.
type reCommitMsg struct {
	items       []committedItem
	compactOpts toolrender.CompactOptions
	expanded    bool
}
