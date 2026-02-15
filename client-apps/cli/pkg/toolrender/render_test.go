package toolrender

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

// ansiRe matches ANSI escape sequences (color codes, resets, etc.).
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// stripANSI removes all ANSI escape sequences from s, returning the visible
// text content only. Used in tests to assert on semantic content without
// coupling to styling details.
func stripANSI(s string) string {
	return ansiRe.ReplaceAllString(s, "")
}

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

func TestRender_ReadWithResult_ShowsFileContentPreview(t *testing.T) {
	// read tools show a multi-line gutter-bordered content preview (previewFileContent).
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "main.go"},
		Result: "package main\n\nfunc main() {}",
	})

	// Should show size and line count in suffix.
	assertContains(t, result, "chars")
	assertContains(t, result, "3 lines")

	// All 3 lines fit within the preview window — all should be shown with gutter.
	assertContains(t, result, "│")
	assertContains(t, result, "package main")
	assertContains(t, result, "func main")

	// Exactly 3 lines — no "more lines" indicator.
	assertNotContains(t, result, "more lines")
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
	// read_file includes line count in suffix.
	assertContains(t, result, "1 line")
}

func TestRender_WithLargeResult(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Result: strings.Repeat("x", 4300),
	})

	assertContains(t, result, "4.2 KB")
	assertContains(t, result, "1 line")
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
// Render Tests — Fallback Field Resolution
// =============================================================================

func TestRender_ReadFile_FallbackToFilePath(t *testing.T) {
	// deepagents may send "file_path" instead of "path".
	result := Render(ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"file_path": "/workspace/main.py"},
	})

	assertContains(t, result, "📖")
	assertContains(t, result, "Read")
	assertContains(t, result, "/workspace/main.py")
}

func TestRender_Read_FallbackToFile(t *testing.T) {
	// Some frameworks may send "file" as the arg name.
	result := Render(ToolCallInfo{
		Name: "read",
		Args: map[string]interface{}{"file": "config.yaml"},
	})

	assertContains(t, result, "Read")
	assertContains(t, result, "config.yaml")
}

func TestRender_Read_PrimaryFieldTakesPrecedence(t *testing.T) {
	// When both "path" and "file_path" are present, "path" wins.
	result := Render(ToolCallInfo{
		Name: "read",
		Args: map[string]interface{}{
			"path":      "correct.txt",
			"file_path": "wrong.txt",
		},
	})

	assertContains(t, result, "correct.txt")
	assertNotContains(t, result, "wrong.txt")
}

func TestRender_Read_NoMatchingArgShowsLabelOnly(t *testing.T) {
	// When none of the primary or fallback fields match, just show the label.
	result := Render(ToolCallInfo{
		Name: "read",
		Args: map[string]interface{}{"url": "https://example.com"},
	})

	assertContains(t, result, "Read")
	assertNotContains(t, result, "https://example.com")
}

// =============================================================================
// Render Tests — Read Content Preview (previewFileContent)
// =============================================================================

func TestRender_ReadWithMultiLineResult_ShowsThreeLinePreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "proto/api.proto"},
		Result: "syntax = \"proto3\";\n\npackage ai.stigmer;\n\nmessage Agent {}",
	})

	assertContains(t, result, "proto/api.proto")

	// First 3 lines shown with gutter: "syntax...", "", "package...".
	assertContains(t, result, "│")
	assertContains(t, result, "syntax = \"proto3\";")
	assertContains(t, result, "package ai.stigmer;")

	// Line 4+ (message Agent {}) should NOT be in the preview.
	assertNotContains(t, result, "message Agent")

	// 5 total lines, 3 shown → "2 more lines".
	assertContains(t, result, "2 more lines")

	// Suffix should include line count.
	assertContains(t, result, "5 lines")
}

func TestRender_ReadWithEmptyResult_NoPreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "empty.txt"},
		Result: "",
	})

	// No preview line — no second line at all.
	assertNotContains(t, result, "\n")
}

func TestRender_ReadWithWhitespaceOnlyResult_NoPreview(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "blank.txt"},
		Result: "  \n\n  \n",
	})

	// Result has content (whitespace), so suffix shows size and line count,
	// but preview should be empty since no non-empty lines.
	assertContains(t, result, "chars")
	assertContains(t, result, "4 lines")
}

func TestRender_ReadPreviewTruncatesLongLine(t *testing.T) {
	longLine := strings.Repeat("x", 200)
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "wide.txt"},
		Result: longLine,
	})

	assertContains(t, result, "│")
	assertContains(t, result, "...")
}

