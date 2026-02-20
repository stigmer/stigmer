package convert

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

func TestGenerateSlug(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", ""},
		{"simple", "simple"},
		{"UPPERCASE", "uppercase"},
		{"My Cool Agent", "my-cool-agent"},
		{"Code Analysis & Review", "code-analysis-review"},
		{"Data Processing (v2)", "data-processing-v2"},
		{"Special@#$Characters", "special-characters"},
		{"  leading-trailing  ", "leading-trailing"},
		{"kebab-case", "kebab-case"},
		{"multiple   spaces", "multiple-spaces"},
		{"trailing---hyphens---", "trailing-hyphens"},
		{"123numeric", "123numeric"},
		{"mixedCase123", "mixedcase123"},
		{"a", "a"},
		{"---", ""},
		{"hello--world", "hello-world"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := GenerateSlug(tt.input); got != tt.want {
				t.Errorf("GenerateSlug(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestVisibilityFromString(t *testing.T) {
	tests := []struct {
		input string
		want  apiresource.ApiResourceVisibility
	}{
		{"PUBLIC", apiresource.ApiResourceVisibility_visibility_public},
		{"public", apiresource.ApiResourceVisibility_visibility_public},
		{"Public", apiresource.ApiResourceVisibility_visibility_public},
		{"PuBlIc", apiresource.ApiResourceVisibility_visibility_public},
		{"PRIVATE", apiresource.ApiResourceVisibility_visibility_private},
		{"private", apiresource.ApiResourceVisibility_visibility_private},
		{"", apiresource.ApiResourceVisibility_visibility_private},
		{"unknown", apiresource.ApiResourceVisibility_visibility_private},
		{"PUBLICO", apiresource.ApiResourceVisibility_visibility_private},
	}
	for _, tt := range tests {
		name := tt.input
		if name == "" {
			name = "(empty)"
		}
		t.Run(name, func(t *testing.T) {
			if got := VisibilityFromString(tt.input); got != tt.want {
				t.Errorf("VisibilityFromString(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
