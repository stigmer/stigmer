package toolrender

import (
	"fmt"
	"strings"
	"testing"
)

// =============================================================================
// RenderExpanded — shell tool
// =============================================================================

func TestRenderExpanded_Shell_AllOutputShown(t *testing.T) {
	lines := make([]string, 10)
	for i := range lines {
		lines[i] = fmt.Sprintf("line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "completed",
		Result: strings.Join(lines, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)

	for _, line := range lines {
		assertContains(t, got, line)
	}
	assertNotContains(t, got, "more lines")
}

func TestRenderExpanded_Shell_CompactTruncates(t *testing.T) {
	lines := make([]string, 10)
	for i := range lines {
		lines[i] = fmt.Sprintf("line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "completed",
		Result: strings.Join(lines, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	compact := RenderCompact(tc, opts)
	assertContains(t, compact, "more lines")

	expanded := RenderExpanded(tc, opts)
	assertNotContains(t, expanded, "more lines")
}

func TestRenderExpanded_Shell_Error(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "bad cmd"},
		Status: "failed",
		Error:  "command not found",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "command not found")
}

func TestRenderExpanded_Shell_EmptyOutput(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "true"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "(no output)")
}

func TestRenderExpanded_Shell_HeaderMatchesCompact(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "echo hello"},
		Status: "completed",
		Result: "hello",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	expanded := RenderExpanded(tc, opts)
	compact := RenderCompact(tc, opts)

	expandedFirst := strings.SplitN(stripANSI(expanded), "\n", 2)[0]
	compactFirst := strings.SplitN(stripANSI(compact), "\n", 2)[0]
	if expandedFirst != compactFirst {
		t.Errorf("headers differ:\n  expanded: %q\n  compact:  %q", expandedFirst, compactFirst)
	}
}

// =============================================================================
// RenderExpanded — think tool
// =============================================================================

func TestRenderExpanded_Think_AllLinesShown(t *testing.T) {
	lines := make([]string, 8)
	for i := range lines {
		lines[i] = fmt.Sprintf("thought line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": strings.Join(lines, "\n")},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)

	for _, line := range lines {
		assertContains(t, got, line)
	}
	assertNotContains(t, got, "more lines")
}

func TestRenderExpanded_Think_CompactTruncates(t *testing.T) {
	lines := make([]string, 8)
	for i := range lines {
		lines[i] = fmt.Sprintf("thought %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": strings.Join(lines, "\n")},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	compact := RenderCompact(tc, opts)
	assertContains(t, compact, "more lines")

	expanded := RenderExpanded(tc, opts)
	assertNotContains(t, expanded, "more lines")
}

func TestRenderExpanded_Think_Error(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "some thought"},
		Status: "failed",
		Error:  "timeout",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "timeout")
}

func TestRenderExpanded_Think_Empty(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": ""},
		Status: "completed",
		Result: "ok",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "(no content)")
}

// =============================================================================
// RenderExpanded — discovery tools
// =============================================================================

func TestRenderExpanded_Discovery_ShowsEntries(t *testing.T) {
	entries := []string{"src/main.go", "src/config.go", "pkg/util.go", "pkg/render.go", "test/helper.go"}
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "completed",
		Result: strings.Join(entries, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)

	for _, entry := range entries {
		assertContains(t, got, entry)
	}
	assertNotContains(t, got, "matches")
}

func TestRenderExpanded_Discovery_CompactShowsCount(t *testing.T) {
	entries := []string{"a.go", "b.go", "c.go"}
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "completed",
		Result: strings.Join(entries, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	compact := RenderCompact(tc, opts)
	assertContains(t, compact, "Found 3 matches")

	expanded := RenderExpanded(tc, opts)
	assertContains(t, expanded, "a.go")
	assertContains(t, expanded, "b.go")
	assertContains(t, expanded, "c.go")
	assertNotContains(t, expanded, "3 matches")
}

func TestRenderExpanded_Discovery_List_ShowsEntries(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "src/"},
		Status: "completed",
		Result: "main.go\nconfig.go\nutil.go\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "List")
	assertContains(t, got, "main.go")
	assertContains(t, got, "config.go")
	assertContains(t, got, "util.go")
	assertNotContains(t, got, "entries")
}