func TestRender_ReadWithLeadingBlankLines_FallsBackToFirstContent(t *testing.T) {
	// First 3 lines are all blank → trimmed → fallback to first non-empty line.
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "padded.py"},
		Result: "\n\n\nimport os\nimport sys",
	})

	assertContains(t, result, "│")
	assertContains(t, result, "import os")
	// Only the fallback line is shown (not "import sys").
	assertNotContains(t, result, "import sys")
	// 5 total lines, 1 shown → "4 more lines".
	assertContains(t, result, "4 more lines")
}

// =============================================================================
// Render Tests — Repr Stripping in Previews (Defense-in-Depth)
// =============================================================================

func TestRender_LsWithReprResult_StripsMetadata(t *testing.T) {
	// Simulates a raw ToolMessage repr leaking through from the backend.
	result := Render(ToolCallInfo{
		Name:   "ls",
		Args:   map[string]interface{}{"path": "/bin/skills"},
		Result: "content=\"Directory '/bin/skills' is empty\" name='ls' tool_call_id='toolu_01TdxWQ1W'",
	})

	assertContains(t, result, "Directory '/bin/skills' is empty")
	assertNotContains(t, result, "name='ls'")
	assertNotContains(t, result, "tool_call_id=")
}

func TestRender_GlobWithReprResult_StripsMetadata(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "**/*.py"},
		Result: "content=\"No files matching pattern '**/*.py'\" name='glob' tool_call_id='toolu_abc123'",
	})

	assertContains(t, result, "No files matching pattern '**/*.py'")
	assertNotContains(t, result, "name='glob'")
}

func TestRender_ReadWithReprResult_StripsMetadata(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "main.py"},
		Result: "content='import os\nimport sys' name='read' tool_call_id='toolu_xyz'",
	})

	// Repr stripping extracts "import os\nimport sys" → both lines shown with gutter.
	assertContains(t, result, "│")
	assertContains(t, result, "import os")
	assertContains(t, result, "import sys")
	assertNotContains(t, result, "name='read'")
}

func TestRender_LsWithReprSingleQuotes_StripsMetadata(t *testing.T) {
	result := Render(ToolCallInfo{
		Name:   "ls",
		Args:   map[string]interface{}{"path": "/workspace"},
		Result: "content='tmp\nmnt\nproc\nsbin' name='ls' tool_call_id='toolu_01X'",
	})

	assertContains(t, result, "tmp, mnt, proc, sbin")
	assertNotContains(t, result, "content=")
}

// =============================================================================
// extractPrimaryArgWithFallbacks Tests
// =============================================================================

func TestExtractPrimaryArgWithFallbacks_PrimaryFound(t *testing.T) {
	args := map[string]interface{}{"path": "/workspace/main.go"}
	got := extractPrimaryArgWithFallbacks(args, "path", []string{"file_path", "file"})
	if got != "/workspace/main.go" {
		t.Errorf("expected %q, got %q", "/workspace/main.go", got)
	}
}

func TestExtractPrimaryArgWithFallbacks_FirstFallbackFound(t *testing.T) {
	args := map[string]interface{}{"file_path": "/tmp/data.csv"}
	got := extractPrimaryArgWithFallbacks(args, "path", []string{"file_path", "file"})
	if got != "/tmp/data.csv" {
		t.Errorf("expected %q, got %q", "/tmp/data.csv", got)
	}
}

func TestExtractPrimaryArgWithFallbacks_SecondFallbackFound(t *testing.T) {
	args := map[string]interface{}{"file": "README.md"}
	got := extractPrimaryArgWithFallbacks(args, "path", []string{"file_path", "file"})
	if got != "README.md" {
		t.Errorf("expected %q, got %q", "README.md", got)
	}
}

