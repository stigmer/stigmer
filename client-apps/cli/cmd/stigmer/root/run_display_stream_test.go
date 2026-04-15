package root

import (
	"bytes"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// makeMessage is a test helper that builds an AgentMessage with the given type,
// content, and streaming flag.
func makeMessage(typ agentexecutionv1.MessageType, content string, isStreaming bool) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type:        typ,
		Content:     content,
		IsStreaming: isStreaming,
	}
}

// =============================================================================
// Complete Message Rendering
// =============================================================================

func TestRenderer_CompleteHumanMessage(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "hello world", false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertContains(t, buf.String(), "You: hello world")
	assertDisplayedCount(t, r, 1)
}

func TestRenderer_CompleteAIMessage(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "I can help", false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertContains(t, buf.String(), "I can help")
	assertDisplayedCount(t, r, 1)
}

func TestRenderer_CompleteToolMessage(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_TOOL, "file contents here", false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertDisplayedCount(t, r, 1)
}

func TestRenderer_CompleteSystemMessage(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_SYSTEM, "system init", false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertDisplayedCount(t, r, 1)
}

// =============================================================================
// Streaming AI Message Lifecycle
// =============================================================================

func TestRenderer_StreamingAI_BeginDeltaFinalize(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "Hello", true),
	}

	// Step 1: Begin streaming — prefix + initial content.
	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, true)
	assertContains(t, buf.String(), "Hello")
	assertDisplayedCount(t, r, 0) // not yet finalized

	// Step 2: Delta — more content arrives.
	buf.Reset()
	msgs[0].Content = "Hello, world"
	rendered, streaming = r.render(msgs)
	assertFlags(t, rendered, true, streaming, true)
	assertEqual(t, buf.String(), ", world")

	// Step 3: Finalize — streaming ends.
	buf.Reset()
	msgs[0].Content = "Hello, world!"
	msgs[0].IsStreaming = false
	rendered, streaming = r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertContains(t, buf.String(), "!")
	assertContains(t, buf.String(), "\n\n")
	assertDisplayedCount(t, r, 1)
}

func TestRenderer_StreamingAI_EmptyInitialContent(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	// Start with empty content (first token hasn't arrived yet).
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "", true),
	}
	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, true)
	assertEqual(t, buf.String(), "")

	// First token arrives.
	buf.Reset()
	msgs[0].Content = "Hi"
	rendered, streaming = r.render(msgs)
	assertFlags(t, rendered, true, streaming, true)
	assertEqual(t, buf.String(), "Hi")
}

func TestRenderer_StreamingAI_NoNewContent(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "Hello", true),
	}
	r.render(msgs)
	buf.Reset()

	// Same content, no growth — nothing should be rendered.
	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, false, streaming, true)
	assertEqual(t, buf.String(), "")
}

func TestRenderer_StreamingAI_FinalizeWithNoNewContent(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "Done", true),
	}
	r.render(msgs)
	buf.Reset()

	// Streaming ends without additional content.
	msgs[0].IsStreaming = false
	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	// Should contain only the newlines (no delta, content didn't grow).
	assertContains(t, buf.String(), "\n\n")
	assertDisplayedCount(t, r, 1)
}

// =============================================================================
// Mixed Message Sequences
// =============================================================================

func TestRenderer_MixedSequence_HumanThenStreamingAIThenTool(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	// Update 1: Human message arrives.
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "create a file", false),
	}
	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertContains(t, buf.String(), "You: create a file")
	assertDisplayedCount(t, r, 1)

	// Update 2: AI starts streaming.
	buf.Reset()
	msgs = append(msgs, makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "I'll", true))
	rendered, streaming = r.render(msgs)
	assertFlags(t, rendered, true, streaming, true)
	assertContains(t, buf.String(), "I'll")

	// Update 3: AI finishes, tool result follows.
	buf.Reset()
	msgs[1].Content = "I'll create it"
	msgs[1].IsStreaming = false
	msgs = append(msgs, makeMessage(agentexecutionv1.MessageType_MESSAGE_TOOL, "created ok", false))
	rendered, streaming = r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertContains(t, buf.String(), " create it")
	assertDisplayedCount(t, r, 3)
}

func TestRenderer_LateSubscription_AllMessagesComplete(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	// CLI subscribes after execution is done — all messages arrive at once.
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "hello", false),
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "response text", false),
		makeMessage(agentexecutionv1.MessageType_MESSAGE_TOOL, "result data", false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)
	assertContains(t, buf.String(), "You: hello")
	assertContains(t, buf.String(), "response text")
	assertDisplayedCount(t, r, 3)
}

func TestRenderer_NoMessages(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	rendered, streaming := r.render(nil)
	assertFlags(t, rendered, false, streaming, false)
	assertEqual(t, buf.String(), "")
}

