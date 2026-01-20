package workflow

import (
	"testing"
)

// TestBracketNotation_WithHyphens verifies that task names with hyphens work correctly
// now that we use bracket notation for task references.
func TestBracketNotation_WithHyphens(t *testing.T) {
	// Create a task with hyphens in the name (common pattern)
	task := &Task{
		Name: "fetch-pr",
		Kind: TaskKindHttpCall,
	}

	// Create a field reference
	ref := task.Field("diff_url")

	// Verify the expression uses bracket notation to support hyphens
	expectedExpr := "${ $context[\"fetch-pr\"].diff_url }"
	if ref.Expression() != expectedExpr {
		t.Errorf("Expected expression %s, got: %s", expectedExpr, ref.Expression())
	}

	// Verify auto-export was set
	if task.ExportAs != "${.}" {
		t.Errorf("Expected auto-export to be set to '${.}', got: %s", task.ExportAs)
	}
}

// TestBracketNotation_WithUnderscores verifies that task names with underscores also work.
func TestBracketNotation_WithUnderscores(t *testing.T) {
	task := &Task{
		Name: "fetch_data",
		Kind: TaskKindHttpCall,
	}

	ref := task.Field("response")

	// Bracket notation works for underscores too (though not strictly necessary)
	expectedExpr := "${ $context[\"fetch_data\"].response }"
	if ref.Expression() != expectedExpr {
		t.Errorf("Expected expression %s, got: %s", expectedExpr, ref.Expression())
	}
}

// TestBracketNotation_WithSpecialCharacters verifies bracket notation handles various characters.
func TestBracketNotation_WithSpecialCharacters(t *testing.T) {
	tests := []struct {
		name     string
		taskName string
		field    string
		expected string
	}{
		{
			name:     "hyphens in task name",
			taskName: "fetch-pr-data",
			field:    "title",
			expected: "${ $context[\"fetch-pr-data\"].title }",
		},
		{
			name:     "multiple hyphens",
			taskName: "fetch-github-pr-diff",
			field:    "url",
			expected: "${ $context[\"fetch-github-pr-diff\"].url }",
		},
		{
			name:     "mixed hyphen and underscore",
			taskName: "fetch-pr_data",
			field:    "body",
			expected: "${ $context[\"fetch-pr_data\"].body }",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task := &Task{
				Name: tt.taskName,
				Kind: TaskKindHttpCall,
			}

			ref := task.Field(tt.field)

			if ref.Expression() != tt.expected {
				t.Errorf("Expected expression %s, got: %s", tt.expected, ref.Expression())
			}
		})
	}
}