func TestExtractPrimaryArgWithFallbacks_NoneFound(t *testing.T) {
	args := map[string]interface{}{"url": "https://example.com"}
	got := extractPrimaryArgWithFallbacks(args, "path", []string{"file_path", "file"})
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestExtractPrimaryArgWithFallbacks_NilArgs(t *testing.T) {
	got := extractPrimaryArgWithFallbacks(nil, "path", []string{"file_path"})
	if got != "" {
		t.Errorf("expected empty string for nil args, got %q", got)
	}
}

func TestExtractPrimaryArgWithFallbacks_NilFallbacks(t *testing.T) {
	args := map[string]interface{}{"other": "value"}
	got := extractPrimaryArgWithFallbacks(args, "path", nil)
	if got != "" {
		t.Errorf("expected empty string when primary not found and no fallbacks, got %q", got)
	}
}

func TestExtractPrimaryArgWithFallbacks_EmptyFallbacks(t *testing.T) {
	args := map[string]interface{}{"path": "found.txt"}
	got := extractPrimaryArgWithFallbacks(args, "path", []string{})
	if got != "found.txt" {
		t.Errorf("expected %q, got %q", "found.txt", got)
	}
}

// =============================================================================
// stripToolMessageRepr Tests
// =============================================================================

func TestStripToolMessageRepr_DoubleQuoted(t *testing.T) {
	input := `content="Directory '/bin/skills' is empty" name='ls' tool_call_id='toolu_01TdxWQ1W'`
	got := stripToolMessageRepr(input)
	if got != "Directory '/bin/skills' is empty" {
		t.Errorf("expected clean content, got %q", got)
	}
}

func TestStripToolMessageRepr_SingleQuoted(t *testing.T) {
	input := "content='bin/skills/a34ed6ddb7e2b131' name='glob' tool_call_id='toolu_abc'"
	got := stripToolMessageRepr(input)
	if got != "bin/skills/a34ed6ddb7e2b131" {
		t.Errorf("expected clean content, got %q", got)
	}
}

func TestStripToolMessageRepr_NoMatch_NotContentPrefix(t *testing.T) {
	input := "just a normal string"
	got := stripToolMessageRepr(input)
	if got != input {
		t.Errorf("expected passthrough, got %q", got)
	}
}

func TestStripToolMessageRepr_NoMatch_ContentPrefixButNoNameMarker(t *testing.T) {
	// Starts with "content=" but has no " name=" marker — could be legitimate content.
	input := "content=something without metadata"
	got := stripToolMessageRepr(input)
	if got != input {
		t.Errorf("expected passthrough, got %q", got)
	}
}

func TestStripToolMessageRepr_Empty(t *testing.T) {
	got := stripToolMessageRepr("")
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestStripToolMessageRepr_MultilineContent(t *testing.T) {
	input := "content='line1\nline2\nline3' name='read' tool_call_id='toolu_xyz'"
	got := stripToolMessageRepr(input)
	if got != "line1\nline2\nline3" {
		t.Errorf("expected multiline content, got %q", got)
	}
}

func TestStripToolMessageRepr_DoubleQuotedNameMarker(t *testing.T) {
	input := `content="hello world" name="tool" tool_call_id="id123"`
	got := stripToolMessageRepr(input)
	if got != "hello world" {
		t.Errorf("expected clean content, got %q", got)
	}
}

// =============================================================================
// stripToolMessageRepr — CommandUpdate repr Tests
// =============================================================================

func TestStripToolMessageRepr_CommandUpdate_SingleQuotedContent(t *testing.T) {
	input := `CommandUpdate('files': ['/workspace/.gitkeep'], 'messages': [ToolMessage(content='Updated file /workspace/.gitkeep', tool_call_id='toolu_01Fjf')])`
	got := stripToolMessageRepr(input)
	if got != "Updated file /workspace/.gitkeep" {
		t.Errorf("expected extracted ToolMessage content, got %q", got)
	}
}

func TestStripToolMessageRepr_CommandUpdate_DoubleQuotedContent(t *testing.T) {
	input := `CommandUpdate('files': ['/workspace/out.txt'], 'messages': [ToolMessage(content="Successfully wrote 42 characters to 'out.txt'", tool_call_id="toolu_abc")])`
	got := stripToolMessageRepr(input)
	if got != "Successfully wrote 42 characters to 'out.txt'" {
		t.Errorf("expected extracted ToolMessage content, got %q", got)
	}
}

func TestStripToolMessageRepr_CommandUpdate_NoToolMessage(t *testing.T) {
	// CommandUpdate without an extractable ToolMessage — returns the original string.
	input := `CommandUpdate('files': ['/workspace/out.txt'], 'status': 'ok')`
	got := stripToolMessageRepr(input)
	if got != input {
		t.Errorf("expected original string passthrough, got %q", got)
	}
}

func TestStripToolMessageRepr_CommandUpdate_EmptyContent(t *testing.T) {
	// ToolMessage with empty content — the extracted string is empty.
	input := `CommandUpdate('messages': [ToolMessage(content='', tool_call_id='toolu_x')])`
	got := stripToolMessageRepr(input)
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

// =============================================================================
// extractCommandUpdateContent Tests
// =============================================================================

func TestExtractCommandUpdateContent_SingleQuoted(t *testing.T) {
	input := `CommandUpdate('messages': [ToolMessage(content='file created', tool_call_id='id1')])`
	got := extractCommandUpdateContent(input)
	if got != "file created" {
		t.Errorf("expected %q, got %q", "file created", got)
	}
}

func TestExtractCommandUpdateContent_DoubleQuoted(t *testing.T) {
	input := `CommandUpdate('messages': [ToolMessage(content="hello world", tool_call_id="id1")])`
	got := extractCommandUpdateContent(input)
	if got != "hello world" {
		t.Errorf("expected %q, got %q", "hello world", got)
	}
}

func TestExtractCommandUpdateContent_NoToolMessage(t *testing.T) {
	input := `CommandUpdate('files': ['/workspace/out.txt'])`
	got := extractCommandUpdateContent(input)
	if got != input {
		t.Errorf("expected original string, got %q", got)
	}
}

func TestExtractCommandUpdateContent_ContentWithEmbeddedQuotes(t *testing.T) {
	// Double-quoted content that contains single quotes (common in file paths).
	input := `CommandUpdate('messages': [ToolMessage(content="Wrote to '/tmp/foo.txt'", tool_call_id="id2")])`
	got := extractCommandUpdateContent(input)
	if got != "Wrote to '/tmp/foo.txt'" {
		t.Errorf("expected %q, got %q", "Wrote to '/tmp/foo.txt'", got)
	}
}

// =============================================================================
// unquote Tests
// =============================================================================

func TestUnquote_SingleQuotes(t *testing.T) {
	if got := unquote("'hello'"); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestUnquote_DoubleQuotes(t *testing.T) {
	if got := unquote(`"hello"`); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestUnquote_MismatchedQuotes(t *testing.T) {
	if got := unquote(`"hello'`); got != `"hello'` {
		t.Errorf("expected passthrough for mismatched quotes, got %q", got)
	}
}

func TestUnquote_NoQuotes(t *testing.T) {
	if got := unquote("hello"); got != "hello" {
		t.Errorf("expected passthrough, got %q", got)
	}
}

func TestUnquote_Empty(t *testing.T) {
	if got := unquote(""); got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestUnquote_SingleChar(t *testing.T) {
	if got := unquote("x"); got != "x" {
		t.Errorf("expected passthrough for single char, got %q", got)
	}
}

func TestUnquote_EmptyQuoted(t *testing.T) {
	if got := unquote("''"); got != "" {
		t.Errorf("expected empty string from empty quotes, got %q", got)
	}
}

// =============================================================================
// formatFirstLinePreview Tests
// =============================================================================

func TestFormatFirstLinePreview_SingleLine(t *testing.T) {
	got := formatFirstLinePreview("package main")
	if got != "package main" {
		t.Errorf("expected %q, got %q", "package main", got)
	}
}

func TestFormatFirstLinePreview_MultiLine(t *testing.T) {
	got := formatFirstLinePreview("syntax = \"proto3\";\n\npackage ai.stigmer;")
	if got != "syntax = \"proto3\";" {
		t.Errorf("expected first line only, got %q", got)
	}
}

func TestFormatFirstLinePreview_Empty(t *testing.T) {
	got := formatFirstLinePreview("")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestFormatFirstLinePreview_WhitespaceOnly(t *testing.T) {
	got := formatFirstLinePreview("   \n\n  ")
	if got != "" {
		t.Errorf("expected empty for whitespace-only, got %q", got)
	}
}

func TestFormatFirstLinePreview_LeadingBlankLines(t *testing.T) {
	got := formatFirstLinePreview("\n\n\nimport os")
	if got != "import os" {
		t.Errorf("expected %q, got %q", "import os", got)
	}
}

func TestFormatFirstLinePreview_TruncatesLongLine(t *testing.T) {
	long := strings.Repeat("a", 200)
	got := formatFirstLinePreview(long)
	if len(got) > previewMaxWidth {
		t.Errorf("expected max %d chars, got %d", previewMaxWidth, len(got))
	}
	assertContains(t, got, "...")
}

func TestFormatFirstLinePreview_ReprContaminated(t *testing.T) {
	// Defense-in-depth: repr should be stripped before extracting first line.
	input := "content='import os\nimport sys' name='read' tool_call_id='toolu_xyz'"
	got := formatFirstLinePreview(input)
	if got != "import os" {
		t.Errorf("expected %q after repr stripping, got %q", "import os", got)
	}
}

// =============================================================================
// firstNonEmptyLine Tests
// =============================================================================

func TestFirstNonEmptyLine_Normal(t *testing.T) {
	got := firstNonEmptyLine("first\nsecond\nthird")
	if got != "first" {
		t.Errorf("expected %q, got %q", "first", got)
	}
}

func TestFirstNonEmptyLine_LeadingBlanks(t *testing.T) {
	got := firstNonEmptyLine("\n  \n\nactual content")
	if got != "actual content" {
		t.Errorf("expected %q, got %q", "actual content", got)
	}
}

func TestFirstNonEmptyLine_AllEmpty(t *testing.T) {
	got := firstNonEmptyLine("\n  \n\n  \n")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestFirstNonEmptyLine_SingleLine(t *testing.T) {
	got := firstNonEmptyLine("only line")
	if got != "only line" {
		t.Errorf("expected %q, got %q", "only line", got)
	}
}

func TestFirstNonEmptyLine_Empty(t *testing.T) {
	got := firstNonEmptyLine("")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

// =============================================================================
// RenderExpanded Tests
// =============================================================================

func TestRenderExpanded_KnownTool_WithResult(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Result: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hello\")\n}",
	})

	// Header should be present.
	assertContains(t, result, "📖")
	assertContains(t, result, "Read")
	assertContains(t, result, "main.go")

	// Full content should be shown with gutter.
	assertContains(t, result, "│ package main")
	assertContains(t, result, "│ import \"fmt\"")
	assertContains(t, result, "│ func main() {")

	// Should NOT have the "more lines" indicator (that's the preview).
	assertNotContains(t, result, "more lines")
}

func TestRenderExpanded_KnownTool_EmptyResult(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"path": "empty.txt"},
	})

	// Header should be present.
	assertContains(t, result, "📖")
	assertContains(t, result, "Read")
	assertContains(t, result, "empty.txt")

	// No gutter content since result is empty.
	assertNotContains(t, result, "│")
}

func TestRenderExpanded_DiscoveryTool_ShowsAllEntries(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "/workspace"},
		Result: "bin\netc\nhome\nopt\ntmp\nusr\nvar",
	})

	// Header present.
	assertContains(t, result, "📂")
	assertContains(t, result, "List")

	// All entries shown with gutter (not comma-joined like the preview).
	assertContains(t, result, "│ bin")
	assertContains(t, result, "│ etc")
	assertContains(t, result, "│ var")
}

func TestRenderExpanded_ShellTool_ShowsFullOutput(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls -la"},
		Result: "total 8\ndrwxr-xr-x  5 user staff 160 Feb 14 22:00 .\ndrwxr-xr-x 10 user staff 320 Feb 14 22:00 ..",
	})

	assertContains(t, result, "🖥 ")
	assertContains(t, result, "Shell")
	assertContains(t, result, "│ total 8")
	assertContains(t, result, "│ drwxr-xr-x  5 user staff")
}

