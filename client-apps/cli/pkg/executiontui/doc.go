// Package executiontui provides a Bubbletea-based interactive TUI for displaying
// agent execution output in real-time.
//
// The TUI runs in alt-screen mode during execution, providing a scrollable viewport
// with auto-follow for new content. When Config.FollowUpFn is set, the TUI enters
// conversational mode: after an execution completes, an input composer activates
// and the user can send follow-up messages that create new executions within the
// same session. The conversation continues seamlessly in the same viewport.
//
// When FollowUpFn is nil, the TUI behaves as a single-execution viewer: it exits
// after the execution completes (or the user quits).
//
// This package accepts domain-agnostic input types — callers convert from proto or
// other sources into the Event types defined here. The same pattern is used by the
// sibling toolrender package.
//
// Usage:
//
//	events := make(chan executiontui.Event, 16)
//	model := executiontui.New(executiontui.Config{
//	    ExecutionID: "aex-01abc...",
//	    Events:      events,
//	    FollowUpFn:  myFollowUpFn,  // nil for single-execution mode
//	})
//	p := tea.NewProgram(model, tea.WithAltScreen())
//	go sendEvents(stream, events)  // gRPC goroutine
//	finalModel, err := p.Run()
package executiontui
