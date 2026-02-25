package executiontui

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// subjectFetchBackoff is the series of delays used between successive
// background polls for the session subject. The first poll is scheduled
// immediately at TUI init (after 3 s); these delays govern retries.
// Three total attempts means the TUI gives up after ~18 s of polling
// without silently hammering the backend.
var subjectFetchBackoff = []time.Duration{5 * time.Second, 10 * time.Second}

// subjectFetchedMsg carries the result of a background session-subject poll.
// An empty Subject means the backend has not yet replaced the sentinel with
// a real title; the TUI will schedule the next retry if attempts remain.
type subjectFetchedMsg struct {
	subject string
}

// scheduleSubjectFetch returns a tea.Cmd that waits delay then calls fn and
// wraps the result in a subjectFetchedMsg.
func scheduleSubjectFetch(delay time.Duration, fn func() string) tea.Cmd {
	return func() tea.Msg {
		time.Sleep(delay)
		return subjectFetchedMsg{subject: fn()}
	}
}

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

// activityTickMsg is a periodic timer message used to detect idle periods
// during execution. When no execution events arrive for longer than the
// idle threshold, the TUI activates the thinking indicator (animated spinner
// in the header) to signal that the agent is alive and processing.
type activityTickMsg struct{}

// followUpStartedMsg is sent when FollowUpFn successfully creates a new
// execution. It carries the new channels and cancel function that the model
// uses to stream the follow-up execution.
type followUpStartedMsg struct {
	result *FollowUpResult
}

// followUpErrorMsg is sent when FollowUpFn fails to create a new execution.
// The TUI shows the error and reactivates the input composer so the user can
// retry or exit.
type followUpErrorMsg struct {
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