func TestRenderExpanded_UnknownTool_WithResult(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name:   "custom_tool",
		Args:   map[string]interface{}{"input": "test"},
		Result: "line one\nline two",
	})

	assertContains(t, result, "🔧")
	assertContains(t, result, "custom_tool")
	assertContains(t, result, "│ line one")
	assertContains(t, result, "│ line two")
}

func TestRenderExpanded_UnknownTool_EmptyResult(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name: "custom_tool",
		Args: map[string]interface{}{"input": "test"},
	})

	assertContains(t, result, "🔧")
	assertContains(t, result, "custom_tool")
	assertNotContains(t, result, "│")
}

func TestRenderExpanded_IncludesMetadataSuffix(t *testing.T) {
	result := RenderExpanded(ToolCallInfo{
		Name:     "read_file",
		Args:     map[string]interface{}{"path": "main.go"},
		Result:   "package main",
		Duration: 5 * time.Millisecond,
	})

	// Should include size and duration in the header.
	assertContains(t, result, "5ms")
}

// =============================================================================
// Test Helpers
// =============================================================================

// assertContains checks that the visible text of s (with ANSI codes stripped)
// contains substr. This decouples content assertions from styling details.
func assertContains(t *testing.T, s, substr string) {
	t.Helper()
	plain := stripANSI(s)
	if !strings.Contains(plain, substr) {
		t.Errorf("expected output to contain %q\n  plain: %q", substr, plain)
	}
}

// assertNotContains checks that the visible text of s (with ANSI codes
// stripped) does NOT contain substr.
func assertNotContains(t *testing.T, s, substr string) {
	t.Helper()
	plain := stripANSI(s)
	if strings.Contains(plain, substr) {
		t.Errorf("expected output to NOT contain %q\n  plain: %q", substr, plain)
	}
}
