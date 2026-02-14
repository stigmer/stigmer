package root

import (
	"bytes"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
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
	assertContains(t, buf.String(), "Agent: I can help")
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
	assertContains(t, buf.String(), "Agent: Hello")
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
	assertContains(t, buf.String(), "Agent: ")

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
	assertContains(t, buf.String(), "Agent: I'll")

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
	assertContains(t, buf.String(), "Agent: response text")
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