func TestRenderer_IdempotentOnSameMessages(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "hello", false),
	}

	r.render(msgs)
	buf.Reset()

	// Calling render again with the same messages should produce no output.
	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, false, streaming, false)
	assertEqual(t, buf.String(), "")
}

// =============================================================================
// hasPending Tests
// =============================================================================

func TestRenderer_HasPending_NoMessages(t *testing.T) {
	r := newMessageStreamRenderer(&bytes.Buffer{})
	if r.hasPending(nil) {
		t.Error("hasPending should be false with nil messages")
	}
	if r.hasPending([]*agentexecutionv1.AgentMessage{}) {
		t.Error("hasPending should be false with empty messages")
	}
}

func TestRenderer_HasPending_NewMessage(t *testing.T) {
	r := newMessageStreamRenderer(&bytes.Buffer{})
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "hello", false),
	}
	if !r.hasPending(msgs) {
		t.Error("hasPending should be true when new messages are available")
	}
}

func TestRenderer_HasPending_AllRendered(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "hello", false),
	}
	r.render(msgs)

	if r.hasPending(msgs) {
		t.Error("hasPending should be false after all messages are rendered")
	}
}

func TestRenderer_HasPending_StreamingWithNewContent(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "Hello", true),
	}
	r.render(msgs)

	// Same content — no new delta.
	if r.hasPending(msgs) {
		t.Error("hasPending should be false when streaming has no new content")
	}

	// New content arrives.
	msgs[0].Content = "Hello, world"
	if !r.hasPending(msgs) {
		t.Error("hasPending should be true when streaming has new content delta")
	}
}

func TestRenderer_HasPending_StreamingFinalized(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "Done", true),
	}
	r.render(msgs)

	// Streaming ends — finalization is pending.
	msgs[0].IsStreaming = false
	if !r.hasPending(msgs) {
		t.Error("hasPending should be true when streaming message needs finalization")
	}
}

// =============================================================================
// Error Sanitization Tests
// =============================================================================

func TestSanitizeSystemContent_PassthroughNormalMessages(t *testing.T) {
	// Non-error system messages should pass through unchanged.
	tests := []string{
		"Execution paused by user.",
		"⏸️ Execution paused by user. Use resume to continue from this checkpoint.",
		"Internal system error occurred. Please contact support if this issue persists.",
		"Agent is processing your request.",
		"",
	}

	for _, input := range tests {
		result := sanitizeSystemContent(input)
		if result != input {
			t.Errorf("sanitizeSystemContent(%q) = %q, want passthrough", input, result)
		}
	}
}

func TestSanitizeSystemContent_SanitizesAnthropicError(t *testing.T) {
	// Raw Anthropic API error should be sanitized.
	input := "❌ Error: Execution failed: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'messages: at least one message is required'}, 'request_id': 'req_011CY7r2jVTajTkbcCUdXXfC'}"

	result := sanitizeSystemContent(input)

	// Should not contain the raw API error details.
	if strings.Contains(result, "Error code: 400") {
		t.Errorf("expected raw error code to be removed, got: %s", result)
	}
	if strings.Contains(result, "invalid_request_error") {
		t.Errorf("expected raw error type to be removed, got: %s", result)
	}
	if strings.Contains(result, "request_id") {
		t.Errorf("expected request_id to be removed, got: %s", result)
	}

	// Should preserve a meaningful prefix.
	if !strings.Contains(result, "Execution failed") {
		t.Errorf("expected sanitized output to preserve 'Execution failed', got: %s", result)
	}
}

func TestSanitizeSystemContent_SanitizesGenericAPIError(t *testing.T) {
	// Raw HTTP error with no prefix.
	input := "Error code: 500 - {\"type\": \"error\", \"message\": \"internal server error\"}"

	result := sanitizeSystemContent(input)

	// Should produce a fallback message (no useful prefix to preserve).
	if strings.Contains(result, "Error code: 500") {
		t.Errorf("expected raw error code to be removed, got: %s", result)
	}
	if !strings.Contains(result, "internal error") {
		t.Errorf("expected fallback error message, got: %s", result)
	}
}

func TestSanitizeSystemContent_SanitizesErrorWithPrefix(t *testing.T) {
	// Error with a meaningful prefix before the raw dump.
	input := "❌ Error: Agent crashed: Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error'}}"

	result := sanitizeSystemContent(input)

	// Should keep the human-readable prefix.
	if !strings.Contains(result, "Agent crashed") {
		t.Errorf("expected prefix 'Agent crashed' to be preserved, got: %s", result)
	}
	// Should not contain the raw error body.
	if strings.Contains(result, "rate_limit_error") {
		t.Errorf("expected raw error type to be removed, got: %s", result)
	}
}

