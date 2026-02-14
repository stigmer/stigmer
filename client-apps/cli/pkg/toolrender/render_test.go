package toolrender

import (
	"strings"
	"testing"
	"time"
)

// =============================================================================
// Render Tests — Known Tool Categories
// =============================================================================

func TestRender_ShellTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": "ls -la /tmp"},
	})

	assertContains(t, result, "🖥 ")
	assertContains(t, result, "Shell")
	assertContains(t, result, "ls -la /tmp")
}

func TestRender_AllShellToolNames(t *testing.T) {
	shellTools := []string{"shell", "bash", "execute_command", "run_command", "terminal"}
	for _, tool := range shellTools {
		t.Run(tool, func(t *testing.T) {
			result := Render(ToolCallInfo{
				Name: tool,
				Args: map[string]interface{}{"command": "echo test"},
			})
			assertContains(t, result, "Shell")
			assertContains(t, result, "echo test")
		})
	}
}

func TestRender_ReadFileTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"path": "inputs/agent-api.proto"},
	})

	assertContains(t, result, "📖")
	assertContains(t, result, "Read")
	assertContains(t, result, "inputs/agent-api.proto")
}

func TestRender_ListDirectoryTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "list_directory",
		Args: map[string]interface{}{"path": "/workspace"},
	})

	assertContains(t, result, "📂")
	assertContains(t, result, "List")
	assertContains(t, result, "/workspace")
}

func TestRender_WriteFileTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "outputs/SKILL.md", "content": "# Skill"},
	})

	assertContains(t, result, "📝")
	assertContains(t, result, "Write")
	assertContains(t, result, "outputs/SKILL.md")
}

func TestRender_AllWriteToolNames(t *testing.T) {
	writeTools := []string{"write_file", "create_file", "overwrite_file"}
	for _, tool := range writeTools {
		t.Run(tool, func(t *testing.T) {
			result := Render(ToolCallInfo{
				Name: tool,
				Args: map[string]interface{}{"path": "/tmp/test.txt"},
			})
			assertContains(t, result, "📝")
			assertContains(t, result, "/tmp/test.txt")
		})
	}
}

func TestRender_DeleteFileTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "delete_file",
		Args: map[string]interface{}{"path": "/tmp/old.txt"},
	})

	assertContains(t, result, "⚠️")
	assertContains(t, result, "Delete")
	assertContains(t, result, "/tmp/old.txt")
}

func TestRender_AllDeleteToolNames(t *testing.T) {
	deleteTools := []string{"delete_file", "remove_file"}
	for _, tool := range deleteTools {
		t.Run(tool, func(t *testing.T) {
			result := Render(ToolCallInfo{
				Name: tool,
				Args: map[string]interface{}{"path": "/etc/hosts"},
			})
			assertContains(t, result, "Delete")
		})
	}
}

// =============================================================================
// Render Tests — Platform Tools (ls, glob, grep, edit, execute)
// =============================================================================

func TestRender_LsTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "ls",
		Args: map[string]interface{}{"path": "/workspace"},
	})

	assertContains(t, result, "📂")
	assertContains(t, result, "List")
	assertContains(t, result, "/workspace")
}

func TestRender_GlobTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "glob",
		Args: map[string]interface{}{"pattern": "**/*.py"},
	})

	assertContains(t, result, "🔍")
	assertContains(t, result, "Find")
	assertContains(t, result, "**/*.py")
}

func TestRender_GrepTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "grep",
		Args: map[string]interface{}{"pattern": "TODO"},
	})

	assertContains(t, result, "🔎")
	assertContains(t, result, "Search")
	assertContains(t, result, "TODO")
}

func TestRender_EditTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "edit",
		Args: map[string]interface{}{"path": "main.py"},
	})

	assertContains(t, result, "✏️")
	assertContains(t, result, "Edit")
	assertContains(t, result, "main.py")
}

func TestRender_EditFileTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "edit_file",
		Args: map[string]interface{}{"path": "main.py"},
	})

	assertContains(t, result, "✏️")
	assertContains(t, result, "Edit")
	assertContains(t, result, "main.py")
}

func TestRender_ExecuteTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "execute",
		Args: map[string]interface{}{"command": "python test.py"},
	})

	assertContains(t, result, "🖥 ")
	assertContains(t, result, "Execute")
	assertContains(t, result, "python test.py")
}

// =============================================================================
// Render Tests — Result Preview (showPreview tools)
// =============================================================================

func TestRender_LsWithResultPreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "ls",
		Args:   map[string]interface{}{"path": "/workspace"},
		Result: "inputs\noutputs\nREADME.md",
	})

	// Header line
	assertContains(t, result, "📂")
	assertContains(t, result, "/workspace")

	// Preview line (second line, dimmed, comma-separated)
	assertContains(t, result, "inputs, outputs, README.md")
}

func TestRender_GlobWithResultPreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "**/init_skill.py"},
		Result: "No files matching pattern '**/init_skill.py'",
	})

	assertContains(t, result, "🔍")
	assertContains(t, result, "No files matching pattern")
}

