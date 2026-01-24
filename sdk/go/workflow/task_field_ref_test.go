package workflow

import (
	"testing"
)

func TestTaskFieldRefHelpers(t *testing.T) {
	// Create a TaskFieldRef for testing
	ref := TaskFieldRef{
		taskName:  "fetchTask",
		fieldName: "statusCode",
	}

	tests := []struct {
		name     string
		actual   string
		expected string
	}{
		{
			name:     "Equals with number",
			actual:   ref.Equals(200),
			expected: `${ $context["fetchTask"].statusCode } == 200`,
		},
		{
			name:     "Equals with string",
			actual:   ref.Equals("active"),
			expected: `${ $context["fetchTask"].statusCode } == "active"`,
		},
		{
			name:     "NotEquals with number",
			actual:   ref.NotEquals(404),
			expected: `${ $context["fetchTask"].statusCode } != 404`,
		},
		{
			name:     "GreaterThan",
			actual:   ref.GreaterThan(100),
			expected: `${ $context["fetchTask"].statusCode } > 100`,
		},
		{
			name:     "GreaterThanOrEqual",
			actual:   ref.GreaterThanOrEqual(50),
			expected: `${ $context["fetchTask"].statusCode } >= 50`,
		},
		{
			name:     "LessThan",
			actual:   ref.LessThan(300),
			expected: `${ $context["fetchTask"].statusCode } < 300`,
		},
		{
			name:     "LessThanOrEqual",
			actual:   ref.LessThanOrEqual(500),
			expected: `${ $context["fetchTask"].statusCode } <= 500`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.actual != tt.expected {
				t.Errorf("Expected: %s\nGot: %s", tt.expected, tt.actual)
			}
		})
	}
}

func TestTaskFieldRefStringHelpers(t *testing.T) {
	// Create a TaskFieldRef for testing string operations
	ref := TaskFieldRef{
		taskName:  "checkTask",
		fieldName: "message",
	}

	tests := []struct {
		name     string
		actual   string
		expected string
	}{
		{
			name:     "Contains",
			actual:   ref.Contains("error"),
			expected: `${ $context["checkTask"].message } | contains("error")`,
		},
		{
			name:     "StartsWith",
			actual:   ref.StartsWith("https://"),
			expected: `${ $context["checkTask"].message } | startswith("https://")`,
		},
		{
			name:     "EndsWith",
			actual:   ref.EndsWith(".json"),
			expected: `${ $context["checkTask"].message } | endswith(".json")`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.actual != tt.expected {
				t.Errorf("Expected: %s\nGot: %s", tt.expected, tt.actual)
			}
		})
	}
}

func TestFormatValue(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected string
	}{
		{"string", "hello", `"hello"`},
		{"int", 42, "42"},
		{"float", 3.14, "3.14"},
		{"bool", true, "true"},
		{"bool false", false, "false"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := formatValue(tt.input)
			if actual != tt.expected {
				t.Errorf("formatValue(%v) = %s, expected %s", tt.input, actual, tt.expected)
			}
		})
	}
}
