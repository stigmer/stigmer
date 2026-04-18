package toolrender

import (
	"fmt"
	"os"
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
// IsThinkTool
// =============================================================================

func TestIsThinkTool_ThinkTool(t *testing.T) {
	if !IsThinkTool("think") {
		t.Error("IsThinkTool(\"think\") = false, want true")
	}
}

func TestIsThinkTool_NonThinkTools(t *testing.T) {
	nonThink := []string{"read", "shell", "write", "edit", "task", "custom_mcp_tool"}
	for _, name := range nonThink {
		if IsThinkTool(name) {
			t.Errorf("IsThinkTool(%q) = true, want false", name)
		}
	}
}

// =============================================================================
// IsWriteOrEditTool
// =============================================================================

func TestIsWriteOrEditTool_WriteTools(t *testing.T) {
	writeTools := []string{"write", "write_file", "create_file", "overwrite_file"}
	for _, name := range writeTools {
		if !IsWriteOrEditTool(name) {
			t.Errorf("IsWriteOrEditTool(%q) = false, want true", name)
		}
	}
}

func TestIsWriteOrEditTool_EditTools(t *testing.T) {
	editTools := []string{"edit", "edit_file"}
	for _, name := range editTools {
		if !IsWriteOrEditTool(name) {
			t.Errorf("IsWriteOrEditTool(%q) = false, want true", name)
		}
	}
}

func TestIsWriteOrEditTool_NonWriteEditTools(t *testing.T) {
	nonWrite := []string{"read", "read_file", "shell", "bash", "delete_file", "glob", "grep", "task", "think", "custom_mcp_tool"}
	for _, name := range nonWrite {
		if IsWriteOrEditTool(name) {
			t.Errorf("IsWriteOrEditTool(%q) = true, want false", name)
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
// RenderCompact — read tool, error embedded in result
// =============================================================================

func TestRenderCompact_Read_ErrorInResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "missing.go"},
		Status: "completed",
		Result: "Error: File not found: 'missing.go' (resolved to '/workspace/missing.go')\n\nRecovery suggestions:\n- Try using ls or glob to discover available files/resources\n- Check if the path is correct\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "missing.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "File not found")
	assertNotContains(t, got, "lines")
}

func TestRenderCompact_Read_ErrorInResult_ShowsFirstLine(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "bad.go"},
		Status: "completed",
		Result: "Error: Permission denied\n\nRecovery suggestions:\n- Check file permissions\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "Permission denied")
	assertNotContains(t, got, "Recovery suggestions")
}

func TestRenderCompact_Read_ErrorInResult_ExplicitErrorTakesPriority(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "bad.go"},
		Status: "failed",
		Error:  "explicit error",
		Result: "Error: result error",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "explicit error")
}

func TestRenderCompact_Read_NormalResultNotMistaken(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "errors.go"},
		Status: "completed",
		Result: "package errors\n\nfunc New(msg string) error {\n\treturn &errorString{msg}\n}\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "6 lines")
	assertNotContains(t, got, "✗")
}

// =============================================================================
// RenderReadGroup — error embedded in result
// =============================================================================

func TestRenderReadGroup_WithErrorInResult_HeaderShowsCount(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}, Status: "completed", Result: "package main\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "missing.go"}, Status: "completed", Result: "Error: File not found: 'missing.go'\n\nRecovery suggestions:\n- Check path\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "config.go"}, Status: "completed", Result: "package config\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)

	assertContains(t, got, "3 files")
	assertContains(t, got, "(1 failed)")
	assertContains(t, got, "main.go")
	assertContains(t, got, "missing.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "File not found")
	assertContains(t, got, "config.go")
}

func TestRenderReadGroup_AllErrorInResult(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}, Status: "completed", Result: "Error: not found\n\nRecovery suggestions:\n- Check path\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}, Status: "completed", Result: "Error: permission denied\n\nRecovery suggestions:\n- Check permissions\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)

	assertContains(t, got, "2 files")
	assertContains(t, got, "(2 failed)")
	assertNotContains(t, got, "lines")
}

// =============================================================================
// extractResultError
// =============================================================================

func TestExtractResultError_ErrorPrefix(t *testing.T) {
	got := extractResultError("Error: File not found\n\nRecovery suggestions:\n- Check path\n")
	if got != "File not found" {
		t.Errorf("expected %q, got %q", "File not found", got)
	}
}

func TestExtractResultError_ErrorPrefixNoNewline(t *testing.T) {
	got := extractResultError("Error: Permission denied")
	if got != "Permission denied" {
		t.Errorf("expected %q, got %q", "Permission denied", got)
	}
}

func TestExtractResultError_NormalContent(t *testing.T) {
	got := extractResultError("package main\nfunc main() {}\n")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestExtractResultError_Empty(t *testing.T) {
	got := extractResultError("")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestExtractResultError_ContentWithErrorWord(t *testing.T) {
	got := extractResultError("errors.New(\"something\")\n")
	if got != "" {
		t.Errorf("expected empty (content starts with 'errors' not 'Error: '), got %q", got)
	}
}

// =============================================================================
// toolCallError
// =============================================================================

func TestToolCallError_ExplicitError(t *testing.T) {
	tc := ToolCallInfo{Status: "failed", Error: "explicit"}
	if got := toolCallError(tc); got != "explicit" {
		t.Errorf("expected %q, got %q", "explicit", got)
	}
}

func TestToolCallError_FailedNoError(t *testing.T) {
	tc := ToolCallInfo{Status: "failed"}
	if got := toolCallError(tc); got != "failed" {
		t.Errorf("expected %q, got %q", "failed", got)
	}
}

func TestToolCallError_ErrorInResult(t *testing.T) {
	tc := ToolCallInfo{Status: "completed", Result: "Error: not found\n\nRecovery:\n- hint\n"}
	if got := toolCallError(tc); got != "not found" {
		t.Errorf("expected %q, got %q", "not found", got)
	}
}

func TestToolCallError_NoError(t *testing.T) {
	tc := ToolCallInfo{Status: "completed", Result: "package main\n"}
	if got := toolCallError(tc); got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestToolCallError_ExplicitErrorPriority(t *testing.T) {
	tc := ToolCallInfo{Status: "failed", Error: "explicit", Result: "Error: result error\n"}
	if got := toolCallError(tc); got != "explicit" {
		t.Errorf("expected explicit error to take priority, got %q", got)
	}
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
		WorkspaceRoots:    []string{"/Users/dev/project"},
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
		WorkspaceRoots:    []string{"/Users/dev/project"},
	}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, "file:///absolute/path/main.go") {
		t.Errorf("absolute path should not be joined with WorkspaceRoots, got:\n  %q", got)
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
// RenderCompact — write tool, hyperlinks disabled
// =============================================================================

func TestRenderCompact_Write_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "config.go", "contents": "package config\n\nvar Port = 8080\n"},
		Status: "completed",
		Result: "wrote 32 bytes",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Write")
	assertContains(t, got, "config.go")
	assertContains(t, got, "Wrote")
	assertContains(t, got, "4 lines")

	if !strings.Contains(plain, "Write(config.go)") {
		t.Errorf("expected header format Write(config.go), got:\n  %q", plain)
	}
}

func TestRenderCompact_Write_LineCountFromArgsNotResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "out.txt", "contents": "line1\nline2\nline3\nline4\nline5\n"},
		Status: "completed",
		Result: "wrote 30 bytes",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Wrote 6 lines")
	assertNotContains(t, got, "wrote 30 bytes")
}

func TestRenderCompact_Write_SingleLine(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write",
		Args:   map[string]interface{}{"path": "VERSION", "contents": "1.0.0"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Wrote 1 line")
}

func TestRenderCompact_Write_EmptyContent(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "empty.txt", "contents": ""},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Wrote 0 lines")
}

func TestRenderCompact_Write_NoGutterPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "main.go", "contents": "package main\nimport \"fmt\"\nfunc main() {}"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertNotContains(t, got, "│")
	assertNotContains(t, got, "⋮")
	if strings.Contains(plain, "package main") {
		t.Error("compact write should not include file content preview")
	}
}

func TestRenderCompact_Write_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "out.txt", "contents": "hello\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "📝")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

// =============================================================================
// RenderCompact — write tool, failed
// =============================================================================

func TestRenderCompact_Write_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "/readonly/file.go", "contents": "data"},
		Status: "failed",
		Error:  "permission denied",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "/readonly/file.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "permission denied")
	assertNotContains(t, got, "lines")
	assertNotContains(t, got, "Wrote")
}

func TestRenderCompact_Write_FailedWithLongError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "bad.go", "contents": "data"},
		Status: "failed",
		Error:  strings.Repeat("x", 100),
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

func TestRenderCompact_Write_FailedEmptyErrorField(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "bad.go", "contents": "data"},
		Status: "failed",
		Error:  "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "failed")
}

