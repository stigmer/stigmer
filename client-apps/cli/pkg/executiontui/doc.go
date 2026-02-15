// Package executiontui provides a Bubbletea-based interactive TUI for displaying
// agent execution output in real-time.
//
// The TUI runs in alt-screen mode during execution, providing a scrollable viewport
// with auto-follow for new content. After the execution completes (or the user exits),
// the TUI exits and the caller prints a summary to inline stdout.
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
//	})
//	p := tea.NewProgram(model, tea.WithAltScreen())
//	go sendEvents(stream, events)  // gRPC goroutine
//	finalModel, err := p.Run()
package executiontui