func TestIsRawErrorContent(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected bool
	}{
		{
			name:     "anthropic error code",
			content:  "Error code: 400 - {'type': 'error'}",
			expected: true,
		},
		{
			name:     "json error code",
			content:  `Error code: 500 - {"type": "error"}`,
			expected: true,
		},
		{
			name:     "invalid_request_error keyword",
			content:  "Something invalid_request_error happened",
			expected: true,
		},
		{
			name:     "request_id keyword",
			content:  "Error with request_id abc123",
			expected: true,
		},
		{
			name:     "normal message",
			content:  "Execution completed successfully",
			expected: false,
		},
		{
			name:     "empty",
			content:  "",
			expected: false,
		},
		{
			name:     "user-facing error",
			content:  "File not found: config.yaml",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isRawErrorContent(tt.content)
			if result != tt.expected {
				t.Errorf("isRawErrorContent(%q) = %v, want %v", tt.content, result, tt.expected)
			}
		})
	}
}

func TestRenderer_SystemMessage_SanitizesRawError(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	rawError := "❌ Error: Execution failed: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'messages: at least one message is required'}}"
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_SYSTEM, rawError, false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)

	output := buf.String()
	// Should not contain the raw API error.
	if strings.Contains(output, "invalid_request_error") {
		t.Errorf("expected raw error to be sanitized, got: %s", output)
	}
	// Should contain the preserved meaningful prefix.
	if !strings.Contains(output, "Execution failed") {
		t.Errorf("expected sanitized output to contain 'Execution failed', got: %s", output)
	}
}

// =============================================================================
// Test Assertion Helpers
// =============================================================================

func assertFlags(t *testing.T, rendered, wantRendered, streaming, wantStreaming bool) {
	t.Helper()
	if rendered != wantRendered {
		t.Errorf("rendered = %v, want %v", rendered, wantRendered)
	}
	if streaming != wantStreaming {
		t.Errorf("streaming = %v, want %v", streaming, wantStreaming)
	}
}

func assertContains(t *testing.T, output, substr string) {
	t.Helper()
	if !strings.Contains(output, substr) {
		t.Errorf("expected output to contain %q, got: %q", substr, output)
	}
}

func assertEqual(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func assertDisplayedCount(t *testing.T, r *messageStreamRenderer, want int) {
	t.Helper()
	if r.displayedCount != want {
		t.Errorf("displayedCount = %d, want %d", r.displayedCount, want)
	}
}

// =============================================================================
// Markdown Rendering Tests (Complete Messages)
// =============================================================================

func TestRenderer_CompleteAI_MarkdownHeader(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	content := "# Analysis Results\n\nThe code looks good."
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, content, false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)

	output := buf.String()
	plain := ansi.Strip(output)

	if !strings.Contains(plain, "Analysis Results") {
		t.Errorf("should contain header text, got: %q", plain)
	}
	if strings.Contains(plain, "# ") {
		t.Error("raw markdown header prefix should not appear in rendered output")
	}
	assertDisplayedCount(t, r, 1)
}

func TestRenderer_CompleteAI_MarkdownBold(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	content := "Found **3 issues** in the codebase."
	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, content, false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)

	plain := ansi.Strip(buf.String())
	if !strings.Contains(plain, "3 issues") {
		t.Errorf("should contain bold text content, got: %q", plain)
	}
	if strings.Contains(plain, "**") {
		t.Error("raw bold markers should not appear in rendered output")
	}
}

func TestRenderer_CompleteAI_PlainTextKeepsInlinePrefix(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "Sure, I can help.", false),
	}

	r.render(msgs)

	output := buf.String()
	if !strings.Contains(output, "Sure, I can help.") {
		t.Errorf("plain text should appear in output, got: %q", output)
	}
}

func TestRenderer_LateSubscription_MarkdownRendered(t *testing.T) {
	var buf bytes.Buffer
	r := newMessageStreamRenderer(&buf)

	msgs := []*agentexecutionv1.AgentMessage{
		makeMessage(agentexecutionv1.MessageType_MESSAGE_HUMAN, "analyze this", false),
		makeMessage(agentexecutionv1.MessageType_MESSAGE_AI, "## Summary\n\n- Issue 1\n- Issue 2", false),
	}

	rendered, streaming := r.render(msgs)
	assertFlags(t, rendered, true, streaming, false)

	plain := ansi.Strip(buf.String())
	if !strings.Contains(plain, "Summary") {
		t.Errorf("should contain header text, got: %q", plain)
	}
	if !strings.Contains(plain, "Issue 1") {
		t.Errorf("should contain list items, got: %q", plain)
	}
	assertDisplayedCount(t, r, 2)
}
