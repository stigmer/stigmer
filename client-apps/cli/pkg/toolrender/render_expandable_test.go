package toolrender

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// lineN returns a string with n lines (each line is "line\n", so n newlines total).
// strings.Split(..., "\n") yields n+1 elements for "line1\nline2\n...\nlinen" (trailing \n adds empty).
// The implementation uses strings.TrimRight and Split, so "a\nb\nc\n" -> ["a","b","c",""] -> len 4.
// For "a\nb\nc\nd\n" (no trailing newline) -> ["a","b","c","d"] -> len 4.
// So for N lines we need N newline-separated non-empty parts. "x\n" * n gives n lines.
func lineN(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.Repeat("x\n", n)
}

// =============================================================================
// IsExpandable: Read tools non-expandable for success content
// =============================================================================

func TestIsExpandable_ReadTools_SuccessNotExpandable(t *testing.T) {
	readTools := []string{"read", "read_file"}
	for _, name := range readTools {
		t.Run(name, func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   name,
				Args:   map[string]interface{}{"path": "main.go"},
				Status: "completed",
				Result: lineN(100), // lots of content
			}
			assert.False(t, IsExpandable(tc), "read success content is never expandable (compact shows line count)")
		})
	}
}

// =============================================================================
// IsExpandable: Write/Edit tools non-expandable for success content
// =============================================================================

func TestIsExpandable_WriteEditTools_SuccessNotExpandable(t *testing.T) {
	tools := []string{"write", "write_file", "create_file", "overwrite_file", "edit", "edit_file"}
	for _, name := range tools {
		t.Run(name, func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   name,
				Args:   map[string]interface{}{"path": "x.go", "contents": lineN(100)},
				Status: "completed",
				Result: "ok",
			}
			assert.False(t, IsExpandable(tc), "%s success content is never expandable", name)
		})
	}
}

// =============================================================================
// IsExpandable: Delete tool non-expandable for success content
// =============================================================================

func TestIsExpandable_DeleteTool_SuccessNotExpandable(t *testing.T) {
	tools := []string{"delete_file", "remove_file"}
	for _, name := range tools {
		t.Run(name, func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   name,
				Args:   map[string]interface{}{"path": "tmp.go"},
				Status: "completed",
				Result: "deleted",
			}
			assert.False(t, IsExpandable(tc), "%s success content is never expandable", name)
		})
	}
}

// =============================================================================
// IsExpandable: Shell tool expandable/non-expandable based on line count
// =============================================================================

func TestIsExpandable_ShellTool_LineCount(t *testing.T) {
	shellTools := []string{"shell", "bash", "execute"}
	for _, name := range shellTools {
		t.Run(name, func(t *testing.T) {
			tests := []struct {
				lines    int
				expandable bool
			}{
				{0, false},
				{1, false},
				{2, false},
				{3, false},
				{4, false}, // maxShellOutputLines+1 = 4, so <=4 is not expandable
				{5, true},  // 5+ lines is expandable
				{10, true},
			}
			for _, tt := range tests {
				t.Run(strings.Repeat("x", tt.lines), func(t *testing.T) {
					tc := ToolCallInfo{
						Name:   name,
						Args:   map[string]interface{}{"command": "echo test"},
						Status: "completed",
						Result: lineN(tt.lines),
					}
					got := IsExpandable(tc)
					assert.Equal(t, tt.expandable, got, "lines=%d", tt.lines)
				})
			}
		})
	}
}

func TestIsExpandable_ShellTool_EmptyResult_NotExpandable(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "true"},
		Status: "completed",
		Result: "",
	}
	assert.False(t, IsExpandable(tc))
}

// =============================================================================
// IsExpandable: Think tool expandable/non-expandable based on line count
// =============================================================================

func TestIsExpandable_ThinkTool_LineCount(t *testing.T) {
	tests := []struct {
		lines     int
		expandable bool
	}{
		{0, false},
		{1, false},
		{2, false},
		{3, false},
		{4, false}, // maxThinkLines+1 = 4
		{5, true},
		{10, true},
	}
	for _, tt := range tests {
		t.Run(strings.Repeat("x", tt.lines), func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   "think",
				Args:   map[string]interface{}{"thought": lineN(tt.lines)},
				Status: "completed",
				Result: "ok",
			}
			got := IsExpandable(tc)
			assert.Equal(t, tt.expandable, got, "lines=%d", tt.lines)
		})
	}
}

func TestIsExpandable_ThinkTool_EmptyThought_NotExpandable(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": ""},
		Status: "completed",
		Result: "ok",
	}
	assert.False(t, IsExpandable(tc))
}

// =============================================================================
// IsExpandable: Discovery tools expandable/non-expandable based on content
// =============================================================================

