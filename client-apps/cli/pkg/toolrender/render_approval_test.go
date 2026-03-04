package toolrender

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// RenderApprovalResult — write/edit/create tools
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_ApprovedWrite(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "config.go", "contents": "package config\n\nfunc Init() {}"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "●")
	assertContains(t, result, "Write(config.go)")
	assertContains(t, result, "└ Wrote 3 lines")
	assertContains(t, result, "package config")
}

func TestRenderApprovalResult_ApprovedEdit(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "edit_file",
		Args:   map[string]interface{}{"path": "main.go", "new_text": "fmt.Println(\"hello\")"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "Edit(main.go)")
	assertContains(t, result, "└ Edited 1 line")
	assertContains(t, result, "fmt.Println")
}

func TestRenderApprovalResult_ApprovedCreate(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "create_file",
		Args:   map[string]interface{}{"path": "new.go", "contents": "package new"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "Create(new.go)")
	assertContains(t, result, "└ Created 1 line")
}

func TestRenderApprovalResult_RejectedWrite(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "danger.go", "contents": "package danger\n\nfunc Boom() {}\n"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "reject", CompactOptions{}))

	assertContains(t, result, "●")
	assertContains(t, result, "Write(danger.go)")
	assertContains(t, result, "└ Rejected")
	assertContains(t, result, "package danger")
}

func TestRenderApprovalResult_SkippedWrite(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "skip.go", "contents": "package skip\n"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "skip", CompactOptions{}))

	assertContains(t, result, "●")
	assertContains(t, result, "Write(skip.go)")
	assertContains(t, result, "└ Skipped")
	assertNotContains(t, result, "package skip")
}

func TestRenderApprovalResult_SkippedWrite_NoPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "skip.go", "contents": "line1\nline2\nline3\n"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "skip", CompactOptions{}))

	lines := strings.Split(result, "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines (header + connector), got %d:\n%s", len(lines), result)
	}
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — shell tools
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_ApprovedShell(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "Shell(go test ./...)")
	assertContains(t, result, "└ Approved")
}

func TestRenderApprovalResult_ApprovedShell_NoPreview(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "waiting_approval",
		Result: "ok  pkg/foo  0.5s",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	lines := strings.Split(result, "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines (header + connector) for approved shell, got %d:\n%s", len(lines), result)
	}
}

func TestRenderApprovalResult_RejectedShell(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "rm -rf /tmp"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "reject", CompactOptions{}))

	assertContains(t, result, "Shell(rm -rf /tmp)")
	assertContains(t, result, "└ Rejected")
}

func TestRenderApprovalResult_SkippedShell(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "echo hello"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "skip", CompactOptions{}))

	assertContains(t, result, "└ Skipped")
}

func TestRenderApprovalResult_ShellCommandTruncated(t *testing.T) {
	longCmd := strings.Repeat("x", 80)
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": longCmd},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "...")
	assertNotContains(t, result, longCmd)
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — delete tool
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_ApprovedDelete(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "old.txt"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "Delete(old.txt)")
	assertContains(t, result, "└ Deleted")

	lines := strings.Split(result, "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines for delete (no preview), got %d:\n%s", len(lines), result)
	}
}

func TestRenderApprovalResult_RejectedDelete(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "important.txt"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "reject", CompactOptions{}))

	assertContains(t, result, "Delete(important.txt)")
	assertContains(t, result, "└ Rejected")
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — preview truncation
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_PreviewTruncation(t *testing.T) {
	var lines []string
	for i := 1; i <= 20; i++ {
		lines = append(lines, "line "+strings.Repeat("x", 5))
	}
	content := strings.Join(lines, "\n") + "\n"

	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "big.go", "contents": content},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "… +10 more lines")
	assertContains(t, result, "line xxxxx")
}

func TestRenderApprovalResult_PreviewSmartCutoff_ShowsAll(t *testing.T) {
	var lines []string
	for i := 1; i <= 11; i++ {
		lines = append(lines, "line "+strings.Repeat("y", 3))
	}
	content := strings.Join(lines, "\n") + "\n"

	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "small.go", "contents": content},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertNotContains(t, result, "more lines")
	for _, line := range lines {
		assertContains(t, result, line)
	}
}

func TestRenderApprovalResult_PreviewFewLines(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "tiny.go", "contents": "a\nb\nc\n"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertNotContains(t, result, "more lines")
	assertContains(t, result, "a")
	assertContains(t, result, "b")
	assertContains(t, result, "c")
}