// =============================================================================
// RenderCompact — write tool, OSC 8 hyperlinks
// =============================================================================

func TestRenderCompact_Write_HyperlinksEnabled(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "/Users/dev/project/out.go", "contents": "package out\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, osc8Open) {
		t.Error("expected OSC 8 open sequence when hyperlinks enabled")
	}
	if !strings.Contains(got, "file:///Users/dev/project/out.go") {
		t.Error("expected file:// URI in hyperlink")
	}
}

func TestRenderCompact_Write_HyperlinksDisabled_NoEscapes(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "/Users/dev/project/out.go", "contents": "data\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	if strings.Contains(got, osc8Open+"file://") {
		t.Error("should not contain OSC 8 file hyperlink when disabled")
	}
}

func TestRenderCompact_Write_RelativePathResolution(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write",
		Args:   map[string]interface{}{"path": "src/out.go", "contents": "package out\n"},
		Status: "completed",
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots:    []string{"/Users/dev/project"},
	}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, "file:///Users/dev/project/src/out.go") {
		t.Errorf("expected resolved absolute path in URI, got:\n  %q", got)
	}
	assertContains(t, got, "src/out.go")
}

// =============================================================================
// RenderCompact — write tool, content arg fallback
// =============================================================================

func TestRenderCompact_Write_FallbackContentArg(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "out.txt", "content": "line1\nline2\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Wrote 3 lines")
}

func TestRenderCompact_Write_EmptyPath(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"contents": "data\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	if !strings.Contains(plain, "Write()") {
		t.Errorf("expected Write() with empty parens for missing path, got:\n  %q", plain)
	}
}

// =============================================================================
// RenderCompact — edit tool
// =============================================================================

func TestRenderCompact_Edit_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "edit_file",
		Args:   map[string]interface{}{"path": "main.go", "new_text": "func updated() {\n\treturn nil\n}\n"},
		Status: "completed",
		Result: "edit applied",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Edit")
	assertContains(t, got, "main.go")
	assertContains(t, got, "Edited")
	assertContains(t, got, "4 lines")

	if !strings.Contains(plain, "Edit(main.go)") {
		t.Errorf("expected header format Edit(main.go), got:\n  %q", plain)
	}
}

func TestRenderCompact_Edit_FallbackArgName_NewString(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "edit",
		Args:   map[string]interface{}{"path": "util.go", "new_string": "replacement\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Edited 2 lines")
}

func TestRenderCompact_Edit_FallbackArgName_Replacement(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "edit",
		Args:   map[string]interface{}{"path": "util.go", "replacement": "new content\nmore content\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Edited 3 lines")
}

func TestRenderCompact_Edit_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "edit_file",
		Args:   map[string]interface{}{"path": "main.go", "new_text": "update\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "✏️")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

// =============================================================================
// RenderCompact — create_file tool
// =============================================================================

func TestRenderCompact_CreateFile_UsesCreatedVerb(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "create_file",
		Args:   map[string]interface{}{"path": "README.md", "contents": "# Title\n\nDescription\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "Created")
	assertContains(t, got, "4 lines")

	if !strings.Contains(plain, "Create(README.md)") {
		t.Errorf("expected header format Create(README.md), got:\n  %q", plain)
	}
}

// =============================================================================
// RenderCompact — fallback for non-compact tools
// =============================================================================

// =============================================================================
// RenderCompact — shell tool, basic format
// =============================================================================

func TestRenderCompact_Shell_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "completed",
		Result: "ok  pkg/foo  0.5s\nok  pkg/bar  1.2s\nok  pkg/baz  0.3s\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Shell")
	assertContains(t, got, "go test ./...")
	assertContains(t, got, "ok  pkg/foo")
	assertContains(t, got, "ok  pkg/bar")
	assertContains(t, got, "ok  pkg/baz")

	if !strings.Contains(plain, "Shell(go test ./...)") {
		t.Errorf("expected header format Shell(go test ./...), got:\n  %q", plain)
	}
}

func TestRenderCompact_Shell_NoExitCode(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls -la"},
		Status: "completed",
		Result: "file1\nfile2",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	if strings.Contains(strings.ToLower(plain), "exit") {
		t.Errorf("compact shell should not display exit code, got:\n  %q", plain)
	}
}

func TestRenderCompact_Shell_OutputTruncation(t *testing.T) {
	lines := make([]string, 20)
	for i := range lines {
		lines[i] = fmt.Sprintf("line %d output", i+1)
	}
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "cat big.log"},
		Status: "completed",
		Result: strings.Join(lines, "\n") + "\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "line 1 output")
	assertContains(t, got, "line 2 output")
	assertContains(t, got, "line 3 output")
	assertNotContains(t, got, "line 4 output")
	assertContains(t, got, "+17 more lines")

	outputLines := strings.Split(plain, "\n")
	if len(outputLines) != 5 {
		t.Errorf("expected 5 lines (header + 3 output + footer), got %d:\n%s", len(outputLines), plain)
	}
}

func TestRenderCompact_Shell_SmartCutoff_FourLines(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls"},
		Status: "completed",
		Result: "a.go\nb.go\nc.go\nd.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "a.go")
	assertContains(t, got, "b.go")
	assertContains(t, got, "c.go")
	assertContains(t, got, "d.go")
	assertNotContains(t, got, "more lines")
}

func TestRenderCompact_Shell_ShortOutput(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls *.go"},
		Status: "completed",
		Result: "main.go\nutil.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "main.go")
	assertContains(t, got, "util.go")
	assertNotContains(t, got, "more lines")
}

func TestRenderCompact_Shell_NoOutput(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "mkdir -p tmp"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "mkdir -p tmp")
	assertContains(t, got, "(no output)")
}

func TestRenderCompact_Shell_WhitespaceOnlyOutput(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "true"},
		Status: "completed",
		Result: "   \n\n  \n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "(no output)")
}

// =============================================================================
// RenderCompact — shell tool, failed
// =============================================================================

func TestRenderCompact_Shell_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go build ./..."},
		Status: "failed",
		Error:  "compilation failed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "go build ./...")
	assertContains(t, got, "✗")
	assertContains(t, got, "compilation failed")
	assertNotContains(t, got, "lines")
}

func TestRenderCompact_Shell_FailedEmptyError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "bad_cmd"},
		Status: "failed",
		Error:  "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "failed")
}

func TestRenderCompact_Shell_FailedLongError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "compile"},
		Status: "failed",
		Error:  strings.Repeat("e", 100),
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

// =============================================================================
// RenderCompact — shell tool, command truncation
// =============================================================================

func TestRenderCompact_Shell_LongCommandTruncated(t *testing.T) {
	longCmd := "find /Users/suresh/scm/github.com/stigmer/stigmer -type f -name '*.go' | sort | head -20"
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": longCmd},
		Status: "completed",
		Result: "file1.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	headerLine := strings.Split(plain, "\n")[0]
	if len(headerLine) > 80 {
		t.Errorf("header too long (%d chars), command should be truncated:\n  %q", len(headerLine), headerLine)
	}
	if !strings.Contains(headerLine, "...") {
		t.Errorf("truncated command should end with ..., got:\n  %q", headerLine)
	}
}

func TestRenderCompact_Shell_MultilineCommandUsesFirstLine(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "echo hello\necho world"},
		Status: "completed",
		Result: "hello\nworld\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	headerLine := strings.Split(plain, "\n")[0]
	if strings.Contains(headerLine, "echo world") {
		t.Errorf("header should only contain first line of command, got:\n  %q", headerLine)
	}
	if !strings.Contains(headerLine, "Shell(echo hello)") {
		t.Errorf("expected Shell(echo hello) in header, got:\n  %q", headerLine)
	}
}

// =============================================================================
// RenderCompact — shell tool, style constraints
// =============================================================================

func TestRenderCompact_Shell_NoGutterPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls -la"},
		Status: "completed",
		Result: "file1\nfile2\nfile3\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertNotContains(t, got, "│")
	assertNotContains(t, got, "⋮")
}

func TestRenderCompact_Shell_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "ls"},
		Status: "completed",
		Result: "output\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "🖥")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

// =============================================================================
// RenderCompact — shell tool, legacy result cleaning
// =============================================================================

func TestRenderCompact_Shell_LegacyResultCleaned(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "hostname"},
		Status: "completed",
		Result: "Exit code: 0\nSTDOUT:\nmy-hostname",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "my-hostname")
	if strings.Contains(plain, "Exit code") {
		t.Errorf("legacy exit code prefix should be cleaned, got:\n  %q", plain)
	}
	if strings.Contains(plain, "STDOUT") {
		t.Errorf("legacy STDOUT label should be cleaned, got:\n  %q", plain)
	}
}