func TestIsExpandable_DiscoveryTools_ExpandableWhenNonEmptyResult(t *testing.T) {
	discoveryTools := []struct {
		name string
		args map[string]interface{}
	}{
		{"list_directory", map[string]interface{}{"path": "."}},
		{"ls", map[string]interface{}{"path": "."}},
		{"glob", map[string]interface{}{"pattern": "*.go"}},
		{"grep", map[string]interface{}{"pattern": "func"}},
	}
	for _, dt := range discoveryTools {
		t.Run(dt.name+"_with_entries", func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   dt.name,
				Args:   dt.args,
				Status: "completed",
				Result: "file1.go\nfile2.go\n",
			}
			assert.True(t, IsExpandable(tc), "non-empty result with entries should be expandable")
		})
		t.Run(dt.name+"_single_entry", func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   dt.name,
				Args:   dt.args,
				Status: "completed",
				Result: "only_one.go",
			}
			assert.True(t, IsExpandable(tc))
		})
	}
}

func TestIsExpandable_DiscoveryTools_NotExpandableWhenEmpty(t *testing.T) {
	discoveryTools := []string{"list_directory", "ls", "glob", "grep"}
	for _, name := range discoveryTools {
		t.Run(name, func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   name,
				Args:   map[string]interface{}{"path": ".", "pattern": "*.go"},
				Status: "completed",
				Result: "",
			}
			assert.False(t, IsExpandable(tc))
		})
	}
}

func TestIsExpandable_DiscoveryTools_NotExpandableWhenOnlyWhitespace(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "glob",
		Args:   map[string]interface{}{"pattern": "*.go"},
		Status: "completed",
		Result: "   \n\n  \n",
	}
	assert.False(t, IsExpandable(tc))
}

// =============================================================================
// IsExpandable: Unknown/MCP tools expandable/non-expandable based on line count
// =============================================================================

func TestIsExpandable_UnknownTool_LineCount(t *testing.T) {
	tests := []struct {
		lines     int
		expandable bool
	}{
		{0, false},
		{1, false},
		{2, false},
		{3, false},
		{4, false}, // maxUnknownOutputLines+1 = 4
		{5, true},
		{10, true},
	}
	for _, tt := range tests {
		t.Run(strings.Repeat("x", tt.lines), func(t *testing.T) {
			tc := ToolCallInfo{
				Name:   "mcp_custom_tool",
				Args:   map[string]interface{}{"query": "test"},
				Status: "completed",
				Result: lineN(tt.lines),
			}
			got := IsExpandable(tc)
			assert.Equal(t, tt.expandable, got, "lines=%d", tt.lines)
		})
	}
}

func TestIsExpandable_UnknownTool_EmptyResult_NotExpandable(t *testing.T) {
	tc := ToolCallInfo{
		Name:   "unknown_mcp_tool",
		Args:   nil,
		Status: "completed",
		Result: "",
	}
	assert.False(t, IsExpandable(tc))
}

// =============================================================================
// IsExpandable: Short errors are non-expandable (error fits within display cap)
// =============================================================================

func TestIsExpandable_ShortErrors_NotExpandable(t *testing.T) {
	tests := []struct {
		name string
		tc   ToolCallInfo
	}{
		{
			"shell_failed_status",
			ToolCallInfo{
				Name:   "shell",
				Args:   map[string]interface{}{"command": "false"},
				Status: "failed",
				Result: lineN(20),
			},
		},
		{
			"shell_error_field",
			ToolCallInfo{
				Name:   "shell",
				Args:   map[string]interface{}{"command": "exit 1"},
				Status: "completed",
				Error:  "command failed",
				Result: lineN(20),
			},
		},
		{
			"think_failed_status",
			ToolCallInfo{
				Name:   "think",
				Args:   map[string]interface{}{"thought": lineN(10)},
				Status: "failed",
				Result: "ok",
			},
		},
		{
			"discovery_failed",
			ToolCallInfo{
				Name:   "glob",
				Args:   map[string]interface{}{"pattern": "*.go"},
				Status: "failed",
				Result: "file1.go\nfile2.go",
			},
		},
		{
			"unknown_tool_error",
			ToolCallInfo{
				Name:   "mcp_tool",
				Status: "failed",
				Result: lineN(20),
			},
		},
		{
			"unknown_tool_error_field",
			ToolCallInfo{
				Name:   "mcp_tool",
				Error:  "something went wrong",
				Result: lineN(20),
			},
		},
		{
			"unknown_tool_result_error_prefix_short",
			ToolCallInfo{
				Name:   "mcp_tool",
				Status: "completed",
				Result: "Error: MCP server not found",
			},
		},
		{
			"read_short_error",
			ToolCallInfo{
				Name:   "read",
				Args:   map[string]interface{}{"path": "missing.go"},
				Status: "completed",
				Result: "Error: file not found",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.False(t, IsExpandable(tt.tc), "short errors should not be expandable")
		})
	}
}

// =============================================================================
// IsExpandable: Long/multi-line errors ARE expandable
// =============================================================================

