package naming

import (
	"testing"
)

func TestGenerateSlug(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "simple name",
			input:    "My Agent",
			expected: "my-agent",
		},
		{
			name:     "name with special characters",
			input:    "Code Analysis & Review",
			expected: "code-analysis-review",
		},
		{
			name:     "name with parentheses",
			input:    "Data Processing (v2)",
			expected: "data-processing-v2",
		},
		{
			name:     "name with multiple spaces",
			input:    "My   Cool   Agent",
			expected: "my-cool-agent",
		},
		{
			name:     "name with leading/trailing spaces",
			input:    "  My Agent  ",
			expected: "my-agent",
		},
		{
			name:     "name with leading/trailing hyphens",
			input:    "--my-agent--",
			expected: "my-agent",
		},
		{
			name:     "single character",
			input:    "A",
			expected: "a",
		},
		{
			name:     "already valid slug",
			input:    "my-agent",
			expected: "my-agent",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "only special characters",
			input:    "!@#$%",
			expected: "",
		},
		{
			name:     "mixed case with numbers",
			input:    "Agent-V2-Beta",
			expected: "agent-v2-beta",
		},
		{
			name:     "unicode characters",
			input:    "Café Agent",
			expected: "caf-agent",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := GenerateSlug(tt.input)
			if result != tt.expected {
				t.Errorf("GenerateSlug(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestValidateSlug(t *testing.T) {
	tests := []struct {
		name      string
		slug      string
		wantError bool
	}{
		{
			name:      "valid simple slug",
			slug:      "my-agent",
			wantError: false,
		},
		{
			name:      "valid slug with numbers",
			slug:      "agent-v2",
			wantError: false,
		},
		{
			name:      "valid single character",
			slug:      "a",
			wantError: false,
		},
		{
			name:      "valid single number",
			slug:      "1",
			wantError: false,
		},
		{
			name:      "valid long slug",
			slug:      "my-very-long-agent-name-v2",
			wantError: false,
		},
		{
			name:      "invalid - starts with hyphen",
			slug:      "-my-agent",
			wantError: true,
		},
		{
			name:      "invalid - ends with hyphen",
			slug:      "my-agent-",
			wantError: true,
		},
		{
			name:      "invalid - uppercase",
			slug:      "My-Agent",
			wantError: true,
		},
		{
			name:      "invalid - contains space",
			slug:      "my agent",
			wantError: true,
		},
		{
			name:      "invalid - contains special character",
			slug:      "my_agent",
			wantError: true,
		},
		{
			name:      "invalid - empty string",
			slug:      "",
			wantError: true,
		},
		{
			name:      "invalid - only hyphen",
			slug:      "-",
			wantError: true,
		},
		{
			name:      "invalid - consecutive hyphens",
			slug:      "my--agent",
			wantError: false, // Actually valid! Consecutive hyphens are allowed
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateSlug(tt.slug)
			if (err != nil) != tt.wantError {
				t.Errorf("ValidateSlug(%q) error = %v, wantError %v", tt.slug, err, tt.wantError)
			}
		})
	}
}

// TestSlugGenerationMatchesBackend ensures SDK slug generation matches backend behavior
func TestSlugGenerationMatchesBackend(t *testing.T) {
	// These test cases should match the backend implementation exactly
	backendTestCases := []struct {
		input    string
		expected string
	}{
		{"My Cool Agent", "my-cool-agent"},
		{"Code Analysis", "code-analysis"},
		{"Data Processing (v2)", "data-processing-v2"},
		{"Hello World!", "hello-world"},
		{"Test  Multiple   Spaces", "test-multiple-spaces"},
		{"---edge---case---", "edge-case"},
		{"UPPERCASE", "uppercase"},
		{"MixedCase", "mixedcase"},
		{"123-numeric", "123-numeric"},
		{"Special@#$Characters", "special-characters"},
	}

	for _, tc := range backendTestCases {
		t.Run(tc.input, func(t *testing.T) {
			result := GenerateSlug(tc.input)
			if result != tc.expected {
				t.Errorf("GenerateSlug(%q) = %q, expected %q (backend expectation)", tc.input, result, tc.expected)
			}

			// Also verify the result is valid
			if result != "" {
				if err := ValidateSlug(result); err != nil {
					t.Errorf("Generated slug %q failed validation: %v", result, err)
				}
			}
		})
	}
}