func TestRenderExpanded_Discovery_Error(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.xyz"},
		Status: "failed",
		Error:  "no readable directories",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "no readable directories")
}

func TestRenderExpanded_Discovery_EmptyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.xyz"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "(no matches)")
}

func TestRenderExpanded_Discovery_List_EmptyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "list_directory",
		Args:   map[string]interface{}{"path": "empty/"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "(empty)")
}

func TestRenderExpanded_Discovery_SkipsBlankLines(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "completed",
		Result: "a.go\n\nb.go\n\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	plain := stripANSI(got)
	lines := strings.Split(plain, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			t.Error("expanded discovery should not produce blank lines from empty result entries")
			break
		}
	}
}

// =============================================================================
// RenderExpanded — unknown/MCP tools
// =============================================================================

func TestRenderExpanded_Unknown_AllResultShown(t *testing.T) {
	lines := make([]string, 8)
	for i := range lines {
		lines[i] = fmt.Sprintf("result line %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "custom_mcp_tool",
		Args:   map[string]interface{}{"query": "test"},
		Status: "completed",
		Result: strings.Join(lines, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)

	for _, line := range lines {
		assertContains(t, got, line)
	}
	assertNotContains(t, got, "more lines")
}

func TestRenderExpanded_Unknown_CompactTruncates(t *testing.T) {
	lines := make([]string, 8)
	for i := range lines {
		lines[i] = fmt.Sprintf("output %d", i+1)
	}
	tc := ToolCallInfo{
		Name:   "custom_mcp_tool",
		Args:   map[string]interface{}{"q": "test"},
		Status: "completed",
		Result: strings.Join(lines, "\n"),
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	compact := RenderCompact(tc, opts)
	assertContains(t, compact, "more lines")

	expanded := RenderExpanded(tc, opts)
	assertNotContains(t, expanded, "more lines")
}

func TestRenderExpanded_Unknown_Error(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "custom_mcp_tool",
		Args:   map[string]interface{}{"q": "test"},
		Status: "completed",
		Result: "Error: not found",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "✗")
	assertContains(t, got, "not found")
}

func TestRenderExpanded_Unknown_WithServerName(t *testing.T) {
	tc := ToolCallInfo{
		Name:       "search",
		ServerName: "planton",
		Args:       map[string]interface{}{"query": "test"},
		Status:     "completed",
		Result:     "result line 1\nresult line 2",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "planton/search")
	assertContains(t, got, "result line 1")
	assertContains(t, got, "result line 2")
}

func TestRenderExpanded_Unknown_EmptyResult(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "custom_mcp_tool",
		Args:   map[string]interface{}{"q": "test"},
		Status: "completed",
		Result: "",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderExpanded(tc, opts)
	assertContains(t, got, "custom_mcp_tool")
	assertContains(t, got, "q:")
}

// =============================================================================
// RenderExpanded — tools identical to compact
// =============================================================================

func TestRenderExpanded_Read_IdenticalToCompact(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "read_file",
		Args:   map[string]interface{}{"path": "main.go"},
		Status: "completed",
		Result: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hello\")\n}\n",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	expanded := RenderExpanded(tc, opts)
	compact := RenderCompact(tc, opts)

	if expanded != compact {
		t.Errorf("expanded read should be identical to compact\n  expanded: %q\n  compact:  %q", expanded, compact)
	}
}

func TestRenderExpanded_Write_IdenticalToCompact(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "write_file",
		Args:   map[string]interface{}{"path": "out.go", "contents": "package out\n"},
		Status: "completed",
		Result: "Successfully wrote 12 characters",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	expanded := RenderExpanded(tc, opts)
	compact := RenderCompact(tc, opts)

	if expanded != compact {
		t.Errorf("expanded write should be identical to compact\n  expanded: %q\n  compact:  %q", expanded, compact)
	}
}

func TestRenderExpanded_Delete_IdenticalToCompact(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "delete_file",
		Args:   map[string]interface{}{"path": "old.go"},
		Status: "completed",
		Result: "deleted",
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	expanded := RenderExpanded(tc, opts)
	compact := RenderCompact(tc, opts)

	if expanded != compact {
		t.Errorf("expanded delete should be identical to compact\n  expanded: %q\n  compact:  %q", expanded, compact)
	}
}

// =============================================================================
// RenderReadGroupExpanded
// =============================================================================

func TestRenderReadGroupExpanded_AllEntriesShown(t *testing.T) {
	reads := make([]ToolCallInfo, 8)
	for i := range reads {
		reads[i] = ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("file_%d.go", i+1)},
			Status: "completed",
			Result: fmt.Sprintf("content of file %d\n", i+1),
		}
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroupExpanded(reads, opts)

	assertContains(t, got, "8 files")
	for i := range reads {
		assertContains(t, got, fmt.Sprintf("file_%d.go", i+1))
	}
	assertNotContains(t, got, "more")
}

func TestRenderReadGroupExpanded_CompactTruncates(t *testing.T) {
	reads := make([]ToolCallInfo, 6)
	for i := range reads {
		reads[i] = ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("f%d.go", i+1)},
			Status: "completed",
			Result: "content\n",
		}
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	compact := RenderReadGroup(reads, opts)
	assertContains(t, compact, "more")

	expanded := RenderReadGroupExpanded(reads, opts)
	assertNotContains(t, expanded, "more")
}