func TestRender_GrepWithResultPreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "grep",
		Args:   map[string]interface{}{"pattern": "TODO"},
		Result: "Found 3 matches in 2 files:\n\nmain.py:10:# TODO fix\nutils.py:5:# TODO refactor\nutils.py:20:# TODO test",
	})

	assertContains(t, result, "🔎")
	assertContains(t, result, "Found 3 matches")
}

func TestRender_LsWithEmptyResult_NoPreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "ls",
		Args:   map[string]interface{}{"path": "/empty"},
		Result: "",
	})

	// Should not have a second line
	assertNotContains(t, result, "\n")
}

func TestRender_ReadWithResult_NoPreview(t *testing.T) {
	// read is NOT a showPreview tool — should NOT show result preview.
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "main.go"},
		Result: "package main\n\nfunc main() {}",
	})

	// Should show size but NOT file contents as preview
	assertContains(t, result, "chars")
	assertNotContains(t, result, "package main")
}

func TestRender_PreviewTruncatesLongResults(t *testing.T) {
	// Create a result with many entries that would exceed preview width.
	entries := make([]string, 30)
	for i := range entries {
		entries[i] = "some_long_directory_name"
	}
	result := Render(ToolCallInfo{
		Name:   "ls",
		Args:   map[string]interface{}{"path": "/"},
		Result: strings.Join(entries, "\n"),
	})

	// Should contain truncation indicator
	assertContains(t, result, "...")
}

// =============================================================================
// Render Tests — Unknown Tools
// =============================================================================

func TestRender_UnknownTool(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "custom_deploy",
		Args: map[string]interface{}{"repo": "acme/staging"},
	})

	assertContains(t, result, "🔧")
	assertContains(t, result, "custom_deploy")
	assertContains(t, result, "acme/staging")
}

func TestRender_UnknownTool_MultipleArgs_ShowsFirst(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "my_tool",
		Args: map[string]interface{}{"alpha": "first", "zebra": "last"},
	})

	// Alphabetically first arg ("alpha") should be shown
	assertContains(t, result, "first")
}

func TestRender_UnknownTool_NoArgs(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "ping_server",
	})

	assertContains(t, result, "🔧")
	assertContains(t, result, "ping_server")
}

// =============================================================================
// Render Tests — Edge Cases
// =============================================================================

func TestRender_NilArgs(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "shell",
		Args: nil,
	})

	// Should render without panic, just showing the label
	assertContains(t, result, "Shell")
}

func TestRender_EmptyArgs(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{},
	})

	assertContains(t, result, "Read")
}

func TestRender_MissingPrimaryField(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"working_directory": "/home"},
	})

	// Should show label without a primary value
	assertContains(t, result, "Shell")
}

func TestRender_EmptyName(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "",
		Args: map[string]interface{}{"key": "val"},
	})

	// Falls through to unknown path
	assertContains(t, result, "🔧")
}

// =============================================================================
// Render Tests — Suffix (Result, Duration, Error)
// =============================================================================

func TestRender_WithResult(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Result: strings.Repeat("x", 500),
	})

	assertContains(t, result, "500 chars")
}

func TestRender_WithLargeResult(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Result: strings.Repeat("x", 4300),
	})

	assertContains(t, result, "4.2 KB")
}

func TestRender_WithDuration(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:     "shell",
		Args:     map[string]interface{}{"command": "sleep 1"},
		Duration: 1200 * time.Millisecond,
	})

	assertContains(t, result, "1.2s")
}

func TestRender_WithSubSecondDuration(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:     "read_file",
		Args:     map[string]interface{}{"path": "main.go"},
		Duration: 45 * time.Millisecond,
	})

	assertContains(t, result, "45ms")
}

func TestRender_WithError(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:  "shell",
		Args:  map[string]interface{}{"command": "false"},
		Error: "exit code 1",
	})

	assertContains(t, result, "error:")
	assertContains(t, result, "exit code 1")
}

func TestRender_WithResultAndDuration(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:     "shell",
		Args:     map[string]interface{}{"command": "ls"},
		Result:   "file1\nfile2\n",
		Duration: 500 * time.Millisecond,
	})

	assertContains(t, result, "12 chars")
	assertContains(t, result, "500ms")
}

func TestRender_ErrorTakesPrecedence(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:     "shell",
		Args:     map[string]interface{}{"command": "false"},
		Result:   "some output",
		Duration: 100 * time.Millisecond,
		Error:    "command failed",
	})

	// Error should be shown, not result/duration
	assertContains(t, result, "error:")
	assertNotContains(t, result, "11 chars")
}

// =============================================================================
// RenderResult Tests
// =============================================================================

func TestRenderResult_Empty(t *testing.T) {
	result := RenderResult("")
	assertContains(t, result, "(empty)")
}

func TestRenderResult_SmallContent(t *testing.T) {
	result := RenderResult("hello world")
	assertContains(t, result, "11 chars")
	assertContains(t, result, "↳")
}

func TestRenderResult_LargeContent(t *testing.T) {
	result := RenderResult(strings.Repeat("x", 2048))
	assertContains(t, result, "2.0 KB")
}

// =============================================================================
// formatSize Tests
// =============================================================================

