// Package executiontui defines the event types and shared data structures
// used by agent execution rendering pipelines.
//
// The Event interface and its concrete implementations represent all state
// changes that occur during an agent execution — AI messages, tool calls,
// phase transitions, approval requests, sub-agent lifecycle, and errors.
//
// These types are consumed by multiple rendering modes:
//   - Inline renderer (streaming text in normal terminal scrollback)
//   - JSON renderer (newline-delimited JSON for scripting/CI)
//
// The event channel pattern decouples the gRPC stream producer (streamToEvents)
// from the rendering consumer. Any new rendering mode only needs to implement
// a consumer of chan Event.
//
// This package also defines FollowUpFn and FollowUpResult, which enable
// conversational follow-up within a session. The inline renderer uses these
// to prompt for continued conversation after execution completion.
package executiontui