func TestRenderApprovalResult_EmptyContent(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "empty.go"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "Write(empty.go)")
	assertContains(t, result, "└ Wrote 0 lines")

	lines := strings.Split(result, "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines for empty content (no preview), got %d:\n%s", len(lines), result)
	}
}

func TestRenderApprovalResult_WhitespaceOnlyContent(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "ws.go", "contents": "   \n  \n"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	lines := strings.Split(result, "\n")
	if len(lines) != 2 {
		t.Errorf("expected 2 lines for whitespace-only content, got %d:\n%s", len(lines), result)
	}
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — hyperlinks
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_HyperlinksEnabled(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "/abs/path/file.go", "contents": "x\n"},
		Status: "waiting_approval",
	}
	result := RenderApprovalResult(tc, "approve", CompactOptions{HyperlinksEnabled: true})

	assertContains(t, result, "\033]8;")
	assertContains(t, result, "file:///abs/path/file.go")
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — unknown/MCP tools
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_UnknownApproved(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "custom_deploy",
		Args:   map[string]interface{}{"target": "production"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "custom_deploy")
	assertContains(t, result, "└ Approved")
	assertContains(t, result, "target")
	assertContains(t, result, "production")
}

func TestRenderApprovalResult_UnknownRejected(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "custom_deploy",
		Args:   map[string]interface{}{"target": "production"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "reject", CompactOptions{}))

	assertContains(t, result, "└ Rejected")
}

func TestRenderApprovalResult_UnknownSkipped(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "custom_deploy",
		Args:   map[string]interface{}{"target": "production"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "skip", CompactOptions{}))

	assertContains(t, result, "└ Skipped")
}

func TestRenderApprovalResult_UnknownWithResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "custom_tool",
		Args:   map[string]interface{}{"input": "data"},
		Status: "waiting_approval",
		Result: "output line 1\noutput line 2\n",
	}
	result := stripANSI(RenderApprovalResult(tc, "reject", CompactOptions{}))

	assertContains(t, result, "output line 1")
	assertContains(t, result, "output line 2")
}

func TestRenderApprovalResult_UnknownNoArgs(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "mystery_tool",
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "mystery_tool")
	assertContains(t, result, "└ Approved")
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — arg fallbacks
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_WriteArgFallback(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "fb.go", "content": "fallback content"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "approve", CompactOptions{}))

	assertContains(t, result, "Write(fb.go)")
	assertContains(t, result, "└ Wrote 1 line")
	assertContains(t, result, "fallback content")
}

// ---------------------------------------------------------------------------
// RenderApprovalResult — invalid/unknown action
// ---------------------------------------------------------------------------

func TestRenderApprovalResult_InvalidAction(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "test.go", "contents": "x\n"},
		Status: "waiting_approval",
	}
	result := stripANSI(RenderApprovalResult(tc, "bogus", CompactOptions{}))

	assertContains(t, result, "└ Skipped")
}

// ---------------------------------------------------------------------------
// ApprovalSeparator
// ---------------------------------------------------------------------------

func TestApprovalSeparator_ContainsDashes(t *testing.T) {
	result := stripANSI(ApprovalSeparator())

	if !strings.Contains(result, strings.Repeat("─", approvalSeparatorWidth)) {
		t.Errorf("separator should contain %d dash characters, got: %q", approvalSeparatorWidth, result)
	}
}

func TestApprovalSeparator_FixedWidth(t *testing.T) {
	result := stripANSI(ApprovalSeparator())

	if len([]rune(result)) != approvalSeparatorWidth {
		t.Errorf("separator should be exactly %d characters, got %d: %q",
			approvalSeparatorWidth, len([]rune(result)), result)
	}
}

// ---------------------------------------------------------------------------
// ApprovalQuestion
// ---------------------------------------------------------------------------

func TestApprovalQuestion_Write(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "output.go"},
	}
	result := ApprovalQuestion(tc)

	if result != "Do you want to create output.go?" {
		t.Errorf("unexpected question: %q", result)
	}
}

func TestApprovalQuestion_CreateFile(t *testing.T) {
	tc := ToolCallInfo{
		Name: "create_file",
		Args: map[string]interface{}{"path": "new.go"},
	}
	result := ApprovalQuestion(tc)

	if result != "Do you want to create new.go?" {
		t.Errorf("unexpected question: %q", result)
	}
}

func TestApprovalQuestion_Edit(t *testing.T) {
	tc := ToolCallInfo{
		Name: "edit_file",
		Args: map[string]interface{}{"path": "main.go"},
	}
	result := ApprovalQuestion(tc)

	if result != "Do you want to edit main.go?" {
		t.Errorf("unexpected question: %q", result)
	}
}

