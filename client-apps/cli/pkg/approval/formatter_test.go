package approval

import (
	"strings"
	"testing"
)

// =============================================================================
// FormatArgs Tests
// =============================================================================

func TestFormatArgs_EmptyPreview(t *testing.T) {
	result := FormatArgs("shell", "")
	if result != "" {
		t.Errorf("expected empty string for empty preview, got %q", result)
	}
}

func TestFormatArgs_EmptyObject(t *testing.T) {
	result := FormatArgs("shell", "{}")
	if result != "" {
		t.Errorf("expected empty string for empty object, got %q", result)
	}
}

func TestFormatArgs_InvalidJSON(t *testing.T) {
	result := FormatArgs("shell", "not json at all")
	if !strings.Contains(result, "not json at all") {
		t.Error("expected original text to be present in indented output")
	}
	// Should be indented
	if !strings.HasPrefix(result, "  ") {
		t.Error("expected indentation for non-JSON input")
	}
}

func TestFormatArgs_ShellTool_HighlightsCommand(t *testing.T) {
	args := `{"command": "ls -la /tmp", "working_directory": "/home/user"}`
	result := FormatArgs("shell", args)

	if !strings.Contains(result, "Command:") {
		t.Error("expected Command label for shell tool")
	}
	if !strings.Contains(result, "ls -la /tmp") {
		t.Error("expected command value to be present")
	}
	if !strings.Contains(result, "working_directory:") {
		t.Error("expected secondary field to be present")
	}
}

func TestFormatArgs_BashTool(t *testing.T) {
	args := `{"command": "echo hello"}`
	result := FormatArgs("bash", args)

	if !strings.Contains(result, "Command:") {
		t.Error("expected Command label for bash tool")
	}
	if !strings.Contains(result, "echo hello") {
		t.Error("expected command value")
	}
}

func TestFormatArgs_WriteFileTool(t *testing.T) {
	args := `{"path": "/etc/config.yaml", "content": "key: value"}`
	result := FormatArgs("write_file", args)

	if !strings.Contains(result, "Path:") {
		t.Error("expected Path label for write_file tool")
	}
	if !strings.Contains(result, "/etc/config.yaml") {
		t.Error("expected path value")
	}
	if !strings.Contains(result, "content:") {
		t.Error("expected content as secondary field")
	}
}

func TestFormatArgs_DeleteFileTool(t *testing.T) {
	args := `{"path": "/etc/hosts"}`
	result := FormatArgs("delete_file", args)

	if !strings.Contains(result, "Path:") {
		t.Error("expected Path label for delete_file tool")
	}
	if !strings.Contains(result, "/etc/hosts") {
		t.Error("expected path value")
	}
}

func TestFormatArgs_UnknownTool_GenericFormatting(t *testing.T) {
	args := `{"repo": "acme/staging", "force": true}`
	result := FormatArgs("custom_deploy_tool", args)

	if !strings.Contains(result, "force:") {
		t.Error("expected force field in generic output")
	}
	if !strings.Contains(result, "repo:") {
		t.Error("expected repo field in generic output")
	}
}

func TestFormatArgs_PrimaryFieldAppearsFirst(t *testing.T) {
	args := `{"working_directory": "/home", "command": "ls -la"}`
	result := FormatArgs("shell", args)

	commandIdx := strings.Index(result, "Command:")
	wdIdx := strings.Index(result, "working_directory:")

	if commandIdx == -1 || wdIdx == -1 {
		t.Fatal("expected both fields to be present")
	}
	if commandIdx > wdIdx {
		t.Error("primary field (Command) should appear before secondary fields")
	}
}

func TestFormatArgs_SecondaryFieldsAlphabetical(t *testing.T) {
	args := `{"command": "test", "zebra": "z", "alpha": "a"}`
	result := FormatArgs("shell", args)

	alphaIdx := strings.Index(result, "alpha:")
	zebraIdx := strings.Index(result, "zebra:")

	if alphaIdx == -1 || zebraIdx == -1 {
		t.Fatal("expected both secondary fields to be present")
	}
	if alphaIdx > zebraIdx {
		t.Error("secondary fields should be in alphabetical order")
	}
}

func TestFormatArgs_UnknownTool_AlphabeticalOrder(t *testing.T) {
	args := `{"zebra": "z", "alpha": "a", "middle": "m"}`
	result := FormatArgs("unknown_tool", args)

	alphaIdx := strings.Index(result, "alpha:")
	middleIdx := strings.Index(result, "middle:")
	zebraIdx := strings.Index(result, "zebra:")

	if alphaIdx == -1 || middleIdx == -1 || zebraIdx == -1 {
		t.Fatal("expected all fields to be present")
	}
	if !(alphaIdx < middleIdx && middleIdx < zebraIdx) {
		t.Error("fields should be in alphabetical order")
	}
}

