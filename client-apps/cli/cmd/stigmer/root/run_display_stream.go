package root

import (
	"fmt"
	"io"
	"regexp"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
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

// hasPending reports whether the next render() call will produce output.
//
// This allows callers to stop an active spinner BEFORE rendering, preventing
// concurrent writes to stdout (spinner goroutine vs. renderer) that corrupt
// display lines. Without this check, the spinner's \r-prefixed frame can
// interleave with renderer output on the same line.
func (r *messageStreamRenderer) hasPending(messages []*agentexecutionv1.AgentMessage) bool {
	if r.inStream {
		// Mid-stream AI message — check for new content delta.
		if r.displayedCount < len(messages) {
			msg := messages[r.displayedCount]
			if msg.IsStreaming {
				return len(msg.Content) > r.streamedBytes
			}
			// Streaming ended — finalization will produce output.
			return true
		}
		return false
	}
	return len(messages) > r.displayedCount
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
	// No prefix — AI content flows directly to the writer.
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
		fmt.Fprintf(r.w, "You: %s\n\n", msg.Content)
		r.flush()
	case agentexecutionv1.MessageType_MESSAGE_AI:
		if msg.Content != "" {
			fmt.Fprintf(r.w, "%s\n\n", formatNonTUIAIText(msg.Content))
		}
		if len(msg.ToolCalls) > 0 {
			r.writeToolCalls(msg.ToolCalls)
		} else if msg.Content == "" {
			// AI decided to call tools without text — show indicator so user sees activity.
			// The actual tool calls will appear in subsequent MESSAGE_TOOL messages.
			fmt.Fprintln(r.w, systemMsgStyle.Render("Agent is invoking tools..."))
			fmt.Fprintln(r.w)
			r.flush()
		} else {
			r.flush()
		}
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		// Prefer structured tool call display when embedded ToolCalls are available.
		// The backend populates msg.ToolCalls with full info (name, args, result, status).
		if len(msg.ToolCalls) > 0 {
			r.writeToolCalls(msg.ToolCalls)
		} else {
			// Fallback: show content preview. The backend formats this nicely,
			// e.g., "read(path='file.txt') -> 1164 chars", so display it directly.
			fmt.Fprintln(r.w, toolrender.RenderResultWithPreview(msg.Content))
			fmt.Fprintln(r.w)
			r.flush()
		}
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		// Sanitize raw API errors (e.g., Anthropic 400 responses) into
		// user-friendly text. The full error is available in execution logs.
		content := sanitizeSystemContent(msg.Content)
		fmt.Fprintf(r.w, "%s\n\n", systemMsgStyle.Render(content))
		r.flush()
	default:
		fmt.Fprintf(r.w, "Unknown: %s\n\n", msg.Content)
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

// ---------------------------------------------------------------------------
// Error content sanitization
// ---------------------------------------------------------------------------

// rawAPIErrorPattern matches raw HTTP/API error responses that leak internal
// details. Examples:
//
//	"Error code: 400 - {'type': 'error', ...}"
//	"Error code: 500 - {\"error\": ...}"
var rawAPIErrorPattern = regexp.MustCompile(`Error code: \d+ - [{'\"]`)

// rawExceptionPatterns lists substrings that indicate raw exception or API
// internals that should not be shown verbatim to end users.
var rawExceptionPatterns = []string{
	"invalid_request_error",
	"request_id",
	"'type': 'error'",
	`"type": "error"`,
}

// sanitizeSystemContent rewrites raw API/exception error messages into clean
// user-facing text. Non-error system messages pass through unchanged.
//
// The heuristic: if the content contains a raw HTTP error code pattern or
// known exception internals, replace the raw detail with a concise summary.
// The full error is always available via `stigmer get execution <id>`.
func sanitizeSystemContent(content string) string {
	if !isRawErrorContent(content) {
		return content
	}

	// Try to extract a human-readable portion before the raw API dump.
	// The agent runner often prefixes errors: "❌ Error: Execution failed: Error code: 400 - ..."
	// We want to keep "Execution failed" but drop everything from the raw dump onward.
	if idx := strings.Index(content, "Error code:"); idx > 0 {
		prefix := strings.TrimSpace(content[:idx])
		// Strip trailing colon or dash left after trimming.
		prefix = strings.TrimRight(prefix, ":- ")
		if prefix != "" {
			return prefix + " (internal error — check execution logs for details)"
		}
	}

	// Fallback: entire content is raw error — replace wholesale.
	return "Agent execution encountered an internal error. Check execution logs for details."
}

// isRawErrorContent returns true if content looks like a raw API error response
// rather than a curated user-facing message.
func isRawErrorContent(content string) bool {
	if rawAPIErrorPattern.MatchString(content) {
		return true
	}
	for _, pattern := range rawExceptionPatterns {
		if strings.Contains(content, pattern) {
			return true
		}
	}
	return false
}
