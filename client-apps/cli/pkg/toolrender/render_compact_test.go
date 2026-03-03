package toolrender

import (
	"fmt"
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
		WorkingDir:        "/Users/dev/project",
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

func TestRenderCompactRunning_UnknownTool_FallsBackToLegacy(t *testing.T) {
	tc := ToolCallInfo{
		Name: "custom_mcp_tool",
		Args: map[string]interface{}{"query": "test"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderCompactRunning(tc, opts)
	assertContains(t, got, "🔧")
	assertContains(t, got, "custom_mcp_tool")
	assertContains(t, got, "⏳")
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
