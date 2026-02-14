package root

import (
	"fmt"
	"io"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// messageStreamRenderer displays agent messages with delta-based streaming for
// AI responses. Instead of dumping complete messages after they finish, it prints
// AI content incrementally as the backend streams tokens (~500ms update bursts).
//
// Two pieces of state drive the rendering:
//   - displayedCount: how many messages have been fully rendered
//   - streamedBytes: how many bytes of the current streaming AI message have been printed
//
// On each call to render(), the renderer computes the content delta for in-progress
// AI messages and prints only the new characters. Non-AI messages and completed AI
// messages are rendered in full immediately.
type messageStreamRenderer struct {
	w              io.Writer
	displayedCount int
	streamedBytes  int
	inStream       bool // true while an AI message is being streamed incrementally
}

// newMessageStreamRenderer creates a renderer that writes all output to w.
// In production, w is os.Stdout. In tests, w can be a bytes.Buffer.
func newMessageStreamRenderer(w io.Writer) *messageStreamRenderer {
	return &messageStreamRenderer{w: w}
}

// render processes the latest messages slice and displays any new content.
// Returns two flags:
//   - rendered: true if any output was produced (caller should stop spinner)
//   - streaming: true if an AI message is currently being streamed (caller should
//     NOT restart spinner — the flowing text itself is the progress indicator)
func (r *messageStreamRenderer) render(messages []*agentexecutionv1.AgentMessage) (rendered, streaming bool) {
	// Phase 1: If we're mid-stream on an AI message, handle the delta or finalization.
	if r.inStream && r.displayedCount < len(messages) {
		msg := messages[r.displayedCount]
		if msg.IsStreaming {
			rendered = r.printDelta(msg.Content)
			return rendered, true
		}
		// Streaming ended — print remaining content and finalize.
		r.finalizeAIStream(msg)
		r.inStream = false
		r.streamedBytes = 0
		r.displayedCount++
		rendered = true
	}

	// Phase 2: Render complete messages and detect new streaming AI messages.
	for r.displayedCount < len(messages) {
		msg := messages[r.displayedCount]

		// New streaming AI message — begin incremental display.
		if msg.IsStreaming && msg.Type == agentexecutionv1.MessageType_MESSAGE_AI {
			r.beginAIStream(msg)
			return true, true
		}

		// Complete message — render in full.
		r.writeCompleteMessage(msg)
		r.displayedCount++
		rendered = true
	}

	return rendered, false
}

// beginAIStream prints the AI message prefix and any initial content available.
// Subsequent content will be appended by printDelta on future render() calls.
func (r *messageStreamRenderer) beginAIStream(msg *agentexecutionv1.AgentMessage) {
	fmt.Fprint(r.w, "🤖 Agent: ")
	if len(msg.Content) > 0 {
		fmt.Fprint(r.w, msg.Content)
	}
	r.streamedBytes = len(msg.Content)
	r.inStream = true
	r.flush()
}

// printDelta writes only the new bytes appended since the last render.
// Returns true if any new content was written.
func (r *messageStreamRenderer) printDelta(content string) bool {
	if len(content) <= r.streamedBytes {
		return false
	}
	fmt.Fprint(r.w, content[r.streamedBytes:])
	r.streamedBytes = len(content)
	r.flush()
	return true
}

// finalizeAIStream completes a streaming AI message by printing any remaining
// content delta, a trailing newline pair, and tool calls if present.
func (r *messageStreamRenderer) finalizeAIStream(msg *agentexecutionv1.AgentMessage) {
	if len(msg.Content) > r.streamedBytes {
		fmt.Fprint(r.w, msg.Content[r.streamedBytes:])
	}
	fmt.Fprint(r.w, "\n\n")
	if len(msg.ToolCalls) > 0 {
		r.writeToolCalls(msg.ToolCalls)
	}
	r.flush()
}

// writeCompleteMessage renders a non-streaming message in full.
// This mirrors the formatting of displayAgentMessage but writes to the renderer's
// writer instead of os.Stdout, keeping all output routed through a single destination.
func (r *messageStreamRenderer) writeCompleteMessage(msg *agentexecutionv1.AgentMessage) {
	switch msg.Type {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		fmt.Fprintf(r.w, "💬 You: %s\n\n", msg.Content)
		r.flush()
	case agentexecutionv1.MessageType_MESSAGE_AI:
		if msg.Content != "" {
			fmt.Fprintf(r.w, "🤖 Agent: %s\n\n", msg.Content)
		}
		if len(msg.ToolCalls) > 0 {
			r.writeToolCalls(msg.ToolCalls)
		} else if msg.Content != "" {
			r.flush()
		}
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		fmt.Fprintln(r.w, toolrender.RenderResult(msg.Content))
		fmt.Fprintln(r.w)
		r.flush()
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		fmt.Fprintf(r.w, "%s\n\n", systemMsgStyle.Render("ℹ️  "+msg.Content))
		r.flush()
	default:
		fmt.Fprintf(r.w, "❓ Unknown: %s\n\n", msg.Content)
		r.flush()
	}
}

// writeToolCalls renders structured tool call information to the writer.
func (r *messageStreamRenderer) writeToolCalls(toolCalls []*agentexecutionv1.ToolCall) {
	for _, tc := range toolCalls {
		info := convertToolCall(tc)
		fmt.Fprintln(r.w, toolrender.Render(info))
	}
	if len(toolCalls) > 0 {
		fmt.Fprintln(r.w)
		r.flush()
	}
}

// flush syncs the writer if it supports Sync (e.g., *os.File).
// This ensures output is visible immediately, critical for streaming UX.
func (r *messageStreamRenderer) flush() {
	if f, ok := r.w.(interface{ Sync() error }); ok {
		_ = f.Sync()
	}
}
