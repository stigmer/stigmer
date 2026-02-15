package toolrender

import (
	"strings"
	"testing"
)

// =============================================================================
// highlightContent Tests
// =============================================================================

func TestHighlightContent_EmptyContent(t *testing.T) {
	got, ok := highlightContent("", "main.go")
	if ok {
		t.Error("expected ok=false for empty content")
	}
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestHighlightContent_EmptyFilename(t *testing.T) {
	got, ok := highlightContent("package main", "")
	if ok {
		t.Error("expected ok=false for empty filename")
	}
	if got != "package main" {
		t.Errorf("expected original content returned, got %q", got)
	}
}

func TestHighlightContent_UnknownExtension(t *testing.T) {
	got, ok := highlightContent("some content", "file.xyz_unknown_ext_42")
	if ok {
		t.Error("expected ok=false for unknown extension")
	}
	if got != "some content" {
		t.Errorf("expected original content returned, got %q", got)
	}
}

func TestHighlightContent_GoFile(t *testing.T) {
	content := "package main\n\nfunc main() {}"
	got, ok := highlightContent(content, "main.go")
	if !ok {
		t.Fatal("expected ok=true for .go file")
	}

	// Highlighted output must contain ANSI escape codes.
	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	// The visible text must still contain the original tokens.
	plain := stripANSI(got)
	assertContains(t, plain, "package")
	assertContains(t, plain, "main")
	assertContains(t, plain, "func")
}

func TestHighlightContent_ProtoFile(t *testing.T) {
	content := "syntax = \"proto3\";\n\npackage ai.stigmer;\n\nmessage Agent {\n  string id = 1;\n}"
	got, ok := highlightContent(content, "agent-api.proto")
	if !ok {
		t.Fatal("expected ok=true for .proto file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "syntax")
	assertContains(t, plain, "proto3")
	assertContains(t, plain, "message")
	assertContains(t, plain, "Agent")
}

func TestHighlightContent_YAMLFile(t *testing.T) {
	content := "apiVersion: v1\nkind: Agent\nmetadata:\n  name: test-agent"
	got, ok := highlightContent(content, "example-agent.yaml")
	if !ok {
		t.Fatal("expected ok=true for .yaml file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "apiVersion")
	assertContains(t, plain, "kind")
	assertContains(t, plain, "Agent")
}

func TestHighlightContent_JSONFile(t *testing.T) {
	content := "{\n  \"name\": \"test\",\n  \"version\": 1\n}"
	got, ok := highlightContent(content, "config.json")
	if !ok {
		t.Fatal("expected ok=true for .json file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "name")
	assertContains(t, plain, "test")
	assertContains(t, plain, "version")
}

func TestHighlightContent_MarkdownFile(t *testing.T) {
	content := "# Managing Agents\n\nComplete guide to discovering, listing, searching, and managing agents."
	got, ok := highlightContent(content, "managing-agents.md")
	if !ok {
		t.Fatal("expected ok=true for .md file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "Managing Agents")
}

func TestHighlightContent_PythonFile(t *testing.T) {
	content := "import os\n\ndef main():\n    print(\"hello\")"
	got, ok := highlightContent(content, "script.py")
	if !ok {
		t.Fatal("expected ok=true for .py file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "import")
	assertContains(t, plain, "def")
	assertContains(t, plain, "main")
}

func TestHighlightContent_TypeScriptFile(t *testing.T) {
	content := "const x: number = 42;\nexport function hello(): string { return \"hi\"; }"
	got, ok := highlightContent(content, "app.ts")
	if !ok {
		t.Fatal("expected ok=true for .ts file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "const")
	assertContains(t, plain, "number")
	assertContains(t, plain, "42")
}

func TestHighlightContent_TOMLFile(t *testing.T) {
	content := "[package]\nname = \"stigmer-cli\"\nversion = \"0.1.0\""
	got, ok := highlightContent(content, "config.toml")
	if !ok {
		t.Fatal("expected ok=true for .toml file")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	plain := stripANSI(got)
	assertContains(t, plain, "package")
	assertContains(t, plain, "stigmer-cli")
}

func TestHighlightContent_PreservesLineCount(t *testing.T) {
	// The number of newlines in the output must match the input to preserve
	// line-based slicing in formatFileContentPreview.
	content := "line1\nline2\nline3\nline4\nline5"
	got, ok := highlightContent(content, "test.go")
	if !ok {
		t.Fatal("expected ok=true")
	}

	inputLines := strings.Count(content, "\n")
	outputLines := strings.Count(got, "\n")
	if inputLines != outputLines {
		t.Errorf("line count mismatch: input has %d newlines, output has %d", inputLines, outputLines)
	}
}

func TestHighlightContent_NoTrailingNewlineAdded(t *testing.T) {
	// Content without a trailing newline should not gain one after highlighting.
	content := "package main"
	got, ok := highlightContent(content, "main.go")
	if !ok {
		t.Fatal("expected ok=true")
	}

	if strings.HasSuffix(got, "\n") {
		t.Error("highlighted output should not have a trailing newline when input doesn't")
	}
}

func TestHighlightContent_DirectoryPathIgnored(t *testing.T) {
	// Only the base filename matters for lexer selection.
	content := "apiVersion: v1"
	got, ok := highlightContent(content, "some/deep/path/config.yaml")
	if !ok {
		t.Fatal("expected ok=true — should match on base filename")
	}

	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}
}

// =============================================================================
// extractFilename Tests
// =============================================================================

func TestExtractFilename_PathField(t *testing.T) {
	args := map[string]interface{}{"path": "inputs/agent-api.proto"}
	got := extractFilename(args)
	if got != "agent-api.proto" {
		t.Errorf("expected %q, got %q", "agent-api.proto", got)
	}
}

func TestExtractFilename_FilePathFallback(t *testing.T) {
	args := map[string]interface{}{"file_path": "/workspace/main.go"}
	got := extractFilename(args)
	if got != "main.go" {
		t.Errorf("expected %q, got %q", "main.go", got)
	}
}

func TestExtractFilename_FileFallback(t *testing.T) {
	args := map[string]interface{}{"file": "config.yaml"}
	got := extractFilename(args)
	if got != "config.yaml" {
		t.Errorf("expected %q, got %q", "config.yaml", got)
	}
}

func TestExtractFilename_NoPathFields(t *testing.T) {
	args := map[string]interface{}{"url": "https://example.com"}
	got := extractFilename(args)
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestExtractFilename_NilArgs(t *testing.T) {
	got := extractFilename(nil)
	if got != "" {
		t.Errorf("expected empty string for nil args, got %q", got)
	}
}

func TestExtractFilename_StripsDirectoryComponents(t *testing.T) {
	args := map[string]interface{}{"path": "some/deep/nested/file.json"}
	got := extractFilename(args)
	if got != "file.json" {
		t.Errorf("expected %q, got %q", "file.json", got)
	}
}

// =============================================================================
// Integration: Syntax Highlighting in File Preview
// =============================================================================

func TestFormatFileContentPreview_WithHighlighting(t *testing.T) {
	content := "syntax = \"proto3\";\n\npackage ai.stigmer;\n\nmessage Agent {}"
	got := formatFileContentPreview(content, "api.proto")

	// Gutter should be present.
	assertContains(t, got, "│")

	// Content should include ANSI codes (syntax highlighting active).
	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted preview")
	}

	// Semantic content should be preserved.
	assertContains(t, got, "syntax")
	assertContains(t, got, "proto3")
	assertContains(t, got, "package")

	// Should show "2 more lines" for lines beyond the preview.
	assertContains(t, got, "2 more lines")
}

func TestFormatFileContentPreview_WithoutHighlighting_FallsBack(t *testing.T) {
	content := "some unknown content"
	got := formatFileContentPreview(content, "file.unknown_ext_999")

	// Should still render with gutter, just without syntax-specific colors.
	assertContains(t, got, "│")
	assertContains(t, got, "some unknown content")
}

func TestFormatFullResultWithGutter_WithHighlighting(t *testing.T) {
	content := "apiVersion: v1\nkind: Agent\nmetadata:\n  name: test"
	got := formatFullResultWithGutter(content, "agent.yaml")

	// Should contain ANSI codes.
	if !strings.Contains(got, "\x1b[") {
		t.Error("expected ANSI escape codes in highlighted output")
	}

	// All lines should have the gutter character.
	plain := stripANSI(got)
	for _, line := range strings.Split(plain, "\n") {
		if !strings.Contains(line, "│") {
			t.Errorf("line missing gutter: %q", line)
		}
	}

	// Semantic content preserved.
	assertContains(t, got, "apiVersion")
	assertContains(t, got, "Agent")
}

// =============================================================================
// truncateANSI Tests
// =============================================================================

func TestTruncateANSI_ShortString_NoTruncation(t *testing.T) {
	got := truncateANSI("hello", 10)
	if got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestTruncateANSI_ExactLength_NoTruncation(t *testing.T) {
	got := truncateANSI("hello", 5)
	if got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
}

func TestTruncateANSI_PlainText_Truncated(t *testing.T) {
	got := truncateANSI("hello world", 8)
	plain := stripANSI(got)
	if !strings.Contains(plain, "...") {
		t.Errorf("expected truncation indicator, got %q", plain)
	}
	if len(plain) > 8 {
		t.Errorf("expected max 8 visible chars, got %d: %q", len(plain), plain)
	}
}

func TestTruncateANSI_WithANSICodes_PreservesEscapes(t *testing.T) {
	// Simulate a highlighted string: \x1b[38;5;197mpackage\x1b[0m \x1b[38;5;141mmain\x1b[0m
	input := "\x1b[38;5;197mpackage\x1b[0m \x1b[38;5;141mmain\x1b[0m"
	got := truncateANSI(input, 50) // No truncation needed.
	if got != input {
		t.Errorf("expected no truncation, got %q", got)
	}
}

func TestTruncateANSI_WithANSICodes_Truncated(t *testing.T) {
	// Simulate a highlighted string that needs truncation.
	input := "\x1b[38;5;197mpackage\x1b[0m \x1b[38;5;141mmain\x1b[0m"
	got := truncateANSI(input, 8)

	// The visible text should be truncated with "...".
	plain := stripANSI(got)
	if !strings.Contains(plain, "...") {
		t.Errorf("expected truncation indicator in plain text, got %q", plain)
	}
}