func TestApprovalQuestion_Shell(t *testing.T) {
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": "rm -rf /tmp"},
	}
	result := ApprovalQuestion(tc)

	if result != "Do you want to execute rm -rf /tmp?" {
		t.Errorf("unexpected question: %q", result)
	}
}

func TestApprovalQuestion_Delete(t *testing.T) {
	tc := ToolCallInfo{
		Name: "delete_file",
		Args: map[string]interface{}{"path": "old.txt"},
	}
	result := ApprovalQuestion(tc)

	if result != "Do you want to delete old.txt?" {
		t.Errorf("unexpected question: %q", result)
	}
}

func TestApprovalQuestion_UnknownTool(t *testing.T) {
	tc := ToolCallInfo{
		Name: "custom_deploy",
		Args: map[string]interface{}{"target": "staging"},
	}
	result := ApprovalQuestion(tc)

	assertContains(t, result, "run custom_deploy")
	assertContains(t, result, "target=")
	assertContains(t, result, "staging")
}

func TestApprovalQuestion_MissingArgs(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
	}
	result := ApprovalQuestion(tc)

	if result != "Do you want to create?" {
		t.Errorf("unexpected question: %q", result)
	}
}

func TestApprovalQuestion_ShellCommandTruncation(t *testing.T) {
	longCmd := strings.Repeat("a", 80)
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": longCmd},
	}
	result := ApprovalQuestion(tc)

	if len(result) > 100 {
		t.Errorf("question should truncate long commands, got length %d", len(result))
	}
	assertContains(t, result, "...")
}

func TestApprovalQuestion_ShellMultilineCommand(t *testing.T) {
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": "echo hello\necho world"},
	}
	result := ApprovalQuestion(tc)

	assertContains(t, result, "echo hello")
	assertNotContains(t, result, "echo world")
}

// ---------------------------------------------------------------------------
// formatApprovalPreview (internal helper)
// ---------------------------------------------------------------------------

func TestFormatApprovalPreview_Empty(t *testing.T) {
	if got := formatApprovalPreview(""); got != "" {
		t.Errorf("expected empty for empty input, got: %q", got)
	}
}

func TestFormatApprovalPreview_WhitespaceOnly(t *testing.T) {
	if got := formatApprovalPreview("  \n  \n"); got != "" {
		t.Errorf("expected empty for whitespace-only, got: %q", got)
	}
}

func TestFormatApprovalPreview_FewLines(t *testing.T) {
	result := stripANSI(formatApprovalPreview("alpha\nbeta\ngamma"))

	assertContains(t, result, "alpha")
	assertContains(t, result, "beta")
	assertContains(t, result, "gamma")
	assertNotContains(t, result, "more lines")
}

func TestFormatApprovalPreview_ManyLines(t *testing.T) {
	var lines []string
	for i := 1; i <= 15; i++ {
		lines = append(lines, "line-"+strings.Repeat("z", 3))
	}

	result := stripANSI(formatApprovalPreview(strings.Join(lines, "\n")))

	assertContains(t, result, "… +5 more lines")
	assertContains(t, result, "line-zzz")
}

func TestFormatApprovalPreview_SmartCutoff(t *testing.T) {
	var lines []string
	for i := 1; i <= 11; i++ {
		lines = append(lines, "row")
	}

	result := stripANSI(formatApprovalPreview(strings.Join(lines, "\n")))

	assertNotContains(t, result, "more lines")
	if count := strings.Count(result, "row"); count != 11 {
		t.Errorf("expected all 11 lines shown (smart cutoff), got %d", count)
	}
}

func TestFormatApprovalPreview_Indented(t *testing.T) {
	result := stripANSI(formatApprovalPreview("hello"))

	if !strings.HasPrefix(result, "    ") {
		t.Errorf("preview lines should have 4-space indent, got: %q", result)
	}
}

// ---------------------------------------------------------------------------
// ExpandedApprovalHeader
// ---------------------------------------------------------------------------

func TestExpandedApprovalHeader_WriteFile(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "config.go"},
	}
	result := stripANSI(ExpandedApprovalHeader(tc, CompactOptions{}))

	assertContains(t, result, "●")
	assertContains(t, result, "Write(config.go)")
}

func TestExpandedApprovalHeader_Shell(t *testing.T) {
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": "go test ./..."},
	}
	result := stripANSI(ExpandedApprovalHeader(tc, CompactOptions{}))

	assertContains(t, result, "Shell(go test ./...)")
}

