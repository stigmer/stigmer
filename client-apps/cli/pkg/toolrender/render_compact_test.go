package toolrender

import (
	"strings"
	"testing"
	"time"
)

// =============================================================================
// IsReadTool
// =============================================================================

func TestIsReadTool_ReadTools(t *testing.T) {
	readTools := []string{"read", "read_file"}
	for _, name := range readTools {
		if !IsReadTool(name) {
			t.Errorf("IsReadTool(%q) = false, want true", name)
		}
	}
}

func TestIsReadTool_NonReadTools(t *testing.T) {
	nonRead := []string{"shell", "write", "write_file", "edit", "delete_file", "glob", "grep", "task", "think", "custom_mcp_tool"}
	for _, name := range nonRead {
		if IsReadTool(name) {
			t.Errorf("IsReadTool(%q) = true, want false", name)
		}
	}
}

// =============================================================================
// RenderCompact — read tool, hyperlinks disabled
// =============================================================================

func TestRenderCompact_Read_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Status: "completed",
		Result: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hello\")\n}\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Read")
	assertContains(t, got, "main.go")
	assertContains(t, got, "8 lines")

	if !strings.Contains(plain, "Read(main.go)") {
		t.Errorf("expected header format Read(main.go), got:\n  %q", plain)
	}
}

func TestRenderCompact_Read_SingleLine(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "VERSION"},
		Status: "completed",
		Result: "1.0.0",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "1 line")
}

func TestRenderCompact_Read_EmptyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "empty.txt"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "0 lines")
}

func TestRenderCompact_Read_NoGutterPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Status: "completed",
		Result: "package main\nimport \"fmt\"\nfunc main() {}",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertNotContains(t, got, "│")
	assertNotContains(t, got, "⋮")
	if strings.Contains(plain, "package main") {
		t.Error("compact read should not include file content preview")
	}
}

func TestRenderCompact_Read_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Status: "completed",
		Result: "package main\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "📖")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

// =============================================================================
// RenderCompact — read tool, failed
// =============================================================================

func TestRenderCompact_Read_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "missing.go"},
		Status: "failed",
		Error:  "file not found",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "missing.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "file not found")
	assertNotContains(t, got, "lines")
}

func TestRenderCompact_Read_FailedWithLongError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "bad.go"},
		Status: "failed",
		Error:  strings.Repeat("a", 100),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines, got %d", len(lines))
	}
	if len(lines[1]) > 80 {
		t.Errorf("error line too long (%d chars), should be truncated", len(lines[1]))
	}
}

func TestRenderCompact_Read_ErrorWithEmptyErrorField(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "bad.go"},
		Status: "failed",
		Error:  "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "failed")
}

// =============================================================================
// RenderCompact — read tool, OSC 8 hyperlinks
// =============================================================================

func TestRenderCompact_Read_HyperlinksEnabled(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "/Users/dev/project/main.go"},
		Status: "completed",
		Result: "package main\n",
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, osc8Open) {
		t.Error("expected OSC 8 open sequence when hyperlinks enabled")
	}
	if !strings.Contains(got, osc8Close) {
		t.Error("expected OSC 8 close sequence when hyperlinks enabled")
	}
	if !strings.Contains(got, "file:///Users/dev/project/main.go") {
		t.Error("expected file:// URI in hyperlink")
	}
}

func TestRenderCompact_Read_HyperlinksDisabled_NoEscapes(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "/Users/dev/project/main.go"},
		Status: "completed",
		Result: "package main\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	if strings.Contains(got, osc8Open+"file://") {
		t.Error("should not contain OSC 8 file hyperlink when disabled")
	}
}

func TestRenderCompact_Read_RelativePathResolution(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "src/main.go"},
		Status: "completed",
		Result: "package main\n",
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkingDir:        "/Users/dev/project",
	}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, "file:///Users/dev/project/src/main.go") {
		t.Errorf("expected resolved absolute path in URI, got:\n  %q", got)
	}
	assertContains(t, got, "src/main.go")
}

func TestRenderCompact_Read_AbsolutePathNotDoubleResolved(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read",
		Args:   map[string]interface{}{"path": "/absolute/path/main.go"},
		Status: "completed",
		Result: "package main\n",
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkingDir:        "/Users/dev/project",
	}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, "file:///absolute/path/main.go") {
		t.Errorf("absolute path should not be joined with WorkingDir, got:\n  %q", got)
	}
}

// =============================================================================
// RenderCompact — read tool, arg fallback
// =============================================================================

func TestRenderCompact_Read_FallbackArgName(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"file_path": "README.md"},
		Status: "completed",
		Result: "# Title\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "README.md")
}

func TestRenderCompact_Read_EmptyPath(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{},
		Status: "completed",
		Result: "content\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	if !strings.Contains(plain, "Read()") {
		t.Errorf("expected Read() with empty parens for missing path, got:\n  %q", plain)
	}
}

// =============================================================================
// RenderCompact — fallback for non-read tools
// =============================================================================

func TestRenderCompact_ShellTool_FallsBackToRenderWithBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls -la"},
		Status: "completed",
		Result: "file1\nfile2",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "🖥 ")
	assertContains(t, got, "Shell")
	assertContains(t, got, "ls -la")
	assertContains(t, got, "✓")
}

func TestRenderCompact_WriteTool_FallsBackToRenderWithBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "out.txt", "contents": "hello"},
		Status: "completed",
		Result: "wrote 5 bytes",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "📝")
	assertContains(t, got, "Write")
}

func TestRenderCompact_UnknownTool_FallsBackToRenderWithBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:     "custom_mcp_tool",
		Args:     map[string]interface{}{"query": "test"},
		Status:   "completed",
		Result:   "result",
		Duration: 50 * time.Millisecond,
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "🔧")
	assertContains(t, got, "custom_mcp_tool")
}

// =============================================================================
// buildHyperlinkedPath
// =============================================================================

func TestBuildHyperlinkedPath_Disabled_ReturnsPlainPath(t *testing.T) {
	got := buildHyperlinkedPath("src/main.go", CompactOptions{HyperlinksEnabled: false})
	if got != "src/main.go" {
		t.Errorf("expected plain path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_EmptyPath(t *testing.T) {
	got := buildHyperlinkedPath("", CompactOptions{HyperlinksEnabled: true})
	if got != "" {
		t.Errorf("expected empty string for empty path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_AbsolutePathIgnoresWorkingDir(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkingDir:        "/should/not/appear",
	}
	got := buildHyperlinkedPath("/absolute/file.go", opts)
	if strings.Contains(got, "should/not/appear") {
		t.Errorf("absolute path should not be joined with WorkingDir, got %q", got)
	}
	if !strings.Contains(got, "file:///absolute/file.go") {
		t.Errorf("expected file URI for absolute path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_RelativePathResolvedWithWorkingDir(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkingDir:        "/workspace",
	}
	got := buildHyperlinkedPath("src/main.go", opts)
	if !strings.Contains(got, "file:///workspace/src/main.go") {
		t.Errorf("expected resolved path in URI, got %q", got)
	}
	if !strings.Contains(got, "src/main.go"+osc8Close) {
		t.Errorf("display text should be the original relative path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_RelativePathNoWorkingDir(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkingDir:        "",
	}
	got := buildHyperlinkedPath("src/main.go", opts)
	if !strings.Contains(got, "file://src/main.go") {
		t.Errorf("expected relative path used as-is in URI, got %q", got)
	}
}