// =============================================================================
// formatValue Tests
// =============================================================================

func TestFormatValue_String(t *testing.T) {
	result := formatValue("hello")
	if result != "hello" {
		t.Errorf("expected %q, got %q", "hello", result)
	}
}

func TestFormatValue_Integer(t *testing.T) {
	result := formatValue(float64(42))
	if result != "42" {
		t.Errorf("expected %q, got %q", "42", result)
	}
}

func TestFormatValue_Float(t *testing.T) {
	result := formatValue(3.14)
	if result != "3.14" {
		t.Errorf("expected %q, got %q", "3.14", result)
	}
}

func TestFormatValue_Bool(t *testing.T) {
	result := formatValue(true)
	if result != "true" {
		t.Errorf("expected %q, got %q", "true", result)
	}
}

func TestFormatValue_Nil(t *testing.T) {
	result := formatValue(nil)
	if result != "null" {
		t.Errorf("expected %q, got %q", "null", result)
	}
}

func TestFormatValue_NestedObject(t *testing.T) {
	nested := map[string]interface{}{"key": "value"}
	result := formatValue(nested)

	if !strings.Contains(result, "key") || !strings.Contains(result, "value") {
		t.Errorf("expected nested object to be JSON-formatted, got %q", result)
	}
}

// =============================================================================
// sortedKeys Tests
// =============================================================================

func TestSortedKeys_Alphabetical(t *testing.T) {
	m := map[string]interface{}{
		"charlie": 3,
		"alpha":   1,
		"bravo":   2,
	}

	keys := sortedKeys(m)

	expected := []string{"alpha", "bravo", "charlie"}
	if len(keys) != len(expected) {
		t.Fatalf("expected %d keys, got %d", len(expected), len(keys))
	}
	for i, key := range keys {
		if key != expected[i] {
			t.Errorf("key[%d] = %q, expected %q", i, key, expected[i])
		}
	}
}

func TestSortedKeys_EmptyMap(t *testing.T) {
	keys := sortedKeys(map[string]interface{}{})
	if len(keys) != 0 {
		t.Errorf("expected empty slice, got %d keys", len(keys))
	}
}

// =============================================================================
// indentLines Tests
// =============================================================================

func TestIndentLines_SingleLine(t *testing.T) {
	result := indentLines("hello")
	if result != "  hello" {
		t.Errorf("expected %q, got %q", "  hello", result)
	}
}

func TestIndentLines_MultipleLines(t *testing.T) {
	result := indentLines("line1\nline2")
	expected := "  line1\n  line2"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

func TestIndentLines_EmptyLines(t *testing.T) {
	result := indentLines("line1\n\nline3")
	expected := "  line1\n\n  line3"
	if result != expected {
		t.Errorf("expected %q, got %q", expected, result)
	}
}

// =============================================================================
// Tool Category Coverage Tests
// =============================================================================

func TestFormatArgs_AllShellTools(t *testing.T) {
	shellTools := []string{"shell", "bash", "execute_command", "run_command", "terminal"}
	args := `{"command": "test"}`

	for _, tool := range shellTools {
		t.Run(tool, func(t *testing.T) {
			result := FormatArgs(tool, args)
			if !strings.Contains(result, "Command:") {
				t.Errorf("tool %q should use Command label", tool)
			}
		})
	}
}

func TestFormatArgs_AllFileWriteTools(t *testing.T) {
	writeTools := []string{"write_file", "create_file", "overwrite_file", "edit_file"}
	args := `{"path": "/tmp/test.txt"}`

	for _, tool := range writeTools {
		t.Run(tool, func(t *testing.T) {
			result := FormatArgs(tool, args)
			if !strings.Contains(result, "Path:") {
				t.Errorf("tool %q should use Path label", tool)
			}
		})
	}
}

func TestFormatArgs_AllDeleteTools(t *testing.T) {
	deleteTools := []string{"delete_file", "remove_file"}
	args := `{"path": "/tmp/test.txt"}`

	for _, tool := range deleteTools {
		t.Run(tool, func(t *testing.T) {
			result := FormatArgs(tool, args)
			if !strings.Contains(result, "Path:") {
				t.Errorf("tool %q should use Path label", tool)
			}
		})
	}
}

func TestFormatArgs_MissingPrimaryField(t *testing.T) {
	// Shell tool but args don't have "command" field
	args := `{"working_directory": "/home"}`
	result := FormatArgs("shell", args)

	// Should still show the secondary field
	if !strings.Contains(result, "working_directory:") {
		t.Error("expected secondary field when primary is missing")
	}
}