func TestExpandedApprovalHeader_ShellTruncated(t *testing.T) {
	longCmd := strings.Repeat("x", 80)
	tc := ToolCallInfo{
		Name: "shell",
		Args: map[string]interface{}{"command": longCmd},
	}
	result := stripANSI(ExpandedApprovalHeader(tc, CompactOptions{}))

	assertContains(t, result, "...")
	assertNotContains(t, result, longCmd)
}

func TestExpandedApprovalHeader_Delete(t *testing.T) {
	tc := ToolCallInfo{
		Name: "delete_file",
		Args: map[string]interface{}{"path": "old.txt"},
	}
	result := stripANSI(ExpandedApprovalHeader(tc, CompactOptions{}))

	assertContains(t, result, "Delete(old.txt)")
}

func TestExpandedApprovalHeader_UnknownTool(t *testing.T) {
	tc := ToolCallInfo{
		Name: "custom_deploy",
		Args: map[string]interface{}{"target": "production"},
	}
	result := stripANSI(ExpandedApprovalHeader(tc, CompactOptions{}))

	assertContains(t, result, "●")
	assertContains(t, result, "custom_deploy")
}

func TestExpandedApprovalHeader_UnknownNoArgs(t *testing.T) {
	tc := ToolCallInfo{
		Name: "mystery_tool",
	}
	result := stripANSI(ExpandedApprovalHeader(tc, CompactOptions{}))

	assertContains(t, result, "mystery_tool")
}

func TestExpandedApprovalHeader_Hyperlinks(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "/abs/path/file.go"},
	}
	result := ExpandedApprovalHeader(tc, CompactOptions{HyperlinksEnabled: true})

	assertContains(t, result, "\033]8;")
	assertContains(t, result, "file:///abs/path/file.go")
}

// ---------------------------------------------------------------------------
// ExpandedApprovalContent
// ---------------------------------------------------------------------------

func TestExpandedApprovalContent_WriteFile(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "test.go", "contents": "package test\n\nfunc Test() {}"},
	}
	result := ExpandedApprovalContent(tc)

	assertContains(t, result, "package test")
	assertContains(t, result, "func Test() {}")
}

func TestExpandedApprovalContent_Shell(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Result: "ok  pkg/foo  0.5s",
	}
	result := ExpandedApprovalContent(tc)

	assertContains(t, result, "ok  pkg/foo")
}

func TestExpandedApprovalContent_UnknownTool(t *testing.T) {
	tc := ToolCallInfo{
		Name: "custom_deploy",
		Args: map[string]interface{}{"target": "production"},
	}
	result := ExpandedApprovalContent(tc)

	if result != "production" {
		t.Errorf("expected first arg value, got: %q", result)
	}
}

func TestExpandedApprovalContent_WriteArgFallback(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "test.go", "content": "fallback content"},
	}
	result := ExpandedApprovalContent(tc)

	if result != "fallback content" {
		t.Errorf("expected fallback arg content, got: %q", result)
	}
}

func TestExpandedApprovalContent_Empty(t *testing.T) {
	tc := ToolCallInfo{
		Name: "write_file",
		Args: map[string]interface{}{"path": "empty.go"},
	}
	result := ExpandedApprovalContent(tc)

	if result != "" {
		t.Errorf("expected empty for no content, got: %q", result)
	}
}

// ---------------------------------------------------------------------------
// ShouldSuppressCompletion
// ---------------------------------------------------------------------------

func TestShouldSuppressCompletion_WriteTools(t *testing.T) {
	for _, name := range []string{"write_file", "write", "create_file", "edit_file", "edit"} {
		if !ShouldSuppressCompletion(name) {
			t.Errorf("expected suppression for %q", name)
		}
	}
}

func TestShouldSuppressCompletion_DeleteTools(t *testing.T) {
	for _, name := range []string{"delete_file", "remove_file"} {
		if !ShouldSuppressCompletion(name) {
			t.Errorf("expected suppression for %q", name)
		}
	}
}

func TestShouldSuppressCompletion_ShellNotSuppressed(t *testing.T) {
	for _, name := range []string{"shell", "bash", "execute", "run_command"} {
		if ShouldSuppressCompletion(name) {
			t.Errorf("shell tool %q should NOT be suppressed", name)
		}
	}
}

func TestShouldSuppressCompletion_ReadNotSuppressed(t *testing.T) {
	for _, name := range []string{"read", "read_file"} {
		if ShouldSuppressCompletion(name) {
			t.Errorf("read tool %q should NOT be suppressed", name)
		}
	}
}

func TestShouldSuppressCompletion_UnknownNotSuppressed(t *testing.T) {
	if ShouldSuppressCompletion("custom_mcp_tool") {
		t.Error("unknown tool should NOT be suppressed")
	}
}
