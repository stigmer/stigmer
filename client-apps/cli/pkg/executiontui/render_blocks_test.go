package executiontui

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

func TestRenderAIContent_TextOnly(t *testing.T) {
	result := renderAIContent("Hello world", nil)
	if !strings.Contains(result, "🤖 Agent: Hello world") {
		t.Errorf("result = %q, want to contain agent prefix", result)
	}
}

func TestRenderAIContent_WithToolCalls(t *testing.T) {
	tc := []toolrender.ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}},
	}
	result := renderAIContent("Reading file.", tc)
	if !strings.Contains(result, "🤖 Agent:") {
		t.Error("result should contain agent prefix")
	}
	if !strings.Contains(result, "Read") {
		t.Error("result should contain tool render output")
	}
}

func TestRenderAIContent_NoTextNoTools(t *testing.T) {
	result := renderAIContent("", nil)
	if !strings.Contains(result, "invoking tools") {
		t.Errorf("result = %q, want invoking tools indicator", result)
	}
}

func TestRenderStreamingAI_EmptyContent(t *testing.T) {
	result := renderStreamingAI("")
	if !strings.Contains(result, "🤖 Agent: ▍") {
		t.Errorf("result = %q, want cursor indicator", result)
	}
}

func TestRenderStreamingAI_WithContent(t *testing.T) {
	result := renderStreamingAI("Hello")
	if !strings.Contains(result, "Hello▍") {
		t.Errorf("result = %q, want content + cursor", result)
	}
}

func TestRenderHumanContent(t *testing.T) {
	result := renderHumanContent("What is this file?")
	if result != "💬 You: What is this file?" {
		t.Errorf("result = %q", result)
	}
}

func TestRenderPhaseChange_InProgress(t *testing.T) {
	result := renderPhaseChange("in_progress", "pending")
	if result == "" {
		t.Error("in_progress phase should produce output")
	}
}

func TestRenderPhaseChange_ResumedAfterApproval(t *testing.T) {
	result := renderPhaseChange("in_progress", "waiting_for_approval")
	if !strings.Contains(result, "Resumed") {
		t.Errorf("result = %q, want 'Resumed' text", result)
	}
}

func TestRenderPhaseChange_WaitingForApproval_Suppressed(t *testing.T) {
	result := renderPhaseChange("waiting_for_approval", "in_progress")
	if result != "" {
		t.Errorf("waiting_for_approval should be suppressed, got %q", result)
	}
}

func TestRenderApprovalPrompt(t *testing.T) {
	result := renderApprovalPrompt("shell", `{"command":"ls"}`, "Execute command")
	if !strings.Contains(result, "APPROVAL REQUIRED") {
		t.Error("should contain APPROVAL REQUIRED")
	}
	if !strings.Contains(result, "shell") {
		t.Error("should contain tool name")
	}
	if !strings.Contains(result, "[a] Approve") {
		t.Error("should contain key hints")
	}
}

func TestRebuildViewportContent_Empty(t *testing.T) {
	result := rebuildViewportContent(nil)
	if result != "" {
		t.Errorf("empty blocks should produce empty content, got %q", result)
	}
}

func TestRebuildViewportContent_MultipleBlocks(t *testing.T) {
	blocks := []contentBlock{
		{content: "block1"},
		{content: "block2"},
		{content: "block3"},
	}
	result := rebuildViewportContent(blocks)
	if !strings.Contains(result, "block1") || !strings.Contains(result, "block2") {
		t.Error("should contain all block content")
	}
	// Blocks should be separated by double newlines.
	if strings.Count(result, "\n\n") != 2 {
		t.Errorf("expected 2 block separators, got %d", strings.Count(result, "\n\n"))
	}
}