func TestIsExpandable_LongErrors_Expandable(t *testing.T) {
	longErr := strings.Repeat("x", maxErrorDisplayLen+1)
	multiLineResult := "Error: MCP server 'planton' in org 'default' not found\nVerify the server slug and organization.\nRun 'stigmer discover' to list available servers."

	tests := []struct {
		name string
		tc   ToolCallInfo
	}{
		{
			"shell_long_error_field",
			ToolCallInfo{
				Name:   "shell",
				Args:   map[string]interface{}{"command": "go build"},
				Status: "failed",
				Error:  longErr,
			},
		},
		{
			"read_long_error",
			ToolCallInfo{
				Name:   "read",
				Args:   map[string]interface{}{"path": "x.go"},
				Status: "completed",
				Result: "Error: " + longErr,
			},
		},
		{
			"write_long_error_field",
			ToolCallInfo{
				Name:   "write",
				Args:   map[string]interface{}{"path": "x.go"},
				Status: "failed",
				Error:  longErr,
			},
		},
		{
			"delete_long_error_field",
			ToolCallInfo{
				Name:   "delete_file",
				Args:   map[string]interface{}{"path": "x.go"},
				Status: "failed",
				Error:  longErr,
			},
		},
		{
			"discovery_long_error_field",
			ToolCallInfo{
				Name:   "glob",
				Args:   map[string]interface{}{"pattern": "*.go"},
				Status: "failed",
				Error:  longErr,
			},
		},
		{
			"think_long_error_field",
			ToolCallInfo{
				Name:   "think",
				Args:   map[string]interface{}{"thought": "x"},
				Status: "failed",
				Error:  longErr,
			},
		},
		{
			"unknown_long_error_field",
			ToolCallInfo{
				Name:   "mcp_tool",
				Error:  longErr,
				Result: lineN(20),
			},
		},
		{
			"unknown_result_error_multiline",
			ToolCallInfo{
				Name:   "mcp_tool",
				Status: "completed",
				Result: multiLineResult,
			},
		},
		{
			"unknown_result_error_long_single_line",
			ToolCallInfo{
				Name:   "mcp_tool",
				Status: "completed",
				Result: "Error: " + longErr,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.True(t, IsExpandable(tt.tc), "long/multi-line errors should be expandable")
		})
	}
}

// =============================================================================
// IsReadGroupExpandable
// =============================================================================

func TestIsReadGroupExpandable_Threshold(t *testing.T) {
	makeRead := func(path string) ToolCallInfo {
		return ToolCallInfo{
			Name:   "read",
			Args:   map[string]interface{}{"path": path},
			Status: "completed",
			Result: "content",
		}
	}
	tests := []struct {
		count     int
		expandable bool
	}{
		{0, false},
		{1, false},
		{2, false},
		{3, false},
		{4, false}, // maxVisibleInGroup+1 = 4, so <=4 is not expandable
		{5, true},
		{6, true},
		{10, true},
	}
	for _, tt := range tests {
		t.Run(strings.Repeat("x", tt.count), func(t *testing.T) {
			reads := make([]ToolCallInfo, tt.count)
			for i := 0; i < tt.count; i++ {
				reads[i] = makeRead(strings.Repeat("f", i+1) + ".go")
			}
			got := IsReadGroupExpandable(reads)
			assert.Equal(t, tt.expandable, got, "count=%d", tt.count)
		})
	}
}

func TestIsReadGroupExpandable_EmptySlice(t *testing.T) {
	assert.False(t, IsReadGroupExpandable(nil))
	assert.False(t, IsReadGroupExpandable([]ToolCallInfo{}))
}

// =============================================================================
// Edge cases: line counting
// =============================================================================

func TestIsExpandable_ShellTool_ExactBoundary(t *testing.T) {
	// 4 lines: not expandable. 5 lines: expandable.
	require.False(t, IsExpandable(ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "echo"},
		Status: "completed",
		Result: "a\nb\nc\nd",
	}))
	require.True(t, IsExpandable(ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "echo"},
		Status: "completed",
		Result: "a\nb\nc\nd\ne",
	}))
}

func TestIsExpandable_ThinkTool_ExactBoundary(t *testing.T) {
	require.False(t, IsExpandable(ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "a\nb\nc\nd"},
		Status: "completed",
		Result: "ok",
	}))
	require.True(t, IsExpandable(ToolCallInfo{
		Name:   "think",
		Args:   map[string]interface{}{"thought": "a\nb\nc\nd\ne"},
		Status: "completed",
		Result: "ok",
	}))
}

func TestIsExpandable_UnknownTool_ExactBoundary(t *testing.T) {
	require.False(t, IsExpandable(ToolCallInfo{
		Name:   "custom",
		Status: "completed",
		Result: "a\nb\nc\nd",
	}))
	require.True(t, IsExpandable(ToolCallInfo{
		Name:   "custom",
		Status: "completed",
		Result: "a\nb\nc\nd\ne",
	}))
}