// =============================================================================
// RenderCompact — shell tool, aliases
// =============================================================================

func TestRenderCompact_Shell_BashAlias(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "bash",
		Args:   map[string]interface{}{"command": "echo hello"},
		Status: "completed",
		Result: "hello\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Shell")
	if !strings.Contains(plain, "Shell(echo hello)") {
		t.Errorf("bash alias should render as Shell, got:\n  %q", plain)
	}
}

func TestRenderCompact_Shell_ExecuteAlias(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "execute",
		Args:   map[string]interface{}{"command": "date"},
		Status: "completed",
		Result: "Mon Mar 4 2026\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Execute")
	if !strings.Contains(plain, "Execute(date)") {
		t.Errorf("execute alias should render with Execute label, got:\n  %q", plain)
	}
}

func TestRenderCompact_Shell_ExecuteCommandAlias(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "execute_command",
		Args:   map[string]interface{}{"command": "pwd"},
		Status: "completed",
		Result: "/home/user\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "●")
	assertContains(t, got, "Shell")
	assertContains(t, got, "pwd")
	assertContains(t, got, "/home/user")
}

// =============================================================================
// RenderCompact — fallback for non-compact tools
// =============================================================================

func TestRenderCompact_UnknownTool_UsesCompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:     "custom_mcp_tool",
		Args:     map[string]interface{}{"query": "test"},
		Status:   "completed",
		Result:   "result",
		Duration: 50 * time.Millisecond,
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "●")
	assertContains(t, got, "custom_mcp_tool")
	assertContains(t, got, "query")
	assertContains(t, got, "result")
	assertNotContains(t, got, "*")
}

// =============================================================================
// RenderCompactRunning
// =============================================================================

func TestRenderCompactRunning_WriteTool_CompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "config.go", "contents": "data"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Write")
	assertContains(t, got, "config.go")
	assertContains(t, got, "…")

	if !strings.Contains(plain, "Write(config.go)") {
		t.Errorf("expected compact header Write(config.go), got:\n  %q", plain)
	}
	assertNotContains(t, got, "📝")
	assertNotContains(t, got, "⏳")
}

func TestRenderCompactRunning_EditTool_CompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name: "edit_file",
		Args: map[string]interface{}{"path": "main.go", "new_text": "update"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "Edit")
	if !strings.Contains(plain, "Edit(main.go)") {
		t.Errorf("expected compact header Edit(main.go), got:\n  %q", plain)
	}
	assertContains(t, got, "…")
}

func TestRenderCompactRunning_ReadTool_CompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"path": "main.go"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "…")
	if !strings.Contains(plain, "Read(main.go)") {
		t.Errorf("expected compact header Read(main.go), got:\n  %q", plain)
	}
}

func TestRenderCompactRunning_ShellTool_CompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": "go test ./..."},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Shell")
	assertContains(t, got, "go test ./...")
	assertContains(t, got, "…")

	if !strings.Contains(plain, "Shell(go test ./...)") {
		t.Errorf("expected compact header Shell(go test ./...), got:\n  %q", plain)
	}
	assertNotContains(t, got, "🖥")
	assertNotContains(t, got, "⏳")
}

func TestRenderCompactRunning_ShellTool_LongCommandTruncated(t *testing.T) {
	longCmd := "find /Users/suresh/scm/github.com/stigmer -type f -name '*.go' | sort | head -20"
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": longCmd},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	if len(plain) > 85 {
		t.Errorf("running header too long (%d chars), command should be truncated:\n  %q", len(plain), plain)
	}
	if !strings.Contains(plain, "...") {
		t.Errorf("truncated command should end with ..., got:\n  %q", plain)
	}
}

func TestRenderCompactRunning_ShellTool_SingleLine(t *testing.T) {
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": "ls -la"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 1 {
		t.Errorf("expected single line for running state, got %d:\n%s", len(lines), plain)
	}
}

func TestRenderCompactRunning_UnknownTool_UsesCompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name: "custom_mcp_tool",
		Args: map[string]interface{}{"query": "test"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	assertContains(t, got, "●")
	assertContains(t, got, "custom_mcp_tool")
	assertContains(t, got, "…")
	assertNotContains(t, got, "*")
}

func TestRenderCompactRunning_HyperlinksEnabled(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "/Users/dev/out.go", "contents": "data"},
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompactRunning(tc, opts)

	if !strings.Contains(got, osc8Open) {
		t.Error("expected OSC 8 open sequence when hyperlinks enabled")
	}
	if !strings.Contains(got, "file:///Users/dev/out.go") {
		t.Error("expected file:// URI in hyperlink")
	}
}

func TestRenderCompactRunning_SingleLineOutput(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "out.go", "contents": "data"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 1 {
		t.Errorf("expected single line for running state, got %d:\n%s", len(lines), plain)
	}
}

// =============================================================================
// RenderReadGroup
// =============================================================================

func TestRenderReadGroup_ThreeFiles_AllShown(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}, Status: "completed", Result: "package main\nfunc main() {}\n"},
		{Name: "read", Args: map[string]interface{}{"path": "config.go"}, Status: "completed", Result: "package config\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "util.go"}, Status: "completed", Result: strings.Repeat("line\n", 50)},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Read")
	assertContains(t, got, "3 files")
	assertContains(t, got, "main.go")
	assertContains(t, got, "config.go")
	assertContains(t, got, "util.go")
	assertContains(t, got, "3 lines")
	assertContains(t, got, "2 lines")
	assertContains(t, got, "51 lines")
	assertNotContains(t, got, "more")

	lines := strings.Split(plain, "\n")
	if len(lines) != 4 {
		t.Errorf("expected 4 lines (header + 3 entries), got %d:\n%s", len(lines), plain)
	}
}

func TestRenderReadGroup_FourFiles_AllShown_SmartCutoff(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}, Status: "completed", Result: "line\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}, Status: "completed", Result: "line\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "c.go"}, Status: "completed", Result: "line\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "d.go"}, Status: "completed", Result: "line\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)
	plain := stripANSI(got)

	assertContains(t, got, "4 files")
	assertContains(t, got, "a.go")
	assertContains(t, got, "b.go")
	assertContains(t, got, "c.go")
	assertContains(t, got, "d.go")
	assertNotContains(t, got, "more")

	lines := strings.Split(plain, "\n")
	if len(lines) != 5 {
		t.Errorf("expected 5 lines (header + 4 entries), got %d:\n%s", len(lines), plain)
	}
}

func TestRenderReadGroup_SixFiles_Truncated(t *testing.T) {
	reads := make([]ToolCallInfo, 6)
	for i := range reads {
		reads[i] = ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("file%d.go", i)},
			Status: "completed",
			Result: "content\n",
		}
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)
	plain := stripANSI(got)

	assertContains(t, got, "6 files")
	assertContains(t, got, "file0.go")
	assertContains(t, got, "file1.go")
	assertContains(t, got, "file2.go")
	assertNotContains(t, got, "file3.go")
	assertNotContains(t, got, "file4.go")
	assertNotContains(t, got, "file5.go")
	assertContains(t, got, "+3 more")

	lines := strings.Split(plain, "\n")
	if len(lines) != 5 {
		t.Errorf("expected 5 lines (header + 3 entries + footer), got %d:\n%s", len(lines), plain)
	}
}

func TestRenderReadGroup_WithFailure_HeaderShowsCount(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}, Status: "completed", Result: "package main\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "missing.go"}, Status: "failed", Error: "file not found"},
		{Name: "read_file", Args: map[string]interface{}{"path": "config.go"}, Status: "completed", Result: "package config\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)

	assertContains(t, got, "3 files")
	assertContains(t, got, "(1 failed)")
	assertContains(t, got, "main.go")
	assertContains(t, got, "missing.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "file not found")
	assertContains(t, got, "config.go")
}

func TestRenderReadGroup_AllFailed(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}, Status: "failed", Error: "not found"},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}, Status: "failed", Error: "permission denied"},
		{Name: "read_file", Args: map[string]interface{}{"path": "c.go"}, Status: "failed", Error: ""},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)

	assertContains(t, got, "3 files")
	assertContains(t, got, "(3 failed)")
	assertContains(t, got, "a.go")
	assertContains(t, got, "not found")
	assertContains(t, got, "b.go")
	assertContains(t, got, "permission denied")
	assertContains(t, got, "c.go")
	assertContains(t, got, "failed")
	assertNotContains(t, got, "lines")
}

func TestRenderReadGroup_HyperlinksEnabled(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "/Users/dev/main.go"}, Status: "completed", Result: "code\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "/Users/dev/config.go"}, Status: "completed", Result: "code\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "/Users/dev/util.go"}, Status: "completed", Result: "code\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderReadGroup(reads, opts)

	if !strings.Contains(got, osc8Open) {
		t.Error("expected OSC 8 open sequence when hyperlinks enabled")
	}
	if !strings.Contains(got, "file:///Users/dev/main.go") {
		t.Error("expected file:// URI for main.go")
	}
	if !strings.Contains(got, "file:///Users/dev/config.go") {
		t.Error("expected file:// URI for config.go")
	}
}