func TestRenderReadGroupExpanded_WithFailures(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "ok.go"}, Status: "completed", Result: "content\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "bad.go"}, Status: "failed", Error: "not found"},
		{Name: "read_file", Args: map[string]interface{}{"path": "also_ok.go"}, Status: "completed", Result: "more\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroupExpanded(reads, opts)

	assertContains(t, got, "3 files")
	assertContains(t, got, "(1 failed)")
	assertContains(t, got, "ok.go")
	assertContains(t, got, "bad.go")
	assertContains(t, got, "✗")
	assertContains(t, got, "not found")
	assertContains(t, got, "also_ok.go")
}

func TestRenderReadGroupExpanded_HeaderMatchesCompact(t *testing.T) {
	reads := make([]ToolCallInfo, 5)
	for i := range reads {
		reads[i] = ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("f%d.go", i+1)},
			Status: "completed",
			Result: "x\n",
		}
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	expandedFirst := strings.SplitN(stripANSI(RenderReadGroupExpanded(reads, opts)), "\n", 2)[0]
	compactFirst := strings.SplitN(stripANSI(RenderReadGroup(reads, opts)), "\n", 2)[0]

	if expandedFirst != compactFirst {
		t.Errorf("headers differ:\n  expanded: %q\n  compact:  %q", expandedFirst, compactFirst)
	}
}

func TestRenderReadGroupExpanded_SmallGroup_ShowsAll(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}, Status: "completed", Result: "a\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}, Status: "completed", Result: "b\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "c.go"}, Status: "completed", Result: "c\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroupExpanded(reads, opts)
	assertContains(t, got, "a.go")
	assertContains(t, got, "b.go")
	assertContains(t, got, "c.go")
	assertNotContains(t, got, "more")
}

func TestRenderReadGroupExpanded_NoFileContent(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}, Status: "completed", Result: "package main\nfunc main() {}\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroupExpanded(reads, opts)
	plain := stripANSI(got)

	if strings.Contains(plain, "package main") {
		t.Error("expanded read group should not show file content")
	}
	if strings.Contains(plain, "func main") {
		t.Error("expanded read group should not show file content")
	}
}

func TestRenderReadGroupExpanded_ErrorInResult(t *testing.T) {
	reads := []ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "ok.go"}, Status: "completed", Result: "content\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "missing.go"}, Status: "completed", Result: "Error: File not found: 'missing.go'\n\nRecovery suggestions:\n- Check path\n"},
		{Name: "read_file", Args: map[string]interface{}{"path": "ok2.go"}, Status: "completed", Result: "content\n"},
	}
	opts := CompactOptions{HyperlinksEnabled: false}

	got := RenderReadGroupExpanded(reads, opts)
	assertContains(t, got, "3 files")
	assertContains(t, got, "(1 failed)")
	assertContains(t, got, "missing.go")
	assertContains(t, got, "✗")
}