func TestFormatSize_Chars(t *testing.T) {
	tests := []struct {
		chars    int
		expected string
	}{
		{0, "0 chars"},
		{100, "100 chars"},
		{1023, "1023 chars"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := formatSize(tt.chars); got != tt.expected {
				t.Errorf("formatSize(%d) = %q, want %q", tt.chars, got, tt.expected)
			}
		})
	}
}

func TestFormatSize_KB(t *testing.T) {
	tests := []struct {
		chars    int
		expected string
	}{
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{4300, "4.2 KB"},
		{10240, "10 KB"},
		{51200, "50 KB"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := formatSize(tt.chars); got != tt.expected {
				t.Errorf("formatSize(%d) = %q, want %q", tt.chars, got, tt.expected)
			}
		})
	}
}

// =============================================================================
// formatDuration Tests
// =============================================================================

func TestFormatDuration_Milliseconds(t *testing.T) {
	if got := formatDuration(45 * time.Millisecond); got != "45ms" {
		t.Errorf("expected %q, got %q", "45ms", got)
	}
}

func TestFormatDuration_Seconds(t *testing.T) {
	got := formatDuration(1200 * time.Millisecond)
	if got != "1.2s" {
		t.Errorf("expected %q, got %q", "1.2s", got)
	}
}

// =============================================================================
// truncate Tests
// =============================================================================

func TestTruncate_Short(t *testing.T) {
	if got := truncate("hello", 10); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestTruncate_Exact(t *testing.T) {
	if got := truncate("hello", 5); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestTruncate_Long(t *testing.T) {
	if got := truncate("hello world", 8); got != "hello..." {
		t.Errorf("expected %q, got %q", "hello...", got)
	}
}

// =============================================================================
// formatArgValue Tests
// =============================================================================

func TestFormatArgValue_String(t *testing.T) {
	if got := formatArgValue("hello"); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestFormatArgValue_Integer(t *testing.T) {
	if got := formatArgValue(float64(42)); got != "42" {
		t.Errorf("expected %q, got %q", "42", got)
	}
}

func TestFormatArgValue_Float(t *testing.T) {
	if got := formatArgValue(3.14); got != "3.14" {
		t.Errorf("expected %q, got %q", "3.14", got)
	}
}

func TestFormatArgValue_Bool(t *testing.T) {
	if got := formatArgValue(true); got != "true" {
		t.Errorf("expected %q, got %q", "true", got)
	}
}

func TestFormatArgValue_Nil(t *testing.T) {
	if got := formatArgValue(nil); got != "" {
		t.Errorf("expected empty string for nil, got %q", got)
	}
}

// =============================================================================
// Indentation Tests
// =============================================================================

func TestRender_HasIndentation(t *testing.T) {
	result := Render(ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"path": "test.go"},
	})

	if !strings.HasPrefix(result, "  ") {
		t.Errorf("expected 2-space indentation, got %q", result[:5])
	}
}

func TestRenderResult_HasIndentation(t *testing.T) {
	result := RenderResult("content")
	if !strings.Contains(result, "  ↳") {
		t.Errorf("expected indented arrow, got %q", result)
	}
}

// =============================================================================
// formatResultPreview Tests
// =============================================================================

func TestFormatResultPreview_Empty(t *testing.T) {
	if got := formatResultPreview(""); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestFormatResultPreview_Whitespace(t *testing.T) {
	if got := formatResultPreview("   \n\n  "); got != "" {
		t.Errorf("expected empty string for whitespace-only input, got %q", got)
	}
}

func TestFormatResultPreview_SingleLine(t *testing.T) {
	got := formatResultPreview("No files matching pattern '**/*.py'")
	if got != "No files matching pattern '**/*.py'" {
		t.Errorf("expected single-line passthrough, got %q", got)
	}
}

func TestFormatResultPreview_MultiLine(t *testing.T) {
	got := formatResultPreview("inputs\noutputs\nREADME.md")
	if got != "inputs, outputs, README.md" {
		t.Errorf("expected comma-separated join, got %q", got)
	}
}

func TestFormatResultPreview_SkipsBlankLines(t *testing.T) {
	got := formatResultPreview("file1\n\nfile2\n\nfile3")
	if got != "file1, file2, file3" {
		t.Errorf("expected blank lines skipped, got %q", got)
	}
}

func TestFormatResultPreview_TruncatesLong(t *testing.T) {
	// Build a string that exceeds previewMaxWidth
	long := strings.Repeat("abcdefghij\n", 20)
	got := formatResultPreview(long)
	if len(got) > previewMaxWidth {
		t.Errorf("expected max %d chars, got %d", previewMaxWidth, len(got))
	}
	assertContains(t, got, "...")
}

// =============================================================================
// Test Helpers
// =============================================================================

func assertContains(t *testing.T, s, substr string) {
	t.Helper()
	if !strings.Contains(s, substr) {
		t.Errorf("expected %q to contain %q", s, substr)
	}
}

func assertNotContains(t *testing.T, s, substr string) {
	t.Helper()
	if strings.Contains(s, substr) {
		t.Errorf("expected %q to NOT contain %q", s, substr)
	}
}