func TestRenderReadGroup_HyperlinksDisabled(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "/Users/dev/main.go"}, Status: "completed", Result: "code\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "/Users/dev/config.go"}, Status: "completed", Result: "code\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "/Users/dev/util.go"}, Status: "completed", Result: "code\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)

	if strings.Contains(got, osc8Open) {
		t.Error("should not contain OSC 8 when hyperlinks disabled")
	}
	assertContains(t, got, "/Users/dev/main.go")
	assertContains(t, got, "/Users/dev/config.go")
}

func TestRenderReadGroup_SingleFile_Defensive(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "solo.go"}, Status: "completed", Result: "package solo\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroup(reads, opts)

	assertContains(t, got, "1 files")
	assertContains(t, got, "solo.go")
	assertNotContains(t, got, "more")
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

func TestBuildHyperlinkedPath_AbsolutePathIgnoresWorkspaceRoots(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots:    []string{"/should/not/appear"},
	}
	got := buildHyperlinkedPath("/absolute/file.go", opts)
	if strings.Contains(got, "should/not/appear") {
		t.Errorf("absolute path should not be joined with WorkspaceRoots, got %q", got)
	}
	if !strings.Contains(got, "file:///absolute/file.go") {
		t.Errorf("expected file URI for absolute path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_RelativePathResolvedWithSingleRoot(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots:    []string{"/workspace"},
	}
	got := buildHyperlinkedPath("src/main.go", opts)
	if !strings.Contains(got, "file:///workspace/src/main.go") {
		t.Errorf("expected resolved path in URI, got %q", got)
	}
	if !strings.Contains(got, "src/main.go"+osc8Close) {
		t.Errorf("display text should be the original relative path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_RelativePathNoRoots_DegradesToPlainText(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots:    nil,
	}
	got := buildHyperlinkedPath("src/main.go", opts)
	if got != "src/main.go" {
		t.Errorf("relative path with no roots should degrade to plain text, got %q", got)
	}
}

// =============================================================================
// buildHyperlinkedPath — PlatformDir (.stigmer/ virtual mount)
// =============================================================================

func TestBuildHyperlinkedPath_StigmerPrefix_ResolvedViaPlatformDir(t *testing.T) {
	existingPaths := map[string]bool{
		"/home/user/.stigmer/sessions/ses-abc/platform/skills/mcp-creator/SKILL.md": true,
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		PlatformDir:       "/home/user/.stigmer/sessions/ses-abc/platform",
		StatFunc: func(path string) (os.FileInfo, error) {
			if existingPaths[path] {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath(".stigmer/skills/mcp-creator/SKILL.md", opts)
	if !strings.Contains(got, "file:///home/user/.stigmer/sessions/ses-abc/platform/skills/mcp-creator/SKILL.md") {
		t.Errorf("expected .stigmer/ path resolved via PlatformDir, got %q", got)
	}
	if !strings.Contains(got, ".stigmer/skills/mcp-creator/SKILL.md"+osc8Close) {
		t.Errorf("display text should be the original path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_StigmerPrefix_NonexistentFile_DegradesToPlainText(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		PlatformDir:       "/home/user/.stigmer/sessions/ses-abc/platform",
		StatFunc: func(path string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath(".stigmer/skills/nonexistent/SKILL.md", opts)
	if got != ".stigmer/skills/nonexistent/SKILL.md" {
		t.Errorf("nonexistent .stigmer/ path should degrade to plain text, got %q", got)
	}
}

func TestBuildHyperlinkedPath_StigmerPrefix_NoPlatformDir_DegradesToPlainText(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		PlatformDir:       "",
		StatFunc: func(path string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath(".stigmer/skills/test/SKILL.md", opts)
	if got != ".stigmer/skills/test/SKILL.md" {
		t.Errorf("no PlatformDir should degrade to plain text, got %q", got)
	}
}

func TestBuildHyperlinkedPath_StigmerPrefix_PriorityOverWorkspaceRoots(t *testing.T) {
	existingPaths := map[string]bool{
		"/platform/skills/test/SKILL.md":           true,
		"/workspace/.stigmer/skills/test/SKILL.md": true,
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots:    []string{"/workspace"},
		PlatformDir:       "/platform",
		StatFunc: func(path string) (os.FileInfo, error) {
			if existingPaths[path] {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath(".stigmer/skills/test/SKILL.md", opts)
	if !strings.Contains(got, "file:///platform/skills/test/SKILL.md") {
		t.Errorf(".stigmer/ should resolve via PlatformDir, not workspace root, got %q", got)
	}
}

// =============================================================================
// buildHyperlinkedPath — SandboxRoot fallback
// =============================================================================

func TestBuildHyperlinkedPath_SandboxRoot_GitWorkspaceResolved(t *testing.T) {
	existingPaths := map[string]bool{
		"/home/user/.stigmer/data/workspace/sessions/ses-abc/my-repo/README.md": true,
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		SandboxRoot:       "/home/user/.stigmer/data/workspace/sessions/ses-abc",
		StatFunc: func(path string) (os.FileInfo, error) {
			if existingPaths[path] {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath("my-repo/README.md", opts)
	if !strings.Contains(got, "file:///home/user/.stigmer/data/workspace/sessions/ses-abc/my-repo/README.md") {
		t.Errorf("expected sandbox root resolution for git workspace, got %q", got)
	}
}

func TestBuildHyperlinkedPath_SandboxRoot_NonexistentFile_DegradesToPlainText(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		SandboxRoot:       "/home/user/.stigmer/data/workspace/sessions/ses-abc",
		StatFunc: func(path string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath("nonexistent-repo/file.go", opts)
	if got != "nonexistent-repo/file.go" {
		t.Errorf("nonexistent sandbox path should degrade to plain text, got %q", got)
	}
}

func TestBuildHyperlinkedPath_WorkspaceRoots_PreferredOverSandboxRoot(t *testing.T) {
	existingPaths := map[string]bool{
		"/sandbox/ses-abc/my-app/main.go": true,
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots: []string{
			"/Users/dev/scm/github.com/org/my-app",
			"/Users/dev/scm/github.com/org/other",
		},
		SandboxRoot: "/sandbox/ses-abc",
		StatFunc: func(path string) (os.FileInfo, error) {
			if existingPaths[path] {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath("my-app/main.go", opts)
	if !strings.Contains(got, "file:///Users/dev/scm/github.com/org/my-app/main.go") {
		t.Errorf("workspace roots basename match should be preferred over sandbox root, got %q", got)
	}
}

func TestBuildHyperlinkedPath_NoRootsNoSandbox_DegradesToPlainText(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
	}
	got := buildHyperlinkedPath("some/path.go", opts)
	if got != "some/path.go" {
		t.Errorf("no roots, no sandbox → plain text, got %q", got)
	}
}

// =============================================================================
// statProbe
// =============================================================================

func TestStatProbe_FileExists(t *testing.T) {
	fn := func(path string) (os.FileInfo, error) {
		if path == "/exists" {
			return nil, nil
		}
		return nil, os.ErrNotExist
	}
	if !statProbe("/exists", fn) {
		t.Error("statProbe should return true for existing path")
	}
}

func TestStatProbe_FileNotExists(t *testing.T) {
	fn := func(path string) (os.FileInfo, error) {
		return nil, os.ErrNotExist
	}
	if statProbe("/missing", fn) {
		t.Error("statProbe should return false for missing path")
	}
}

func TestBuildHyperlinkedPath_MultiRoot_MatchesWorkspaceName(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots: []string{
			"/Users/dev/scm/github.com/org/frontend",
			"/Users/dev/scm/github.com/org/backend",
		},
	}
	got := buildHyperlinkedPath("backend/src/main.go", opts)
	if !strings.Contains(got, "file:///Users/dev/scm/github.com/org/backend/src/main.go") {
		t.Errorf("expected path resolved against matching workspace root, got %q", got)
	}
	if !strings.Contains(got, "backend/src/main.go"+osc8Close) {
		t.Errorf("display text should be the original relative path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_MultiRoot_NoMatch_StatFallback(t *testing.T) {
	existingPaths := map[string]bool{
		"/Users/dev/scm/github.com/org/stigmer/.stigmer/skills/mcp/SKILL.md": true,
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots: []string{
			"/Users/dev/scm/github.com/org/stigmer",
			"/Users/dev/scm/github.com/org/backend",
		},
		StatFunc: func(path string) (os.FileInfo, error) {
			if existingPaths[path] {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath(".stigmer/skills/mcp/SKILL.md", opts)
	if !strings.Contains(got, "file:///Users/dev/scm/github.com/org/stigmer/.stigmer/skills/mcp/SKILL.md") {
		t.Errorf("stat fallback should resolve .stigmer/ path, got %q", got)
	}
	if !strings.Contains(got, ".stigmer/skills/mcp/SKILL.md"+osc8Close) {
		t.Errorf("display text should be the original relative path, got %q", got)
	}
}

func TestBuildHyperlinkedPath_MultiRoot_NoMatch_StatAllFail_DegradesToPlainText(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots: []string{
			"/Users/dev/scm/github.com/org/frontend",
			"/Users/dev/scm/github.com/org/backend",
		},
		StatFunc: func(path string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath("unknown-ws/README.md", opts)
	if got != "unknown-ws/README.md" {
		t.Errorf("unmatched workspace with no stat match should degrade to plain text, got %q", got)
	}
}

func TestBuildHyperlinkedPath_MultiRoot_StatFallback_SecondRoot(t *testing.T) {
	existingPaths := map[string]bool{
		"/Users/dev/backend/config/app.yaml": true,
	}
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots: []string{
			"/Users/dev/frontend",
			"/Users/dev/backend",
		},
		StatFunc: func(path string) (os.FileInfo, error) {
			if existingPaths[path] {
				return nil, nil
			}
			return nil, os.ErrNotExist
		},
	}
	got := buildHyperlinkedPath("config/app.yaml", opts)
	if !strings.Contains(got, "file:///Users/dev/backend/config/app.yaml") {
		t.Errorf("stat fallback should match second root, got %q", got)
	}
}

func TestBuildHyperlinkedPath_MultiRoot_NilStatFunc_DefaultsToOsStat(t *testing.T) {
	opts := CompactOptions{
		HyperlinksEnabled: true,
		WorkspaceRoots: []string{
			"/Users/dev/frontend",
			"/Users/dev/backend",
		},
		StatFunc: nil,
	}
	got := buildHyperlinkedPath("nonexistent/file.go", opts)
	if got != "nonexistent/file.go" {
		t.Errorf("nil StatFunc with nonexistent path should degrade to plain text, got %q", got)
	}
}

// =============================================================================
// firstLine
// =============================================================================

// =============================================================================
// RenderCompact — discovery tools (List, Find, Search)
// =============================================================================

func TestRenderCompact_List_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "src/"},
		Status: "completed",
		Result: "main.go\nconfig.go\nutil.go\nREADME.md\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "List")
	assertContains(t, got, "src/")
	assertContains(t, got, "4 entries")

	if !strings.Contains(plain, "List(src/)") {
		t.Errorf("expected header format List(src/), got:\n  %q", plain)
	}
}

func TestRenderCompact_List_SingleEntry(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "ls",
		Args:   map[string]interface{}{"path": "pkg/"},
		Status: "completed",
		Result: "main.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "1 entry")
}

func TestRenderCompact_List_EmptyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "empty/"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "(empty)")
}

func TestRenderCompact_List_WhitespaceOnlyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "empty/"},
		Status: "completed",
		Result: "  \n\n  \n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "(empty)")
}

func TestRenderCompact_List_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "/nope"},
		Status: "failed",
		Error:  "directory not found",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "/nope")
	assertContains(t, got, "✗")
	assertContains(t, got, "directory not found")
	assertNotContains(t, got, "entries")
}

func TestRenderCompact_List_HyperlinksEnabled(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "/Users/dev/project/src"},
		Status: "completed",
		Result: "main.go\nutil.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, osc8Open) {
		t.Error("expected OSC 8 open sequence when hyperlinks enabled for List path")
	}
	if !strings.Contains(got, "file:///Users/dev/project/src") {
		t.Error("expected file:// URI in hyperlink for List path")
	}
}

func TestRenderCompact_List_NoGutterPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "src/"},
		Status: "completed",
		Result: "main.go\nconfig.go\nutil.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertNotContains(t, got, "│")
	assertNotContains(t, got, "⋮")
	if strings.Contains(plain, "main.go") {
		t.Error("compact list should not include directory entry names in output")
	}
}

func TestRenderCompact_Find_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "completed",
		Result: "main.go\nconfig.go\nutil.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Find")
	assertContains(t, got, "*.go")
	assertContains(t, got, "Found 3 matches")

	if !strings.Contains(plain, "Find(*.go)") {
		t.Errorf("expected header format Find(*.go), got:\n  %q", plain)
	}
}

func TestRenderCompact_Find_SingleMatch(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "README.md"},
		Status: "completed",
		Result: "README.md\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Found 1 match")
}

func TestRenderCompact_Find_EmptyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.proto"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "(no matches)")
}

func TestRenderCompact_Find_NoHyperlinksOnPattern(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "**/*.go"},
		Status: "completed",
		Result: "main.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompact(tc, opts)

	if strings.Contains(got, osc8Open+"file://") {
		t.Error("pattern should not be hyperlinked — it's a glob, not a file path")
	}
}

func TestRenderCompact_Find_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "failed",
		Error:  "no readable directories",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "no readable directories")
	assertNotContains(t, got, "matches")
}

