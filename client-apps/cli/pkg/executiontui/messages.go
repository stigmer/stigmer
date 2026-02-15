package executiontui

import tea "github.com/charmbracelet/bubbletea"

// executionEventMsg wraps an Event received from the gRPC stream goroutine.
// The channel listener returns this as a tea.Msg so the model's Update method
// can dispatch on the concrete Event type.
type executionEventMsg struct {
	event Event
}

// streamClosedMsg signals that the events channel was closed.
// This happens when the gRPC goroutine finishes (success or error).
type streamClosedMsg struct{}

// cancelResultMsg carries the result of an asynchronous cancel API call.
// A nil err means the cancel request was accepted by the backend; the
// execution will transition to CANCELLED via the stream. A non-nil err
// means the cancel failed and the TUI should inform the user.
type cancelResultMsg struct {
	err error
}

// listenForEvents returns a tea.Cmd that blocks on the events channel and
// delivers the next Event as an executionEventMsg. When the channel is closed,
// it returns a streamClosedMsg.
//
// This is the standard Bubbletea pattern for integrating channel-based producers
// with the Update loop. The model re-issues this command after each event to
// keep listening.
func listenForEvents(ch <-chan Event) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-ch
		if !ok {
			return streamClosedMsg{}
		}
		return executionEventMsg{event: event}
	}
}
