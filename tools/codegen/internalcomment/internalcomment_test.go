package internalcomment

import (
	"reflect"
	"testing"
)

// TestStripText pins the exact semantics proto2schema relied on before the
// extraction (its cases moved here verbatim from proto2schema/main_test.go)
// plus the @generated-trailer preservation stubscrub needs.
func TestStripText(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			"no marker passes through trimmed",
			"  Resource slug (unique within org).\n Format: lowercase alphanumeric.  ",
			"Resource slug (unique within org).\n Format: lowercase alphanumeric.",
		},
		{
			"marker mid-text keeps only the SDK-facing prefix",
			"When true the value is treated as a secret.\n\n@internal\nWhen is_secret is true the value is encrypted at rest.",
			"When true the value is treated as a secret.",
		},
		{
			"marker on the first line yields empty",
			"@internal\nAuthorization: requires can_edit on the resource.",
			"",
		},
		{
			"whitespace-padded marker line still counts",
			"Public text.\n   @internal   \nHandler strategy notes.",
			"Public text.",
		},
		{
			"multi-paragraph SDK prefix is preserved byte-for-byte",
			"First paragraph.\n\nSecond paragraph with detail.\n\n@internal\nInternal only.",
			"First paragraph.\n\nSecond paragraph with detail.",
		},
		{
			"truncates at the first of several markers",
			"Public.\n@internal\nInternal one.\n@internal\nInternal two.",
			"Public.",
		},
		{
			"inline @internal inside prose is not a marker",
			"See the @internal tag convention for details.",
			"See the @internal tag convention for details.",
		},
		{
			"line with trailing text after @internal is not a marker",
			"Public text.\n@internal note that stays\nMore public text.",
			"Public text.\n@internal note that stays\nMore public text.",
		},
		{
			"marker only yields empty",
			"@internal",
			"",
		},
		{
			"empty input",
			"",
			"",
		},
		{
			"@generated trailer after the internal section survives",
			"API version for this resource type.\n\n@internal\nFormat: 'agentic.stigmer.ai/v1'\nValidated as const.\n\n@generated from field: string api_version = 1;",
			"API version for this resource type.\n\n@generated from field: string api_version = 1;",
		},
		{
			"fully internal block keeps only the @generated trailer",
			"@internal\nInternal only.\n\n@generated from message a.b.C",
			"@generated from message a.b.C",
		},
		{
			"non-@generated tags after the marker are dropped like prose",
			"Public.\n\n@internal\nNotes.\n\n@since Agent Versioning (future)",
			"Public.",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := StripText(tc.input)
			if got != tc.expected {
				t.Errorf("StripText(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestStripLines(t *testing.T) {
	t.Run("no marker returns input unmodified with false", func(t *testing.T) {
		in := []string{"Doc line.", "", "More doc."}
		got, stripped := StripLines(in)
		if stripped {
			t.Fatal("StripLines reported a strip on marker-free input")
		}
		if !reflect.DeepEqual(got, in) {
			t.Errorf("StripLines modified marker-free input: %q", got)
		}
	})

	t.Run("marker with trailer keeps blank separator shape", func(t *testing.T) {
		in := []string{"Summary.", "", "@internal", "Secret notes.", "", "@generated from field: string x = 1;"}
		want := []string{"Summary.", "", "@generated from field: string x = 1;"}
		got, stripped := StripLines(in)
		if !stripped {
			t.Fatal("StripLines missed the marker")
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("StripLines = %q, want %q", got, want)
		}
	})

	t.Run("fully internal block strips to nothing", func(t *testing.T) {
		in := []string{"@internal", "Only internal."}
		got, stripped := StripLines(in)
		if !stripped || len(got) != 0 {
			t.Errorf("StripLines = %q (stripped=%v), want empty with true", got, stripped)
		}
	})
}