func TestRenderCompact_Search_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "grep",
		Args:   map[string]interface{}{"pattern": "TODO"},
		Status: "completed",
		Result: "main.go:12: // TODO fix\nutil.go:5: // TODO refactor\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Search")
	assertContains(t, got, "TODO")
	assertContains(t, got, "Found 2 matches")

	if !strings.Contains(plain, "Search(TODO)") {
		t.Errorf("expected header format Search(TODO), got:\n  %q", plain)
	}
}

func TestRenderCompact_Search_NoHyperlinksOnPattern(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "grep",
		Args:   map[string]interface{}{"pattern": "func main"},
		Status: "completed",
		Result: "main.go:1:func main() {\n",
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompact(tc, opts)

	if strings.Contains(got, osc8Open+"file://") {
		t.Error("search pattern should not be hyperlinked")
	}
}

func TestRenderCompact_Search_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "grep",
		Args:   map[string]interface{}{"pattern": "TODO"},
		Status: "failed",
		Error:  "search timed out",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "search timed out")
}

func TestRenderCompact_Search_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "grep",
		Args:   map[string]interface{}{"pattern": "TODO"},
		Status: "completed",
		Result: "match\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "🔎")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

func TestRenderCompact_Discovery_FailedEmptyError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "failed",
		Error:  "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "failed")
}

func TestRenderCompact_Discovery_FailedLongError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "failed",
		Error:  strings.Repeat("e", 100),
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

func TestRenderCompact_Discovery_SkipsEmptyLines(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "completed",
		Result: "main.go\n\nutil.go\n\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Found 2 matches")
}

// =============================================================================
// RenderCompact — delete tool
// =============================================================================

func TestRenderCompact_Delete_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "tmp/old.go"},
		Status: "completed",
		Result: "deleted",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Delete")
	assertContains(t, got, "tmp/old.go")
	assertContains(t, got, "Deleted")

	if !strings.Contains(plain, "Delete(tmp/old.go)") {
		t.Errorf("expected header format Delete(tmp/old.go), got:\n  %q", plain)
	}
}

func TestRenderCompact_Delete_RemoveFileAlias(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "remove_file",
		Args:   map[string]interface{}{"path": "temp.txt"},
		Status: "completed",
		Result: "removed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "Delete")
	assertContains(t, got, "Deleted")
	if !strings.Contains(plain, "Delete(temp.txt)") {
		t.Errorf("remove_file should render as Delete, got:\n  %q", plain)
	}
}

func TestRenderCompact_Delete_HyperlinksEnabled(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "/Users/dev/project/tmp.go"},
		Status: "completed",
		Result: "deleted",
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompact(tc, opts)

	if !strings.Contains(got, osc8Open) {
		t.Error("expected OSC 8 open sequence when hyperlinks enabled for delete path")
	}
	if !strings.Contains(got, "file:///Users/dev/project/tmp.go") {
		t.Error("expected file:// URI in hyperlink for delete path")
	}
}

func TestRenderCompact_Delete_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "/readonly/file.go"},
		Status: "failed",
		Error:  "permission denied",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "/readonly/file.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "permission denied")
	assertNotContains(t, got, "Deleted")
}

func TestRenderCompact_Delete_FailedEmptyError(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "bad.go"},
		Status: "failed",
		Error:  "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "failed")
}

func TestRenderCompact_Delete_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "tmp.go"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "⚠️")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

// =============================================================================
// RenderCompact — think tool
// =============================================================================

func TestRenderCompact_Think_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "The user wants to refactor the module.\nI should check existing patterns.\n"},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Thinking")
	assertContains(t, got, "The user wants to refactor")
	assertContains(t, got, "I should check existing patterns")

	if strings.Contains(plain, "Thinking(") {
		t.Errorf("think header should not have parens, got:\n  %q", plain)
	}
}

func TestRenderCompact_Think_NoParensInHeader(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "short thought"},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	headerLine := strings.Split(plain, "\n")[0]
	if strings.Contains(headerLine, "(") || strings.Contains(headerLine, ")") {
		t.Errorf("think header should not contain parens, got:\n  %q", headerLine)
	}
}

func TestRenderCompact_Think_Truncation(t *testing.T) {
	lines := make([]string, 10)
	for i := range lines {
		lines[i] = fmt.Sprintf("thought line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": strings.Join(lines, "\n") + "\n"},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "thought line 1")
	assertContains(t, got, "thought line 2")
	assertContains(t, got, "thought line 3")
	assertNotContains(t, got, "thought line 4")
	assertContains(t, got, "+7 more lines")
}

func TestRenderCompact_Think_SmartCutoff_FourLines(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "line1\nline2\nline3\nline4\n"},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "line1")
	assertContains(t, got, "line2")
	assertContains(t, got, "line3")
	assertContains(t, got, "line4")
	assertNotContains(t, got, "more lines")
}

func TestRenderCompact_Think_ShortThought(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "quick thought"},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)

	assertContains(t, got, "quick thought")
	assertNotContains(t, got, "more lines")
}

func TestRenderCompact_Think_EmptyThought(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": ""},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "(no content)")
}

func TestRenderCompact_Think_NoThoughtArg(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "(no content)")
}

func TestRenderCompact_Think_Failed(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "deep thought"},
		Status: "failed",
		Error:  "internal error",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "internal error")
	assertNotContains(t, got, "deep thought")
}

func TestRenderCompact_Think_NoEmojiBadge(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "reasoning"},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertNotContains(t, got, "💭")
	assertNotContains(t, got, "✓")
	assertNotContains(t, got, "⏳")
}

// =============================================================================
// RenderCompact — Sub-agent tool still falls back to RenderWithBadge
// =============================================================================

func TestRenderCompact_SubAgent_FallsBackToLegacy(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "task",
		Args:   map[string]interface{}{"description": "Explore CLI rendering"},
		Status: "completed",
		Result: "done",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	assertContains(t, got, "Sub-agent")
}

// =============================================================================
// RenderCompactRunning — new tool categories
// =============================================================================

func TestRenderCompactRunning_Find_PatternNotHyperlinked(t *testing.T) {
	tc := ToolCallInfo{
		Name: "glob",
		Args: map[string]interface{}{"pattern": "**/*.go"},
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Find")
	assertContains(t, got, "**/*.go")
	assertContains(t, got, "…")

	if strings.Contains(got, osc8Open+"file://") {
		t.Error("pattern should not be hyperlinked in running state")
	}
	if !strings.Contains(plain, "Find(**/*.go)") {
		t.Errorf("expected Find(**/*.go) in header, got:\n  %q", plain)
	}
}

func TestRenderCompactRunning_Search_PatternNotHyperlinked(t *testing.T) {
	tc := ToolCallInfo{
		Name: "grep",
		Args: map[string]interface{}{"pattern": "TODO"},
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "Search")
	assertContains(t, got, "…")
	if !strings.Contains(plain, "Search(TODO)") {
		t.Errorf("expected Search(TODO) in header, got:\n  %q", plain)
	}
	if strings.Contains(got, osc8Open+"file://") {
		t.Error("search pattern should not be hyperlinked")
	}
}

func TestRenderCompactRunning_List_PathHyperlinked(t *testing.T) {
	tc := ToolCallInfo{
		Name: "list_directory",
		Args: map[string]interface{}{"path": "/Users/dev/src"},
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompactRunning(tc, opts)

	assertContains(t, got, "List")
	assertContains(t, got, "…")
	if !strings.Contains(got, osc8Open) {
		t.Error("list path should be hyperlinked when enabled")
	}
	if !strings.Contains(got, "file:///Users/dev/src") {
		t.Error("expected file:// URI for list path")
	}
}

func TestRenderCompactRunning_Delete_PathHyperlinked(t *testing.T) {
	tc := ToolCallInfo{
		Name: "delete_file",
		Args: map[string]interface{}{"path": "/Users/dev/tmp.go"},
	}
	opts := CompactOptions{HyperlinksEnabled: true}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "Delete")
	assertContains(t, got, "…")
	if !strings.Contains(got, "file:///Users/dev/tmp.go") {
		t.Error("expected file:// URI for delete path")
	}
	if !strings.Contains(plain, "Delete(") {
		t.Errorf("expected Delete( in header, got:\n  %q", plain)
	}
}

func TestRenderCompactRunning_Think_NoParens(t *testing.T) {
	tc := ToolCallInfo{
		Name: "think",
		Args: map[string]interface{}{"thought": "deep reasoning"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Thinking")
	assertContains(t, got, "…")

	if strings.Contains(plain, "(") || strings.Contains(plain, ")") {
		t.Errorf("think running should not have parens, got:\n  %q", plain)
	}

	lines := strings.Split(plain, "\n")
	if len(lines) != 1 {
		t.Errorf("expected single line for running think, got %d:\n%s", len(lines), plain)
	}
}

func TestRenderCompactRunning_Task_CompactFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name: "task",
		Args: map[string]interface{}{"description": "Explore code"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "Sub-agent")
	assertContains(t, got, "Explore code")
	assertContains(t, got, "…")
	assertNotContains(t, got, "🔀")
	assertNotContains(t, got, "⏳")

	if !strings.Contains(plain, "Sub-agent: Explore code") {
		t.Errorf("expected 'Sub-agent: Explore code' format, got:\n  %q", plain)
	}
}

// =============================================================================
// countResultEntries
// =============================================================================

func TestCountResultEntries_BasicLines(t *testing.T) {
	if got := countResultEntries("a\nb\nc\n"); got != 3 {
		t.Errorf("expected 3, got %d", got)
	}
}

func TestCountResultEntries_NoTrailingNewline(t *testing.T) {
	if got := countResultEntries("a\nb\nc"); got != 3 {
		t.Errorf("expected 3, got %d", got)
	}
}

func TestCountResultEntries_EmptyLines(t *testing.T) {
	if got := countResultEntries("a\n\nb\n\nc\n"); got != 3 {
		t.Errorf("expected 3 (skipping empty lines), got %d", got)
	}
}

func TestCountResultEntries_WhitespaceOnlyLines(t *testing.T) {
	if got := countResultEntries("a\n   \nb\n  \n"); got != 2 {
		t.Errorf("expected 2 (skipping whitespace-only), got %d", got)
	}
}

func TestCountResultEntries_EmptyString(t *testing.T) {
	if got := countResultEntries(""); got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

func TestCountResultEntries_SingleEntry(t *testing.T) {
	if got := countResultEntries("only\n"); got != 1 {
		t.Errorf("expected 1, got %d", got)
	}
}

// =============================================================================
// discoverySummary
// =============================================================================

func TestDiscoverySummary_List_Plural(t *testing.T) {
	if got := discoverySummary("List", 5); got != "5 entries" {
		t.Errorf("expected %q, got %q", "5 entries", got)
	}
}

func TestDiscoverySummary_List_Singular(t *testing.T) {
	if got := discoverySummary("List", 1); got != "1 entry" {
		t.Errorf("expected %q, got %q", "1 entry", got)
	}
}

func TestDiscoverySummary_Find_Plural(t *testing.T) {
	if got := discoverySummary("Find", 12); got != "Found 12 matches" {
		t.Errorf("expected %q, got %q", "Found 12 matches", got)
	}
}

func TestDiscoverySummary_Find_Singular(t *testing.T) {
	if got := discoverySummary("Find", 1); got != "Found 1 match" {
		t.Errorf("expected %q, got %q", "Found 1 match", got)
	}
}

func TestDiscoverySummary_Search_Plural(t *testing.T) {
	if got := discoverySummary("Search", 8); got != "Found 8 matches" {
		t.Errorf("expected %q, got %q", "Found 8 matches", got)
	}
}

// =============================================================================
// hasCompactRenderer — comprehensive check
// =============================================================================

func TestHasCompactRenderer_AllKnownLabels(t *testing.T) {
	compactLabels := []string{
		"Read", "Write", "Create", "Edit",
		"Shell", "Execute",
		"List", "Find", "Search",
		"Delete", "Thinking", "Sub-agent",
	}
	for _, label := range compactLabels {
		info := toolDisplayInfo{label: label}
		if !hasCompactRenderer(info) {
			t.Errorf("hasCompactRenderer(%q) = false, want true", label)
		}
	}
}

func TestHasCompactRenderer_SubAgentReturnsTrue(t *testing.T) {
	info := toolDisplayInfo{label: "Sub-agent"}
	if !hasCompactRenderer(info) {
		t.Error("hasCompactRenderer(Sub-agent) = false, want true — Sub-agent has visual representation via lifecycle events")
	}
}

// =============================================================================
// firstLine
// =============================================================================

func TestFirstLine_SingleLine(t *testing.T) {
	if got := firstLine("hello"); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestFirstLine_MultiLine(t *testing.T) {
	if got := firstLine("first\nsecond\nthird"); got != "first" {
		t.Errorf("expected %q, got %q", "first", got)
	}
}

func TestFirstLine_EmptyString(t *testing.T) {
	if got := firstLine(""); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestFirstLine_TrailingNewline(t *testing.T) {
	if got := firstLine("hello\n"); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

// =============================================================================
// IsTaskTool
// =============================================================================

func TestIsTaskTool_TaskReturnsTrue(t *testing.T) {
	if !IsTaskTool("task") {
		t.Error("IsTaskTool(task) = false, want true")
	}
}

func TestIsTaskTool_ShellReturnsFalse(t *testing.T) {
	if IsTaskTool("shell") {
		t.Error("IsTaskTool(shell) = true, want false")
	}
}

func TestIsTaskTool_UnknownReturnsFalse(t *testing.T) {
	if IsTaskTool("custom_mcp_tool") {
		t.Error("IsTaskTool(custom_mcp_tool) = true, want false")
	}
}

func TestIsTaskTool_ReadReturnsFalse(t *testing.T) {
	if IsTaskTool("read") {
		t.Error("IsTaskTool(read) = true, want false")
	}
}

// =============================================================================
// GutterWrap
// =============================================================================

func TestGutterWrap_SingleLine(t *testing.T) {
	got := GutterWrap("hello")
	plain := stripANSI(got)

	if !strings.HasPrefix(plain, "  │ hello") {
		t.Errorf("expected gutter prefix, got:\n  %q", plain)
	}
}

func TestGutterWrap_MultiLine(t *testing.T) {
	got := GutterWrap("line1\nline2\nline3")
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d:\n%s", len(lines), plain)
	}
	for i, line := range lines {
		if !strings.HasPrefix(line, "  │ ") {
			t.Errorf("line %d missing gutter prefix: %q", i, line)
		}
	}
	if !strings.Contains(lines[0], "line1") {
		t.Error("first line should contain 'line1'")
	}
	if !strings.Contains(lines[2], "line3") {
		t.Error("third line should contain 'line3'")
	}
}

func TestGutterWrap_EmptyString(t *testing.T) {
	got := GutterWrap("")
	if got != "" {
		t.Errorf("GutterWrap(\"\") should return empty string, got %q", got)
	}
}

func TestGutterWrap_ContainsPipeCharacter(t *testing.T) {
	got := GutterWrap("content")
	plain := stripANSI(got)

	if !strings.Contains(plain, "│") {
		t.Errorf("expected gutter pipe character (│), got:\n  %q", plain)
	}
	if !strings.Contains(plain, "content") {
		t.Errorf("expected original content preserved, got:\n  %q", plain)
	}
}

// =============================================================================
// GutterWrap — integration with compact renderers
// =============================================================================

func TestGutterWrap_WithRenderCompactRead(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Status: "completed",
		Result: "package main\nfunc main() {}\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	inner := RenderCompact(tc, opts)
	got := GutterWrap(inner)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines (header + result), got %d:\n%s", len(lines), plain)
	}
	for i, line := range lines {
		if !strings.HasPrefix(line, "  │ ") {
			t.Errorf("line %d missing gutter prefix: %q", i, line)
		}
	}
	assertContains(t, got, "Read")
	assertContains(t, got, "main.go")
	assertContains(t, got, "3 lines")
}

func TestGutterWrap_WithRenderCompactShell(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "completed",
		Result: "ok  pkg/foo  0.5s\nok  pkg/bar  1.2s\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	inner := RenderCompact(tc, opts)
	got := GutterWrap(inner)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	for i, line := range lines {
		if !strings.HasPrefix(line, "  │ ") {
			t.Errorf("line %d missing gutter prefix: %q", i, line)
		}
	}
	assertContains(t, got, "Shell")
	assertContains(t, got, "go test ./...")
}

func TestGutterWrap_WithRenderCompactWrite(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "config.go", "contents": "package config\n"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	inner := RenderCompact(tc, opts)
	got := GutterWrap(inner)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d:\n%s", len(lines), plain)
	}
	for i, line := range lines {
		if !strings.HasPrefix(line, "  │ ") {
			t.Errorf("line %d missing gutter prefix: %q", i, line)
		}
	}
	assertContains(t, got, "Write")
	assertContains(t, got, "config.go")
}

func TestGutterWrap_WithRenderReadGroup(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}, Status: "completed", Result: "package a\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}, Status: "completed", Result: "package b\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "c.go"}, Status: "completed", Result: "package c\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	inner := RenderReadGroup(reads, opts)
	got := GutterWrap(inner)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 4 {
		t.Fatalf("expected 4 lines (header + 3 entries), got %d:\n%s", len(lines), plain)
	}
	for i, line := range lines {
		if !strings.HasPrefix(line, "  │ ") {
			t.Errorf("line %d missing gutter prefix: %q", i, line)
		}
	}
	assertContains(t, got, "Read 3 files")
	assertContains(t, got, "a.go")
	assertContains(t, got, "b.go")
	assertContains(t, got, "c.go")
}

// =============================================================================
// RenderCompactRunning — Sub-agent tool format
// =============================================================================

func TestRenderCompactRunning_Task_EmptyDescription(t *testing.T) {
	tc := ToolCallInfo{
		Name: "task",
		Args: map[string]interface{}{},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "Sub-agent")
	assertContains(t, got, "running")
	assertContains(t, got, "…")

	if !strings.Contains(plain, "Sub-agent: running") {
		t.Errorf("expected 'Sub-agent: running' fallback, got:\n  %q", plain)
	}
}

func TestRenderCompactRunning_Task_SingleLine(t *testing.T) {
	tc := ToolCallInfo{
		Name: "task",
		Args: map[string]interface{}{"description": "Investigate bug"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 1 {
		t.Errorf("expected single line for running Task, got %d:\n%s", len(lines), plain)
	}
}

// =============================================================================
// BulletGreen / LabelBold
// =============================================================================

func TestBulletGreen_RendersBullet(t *testing.T) {
	got := BulletGreen("●")
	if stripANSI(got) != "●" {
		t.Errorf("expected bullet character, got %q", stripANSI(got))
	}
}

func TestLabelBold_RendersLabel(t *testing.T) {
	got := LabelBold("Sub-agent")
	if stripANSI(got) != "Sub-agent" {
		t.Errorf("expected 'Sub-agent', got %q", stripANSI(got))
	}
}

// =============================================================================
// renderCompactUnknown — MCP/unknown tool compact rendering
// =============================================================================

func TestRenderCompact_UnknownTool_BasicFormat(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "search",
		Args:   map[string]interface{}{"query": "planton mcp server"},
		Status: "completed",
		Result: "Found 8 definition(s) matching \"planton mcp server\"",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, got, "●")
	assertContains(t, got, "search")
	assertContains(t, got, "query")
	assertContains(t, got, "planton mcp server")
	assertContains(t, got, "Found 8 definition(s)")
	assertNotContains(t, got, "*")

	lines := strings.Split(plain, "\n")
	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines (header + input), got %d:\n%s", len(lines), plain)
	}
}

func TestRenderCompact_UnknownTool_ShowsInputArgs(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "get_mcp_server",
		Args:   map[string]interface{}{"org": "default", "name": "planton"},
		Status: "completed",
		Result: "server config...",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, `name: "planton"`)
	assertContains(t, plain, `org: "default"`)
}

func TestRenderCompact_UnknownTool_ResultPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "search",
		Args:   map[string]interface{}{"query": "test"},
		Status: "completed",
		Result: "line1\nline2\nline3",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "line1")
	assertContains(t, plain, "line2")
	assertContains(t, plain, "line3")
	assertNotContains(t, plain, "more lines")
}

func TestRenderCompact_UnknownTool_ResultPreviewTruncation(t *testing.T) {
	lines := make([]string, 10)
	for i := range lines {
		lines[i] = fmt.Sprintf("result line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "search",
		Args:   map[string]interface{}{"query": "test"},
		Status: "completed",
		Result: strings.Join(lines, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "result line 1")
	assertContains(t, plain, "result line 2")
	assertContains(t, plain, "result line 3")
	assertNotContains(t, plain, "result line 4")
	assertContains(t, plain, "… +7 more lines")
}

func TestRenderCompact_UnknownTool_ErrorInResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "get_mcp_server",
		Args:   map[string]interface{}{"org": "default"},
		Status: "completed",
		Result: "Error: MCP server \"planton\" in org \"default\" not found...\n\nRecovery suggestions:\n  1. Check the server name",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "●")
	assertContains(t, plain, "get_mcp_server")
	assertContains(t, plain, "org")
	assertContains(t, plain, "✗")
	assertContains(t, plain, "MCP server")
	assertNotContains(t, plain, "Recovery suggestions")
}

func TestRenderCompact_UnknownTool_FailedStatus(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "deploy",
		Args:   map[string]interface{}{"env": "prod"},
		Status: "failed",
		Error:  "connection timed out",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "✗")
	assertContains(t, plain, "connection timed out")
}

func TestRenderCompact_UnknownTool_LongArgTruncation(t *testing.T) {
	longValue := strings.Repeat("x", 300)
	tc := ToolCallInfo{
		Name:   "custom_tool",
		Args:   map[string]interface{}{"content": longValue, "name": "short"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "content: (")
	assertContains(t, plain, "chars)")
	assertContains(t, plain, `name: "short"`)
	assertNotContains(t, plain, longValue)
}

func TestRenderCompact_UnknownTool_NoArgs(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "ping",
		Status: "completed",
		Result: "pong",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "●")
	assertContains(t, plain, "ping")
	assertContains(t, plain, "pong")
}

func TestRenderCompact_UnknownTool_NoResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "notify",
		Args:   map[string]interface{}{"channel": "alerts"},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "notify")
	assertContains(t, plain, "channel")
	lines := strings.Split(plain, "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines (header + 1 arg, no output), got %d:\n%s", len(lines), plain)
	}
}

func TestRenderCompact_UnknownTool_WithMetadata(t *testing.T) {
	tc := ToolCallInfo{
		Name:     "search",
		Args:     map[string]interface{}{"query": "test"},
		Status:   "completed",
		Result:   strings.Repeat("x", 2000),
		Duration: 1500 * time.Millisecond,
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "2.0 KB")
	assertContains(t, plain, "1.5s")
}

func TestRenderCompact_UnknownTool_WithServerName(t *testing.T) {
	tc := ToolCallInfo{
		Name:       "search",
		ServerName: "planton",
		Args:       map[string]interface{}{"query": "test"},
		Status:     "completed",
		Result:     "found",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "planton/search")
}

func TestRenderCompact_UnknownTool_ManyArgs_Truncated(t *testing.T) {
	tc := ToolCallInfo{
		Name: "complex_tool",
		Args: map[string]interface{}{
			"alpha": "a", "bravo": "b", "charlie": "c",
			"delta": "d", "echo": "e",
		},
		Status: "completed",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "alpha")
	assertContains(t, plain, "bravo")
	assertContains(t, plain, "charlie")
	assertNotContains(t, plain, "delta")
	assertContains(t, plain, "… +2 more args")
}

func TestRenderCompactRunning_UnknownTool_SingleLine(t *testing.T) {
	tc := ToolCallInfo{
		Name: "search",
		Args: map[string]interface{}{"query": "test"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	if len(lines) != 1 {
		t.Errorf("expected single line for running state, got %d:\n%s", len(lines), plain)
	}
}

func TestRenderCompactRunning_UnknownTool_WithServerName(t *testing.T) {
	tc := ToolCallInfo{
		Name:       "search",
		ServerName: "planton",
		Args:       map[string]interface{}{"query": "test"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "planton/search")
	assertContains(t, plain, "…")
}

func TestRenderCompact_UnknownTool_NoGutter(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "search",
		Args:   map[string]interface{}{"query": "test"},
		Status: "completed",
		Result: "line1\nline2",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertNotContains(t, plain, "│")
	assertNotContains(t, plain, "⋮")
}

func TestRenderCompact_UnknownTool_SmartCutoff(t *testing.T) {
	lines := make([]string, 4)
	for i := range lines {
		lines[i] = fmt.Sprintf("line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "tool",
		Status: "completed",
		Result: strings.Join(lines, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompact(tc, opts)
	plain := stripANSI(got)

	assertContains(t, plain, "line 1")
	assertContains(t, plain, "line 4")
	assertNotContains(t, plain, "more lines")
}

// =============================================================================
// formatInputArgs
// =============================================================================

func TestFormatInputArgs_Empty(t *testing.T) {
	if got := formatInputArgs(nil, 3); got != "" {
		t.Errorf("expected empty for nil args, got %q", got)
	}
	if got := formatInputArgs(map[string]interface{}{}, 3); got != "" {
		t.Errorf("expected empty for empty args, got %q", got)
	}
}

func TestFormatInputArgs_SingleArg(t *testing.T) {
	args := map[string]interface{}{"query": "test value"}
	got := stripANSI(formatInputArgs(args, 3))

	if got != `    query: "test value"` {
		t.Errorf("unexpected format: %q", got)
	}
}

func TestFormatInputArgs_MultipleArgs_Sorted(t *testing.T) {
	args := map[string]interface{}{"zebra": "z", "alpha": "a", "middle": "m"}
	got := stripANSI(formatInputArgs(args, 3))

	lines := strings.Split(got, "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d:\n%s", len(lines), got)
	}
	assertContains(t, lines[0], "alpha")
	assertContains(t, lines[1], "middle")
	assertContains(t, lines[2], "zebra")
}

func TestFormatInputArgs_TruncatesAtMax(t *testing.T) {
	args := map[string]interface{}{"a": "1", "b": "2", "c": "3", "d": "4", "e": "5"}
	got := stripANSI(formatInputArgs(args, 3))

	assertContains(t, got, "a:")
	assertContains(t, got, "b:")
	assertContains(t, got, "c:")
	assertNotContains(t, got, "d:")
	assertContains(t, got, "… +2 more args")
}

func TestFormatInputArgs_SmartCutoff(t *testing.T) {
	args := map[string]interface{}{"a": "1", "b": "2", "c": "3", "d": "4"}
	got := stripANSI(formatInputArgs(args, 3))

	assertContains(t, got, "a:")
	assertContains(t, got, "d:")
	assertNotContains(t, got, "more args")
}

func TestFormatInputArgs_LargeStringPlaceholder(t *testing.T) {
	args := map[string]interface{}{"content": strings.Repeat("x", 300)}
	got := stripANSI(formatInputArgs(args, 3))

	assertContains(t, got, "content: (")
	assertContains(t, got, "chars)")
	assertNotContains(t, got, strings.Repeat("x", 100))
}

func TestFormatInputArgs_NonStringTypes(t *testing.T) {
	args := map[string]interface{}{
		"count":   float64(42),
		"enabled": true,
		"empty":   nil,
	}
	got := stripANSI(formatInputArgs(args, 3))

	assertContains(t, got, "count: 42")
	assertContains(t, got, "enabled: true")
	assertContains(t, got, "empty: null")
}

func TestFormatInputArgs_StringQuoting(t *testing.T) {
	args := map[string]interface{}{"key": "value with spaces"}
	got := stripANSI(formatInputArgs(args, 3))

	assertContains(t, got, `key: "value with spaces"`)
}

// =============================================================================
// formatApprovalArgs
// =============================================================================

func TestFormatApprovalArgs_Empty(t *testing.T) {
	if got := formatApprovalArgs(nil); got != "" {
		t.Errorf("expected empty for nil args, got %q", got)
	}
}

func TestFormatApprovalArgs_SingleArg(t *testing.T) {
	args := map[string]interface{}{"target": "staging"}
	got := formatApprovalArgs(args)

	assertContains(t, got, "target=")
	assertContains(t, got, "staging")
	assertContains(t, got, "(")
	assertContains(t, got, ")")
}

func TestFormatApprovalArgs_TwoArgs(t *testing.T) {
	args := map[string]interface{}{"env": "prod", "force": true}
	got := formatApprovalArgs(args)

	assertContains(t, got, "env=")
	assertContains(t, got, "force=true")
}

func TestFormatApprovalArgs_ManyArgs_Ellipsis(t *testing.T) {
	args := map[string]interface{}{"a": "1", "b": "2", "c": "3"}
	got := formatApprovalArgs(args)

	assertContains(t, got, "...")
}

// =============================================================================
// GutterWrap — unknown/MCP tool integration
// =============================================================================

func TestGutterWrap_WithRenderCompactUnknown(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "search",
		Args:   map[string]interface{}{"query": "test"},
		Status: "completed",
		Result: "found 3 matches",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	inner := RenderCompact(tc, opts)
	got := GutterWrap(inner)
	plain := stripANSI(got)

	lines := strings.Split(plain, "\n")
	for i, line := range lines {
		if !strings.HasPrefix(line, "  │ ") {
			t.Errorf("line %d missing gutter prefix: %q", i, line)
		}
	}
	assertContains(t, got, "search")
	assertContains(t, got, "query")
}
